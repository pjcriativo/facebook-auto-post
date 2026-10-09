import { randomUUID } from "node:crypto";
import { generateContent } from "@/lib/ai/text";
import { deleteStoredImage, generateImage } from "@/lib/ai/image";
import { buildContentStrategy } from "@/lib/content-strategy";
import { getAgent, getPageAgent } from "@/lib/db/agents";
import {
  claimPublicationJob,
  createPublicationJobs,
  getPageAutomation,
  listJobsForPreparation,
  listPageAgentPool,
  listPageAutomations,
  recoverExpiredJobLeases,
  updatePageAutomation,
  updatePublicationJob,
} from "@/lib/db/page-automation";
import { createPostRecord } from "@/lib/db/posts";
import { getSettings } from "@/lib/db/settings";
import { listTemplates } from "@/lib/db/templates";
import { markTopicUsed } from "@/lib/db/topics";
import { renderPhotoOverlay } from "@/lib/images/overlay";
import { supabaseAdmin } from "@/lib/supabase/server";
import { renderTemplate } from "@/lib/templates/render";
import { addLocalDays, localParts, zonedDateTimeToUtc } from "@/lib/time";
import type {
  AgentLanguageProfile,
  ContentAgent,
  PageAutomationSettings,
  PublicationJob,
  Topic,
} from "@/lib/types";
import { validateAutomaticContent } from "@/lib/copilot/quality";

const CONTENT_ANGLES = [
  "oração curta para começar o dia",
  "frase curta que a pessoa queira guardar",
  "reflexão com aplicação prática",
  "mensagem de esperança para um momento difícil",
  "pergunta que incentive um comentário sincero",
  "ensinamento em linguagem simples",
  "declaração de fé sóbria e bíblica",
  "mensagem noturna de paz e descanso",
];

function hash(value: string): number {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

function dailySlotMinutes(config: PageAutomationSettings, dateKey: string): number[] {
  const start = config.active_start_minute;
  const end = config.active_end_minute >= start
    ? config.active_end_minute
    : config.active_end_minute + 1440;
  const count = Math.max(1, config.target_posts_per_day);
  const span = Math.max(1, end - start);

  return Array.from({ length: count }, (_, index) => {
    const base = count === 1 ? start + span / 2 : start + (span * index) / (count - 1);
    const jitterRange = config.schedule_jitter_minutes;
    const jitter = jitterRange
      ? (hash(`${config.page_id}:${dateKey}:${index}`) % (jitterRange * 2 + 1)) - jitterRange
      : 0;
    return Math.max(start, Math.min(end, Math.round(base + jitter)));
  });
}

function weightedAgentId(
  pool: Awaited<ReturnType<typeof listPageAgentPool>>,
  key: string
): string | null {
  const enabled = pool.filter((member) => member.enabled);
  const total = enabled.reduce((sum, member) => sum + member.weight, 0);
  if (!total) return null;
  let cursor = hash(key) % total;
  for (const member of enabled) {
    cursor -= member.weight;
    if (cursor < 0) return member.agent_id;
  }
  return enabled[0]?.agent_id ?? null;
}

export async function planCopilotJobs(now = new Date(), horizonHours = 30) {
  const configs = (await listPageAutomations()).filter((config) => config.enabled);
  const horizon = now.getTime() + horizonHours * 60 * 60_000;
  let created = 0;

  for (const config of configs) {
    const localToday = localParts(now, config.timezone).dateKey;
    const pool = await listPageAgentPool(config.page_id);
    const rows = [];
    for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
      const dateKey = addLocalDays(localToday, dayOffset);
      for (const [index, rawMinute] of dailySlotMinutes(config, dateKey).entries()) {
        const targetDate = rawMinute >= 1440 ? addLocalDays(dateKey, 1) : dateKey;
        const scheduledAt = zonedDateTimeToUtc(targetDate, rawMinute % 1440, config.timezone);
        if (scheduledAt.getTime() < now.getTime() - 60_000 || scheduledAt.getTime() > horizon) continue;
        const idempotencyKey = `${config.page_id}:${targetDate}:${rawMinute % 1440}`;
        rows.push({
          page_id: config.page_id,
          agent_id: weightedAgentId(pool, `${idempotencyKey}:${index}`),
          scheduled_at: scheduledAt.toISOString(),
          idempotency_key: idempotencyKey,
        });
      }
    }
    created += await createPublicationJobs(rows);
    await updatePageAutomation(config.page_id, { last_planned_at: now.toISOString() });
  }
  return { pages: configs.length, created };
}

async function resolveAgent(job: PublicationJob): Promise<{
  agent: ContentAgent;
  language: AgentLanguageProfile;
} | null> {
  const primary = await getPageAgent(job.page_id);
  const agent = job.agent_id ? await getAgent(job.agent_id) : primary?.agent;
  if (!agent?.enabled) return null;
  const locale = primary?.assignment.language ?? "pt-BR";
  const language = agent.languages?.find((item) => item.locale === locale && item.enabled)
    ?? agent.languages?.find((item) => item.enabled);
  return language ? { agent, language } : null;
}

async function chooseTopic(pageId: string, agent: ContentAgent | null, job: PublicationJob) {
  const db = supabaseAdmin();
  const [{ data: topics, error: topicError }, { data: recent, error: recentError }] = await Promise.all([
    db.from("topics")
      .select("*")
      .eq("enabled", true)
      .or(`page_id.eq.${pageId},page_id.is.null`)
      .order("last_used_at", { ascending: true, nullsFirst: true })
      .limit(100),
    db.from("posts")
      .select("topic")
      .eq("page_id", pageId)
      .in("status", ["scheduled", "posted"])
      .order("created_at", { ascending: false })
      .limit(40),
  ]);
  if (topicError) throw new Error(`Não foi possível escolher um tema: ${topicError.message}`);
  if (recentError) throw new Error(`Não foi possível verificar os temas recentes: ${recentError.message}`);

  const recentText = new Set((recent ?? []).map((item) => String(item.topic).toLocaleLowerCase()));
  const stored = (topics ?? []) as Topic[];
  const candidates = [
    ...stored.map((topic) => ({ text: topic.text, topic })),
    ...(agent?.content_pillars ?? []).map((text) => ({ text, topic: null })),
    ...(agent?.specialties ?? []).map((text) => ({ text, topic: null })),
  ].filter((item, index, all) => all.findIndex((other) => other.text.toLocaleLowerCase() === item.text.toLocaleLowerCase()) === index);
  if (candidates.length === 0) throw new Error("Cadastre temas ou pilares no agente antes de ativar esta Página.");

  const fresh = candidates.filter((item) => !recentText.has(item.text.toLocaleLowerCase()));
  const pool = fresh.length ? fresh : candidates;
  const selected = pool[hash(job.idempotency_key) % pool.length];
  const angle = CONTENT_ANGLES[hash(`${job.idempotency_key}:angle`) % CONTENT_ANGLES.length];
  return { prompt: `${selected.text}. Formato editorial: ${angle}.`, topic: selected.topic, label: selected.text };
}

async function prepareJob(job: PublicationJob, workerId: string) {
  if (!(await claimPublicationJob(job, workerId))) return { id: job.id, status: "skipped" as const };
  try {
    const config = await getPageAutomation(job.page_id);
    if (!config?.enabled) throw new Error("A automação desta Página está pausada.");
    const resolved = await resolveAgent(job);
    const chosen = await chooseTopic(job.page_id, resolved?.agent ?? null, job);
    const generationId = randomUUID();
    const content = await generateContent(chosen.prompt, generationId, {
      agent: resolved?.agent,
      language: resolved?.language,
      pageId: job.page_id,
      dailyCreditLimit: config.daily_credit_limit,
    });
    const quality = await validateAutomaticContent(job.page_id, content);
    if (!quality.passed) {
      await updatePublicationJob(job.id, {
        status: "blocked",
        quality_score: quality.score,
        quality_checks: quality.checks,
        error_message: "O controle de qualidade bloqueou este conteúdo.",
        locked_by: null,
        lease_until: null,
      });
      return { id: job.id, status: "blocked" as const };
    }

    const [templates, legacy, pageResult] = await Promise.all([
      listTemplates(),
      getSettings(),
      supabaseAdmin().from("pages_cache").select("name").eq("page_id", job.page_id).maybeSingle(),
    ]);
    const compatible = templates.filter((template) => template.enabled && (!template.page_id || template.page_id === job.page_id));
    const strategy = await buildContentStrategy({
      ...legacy,
      image_source: config.image_source,
      default_template_id: config.default_template_id,
      strategy_optimization_enabled: config.strategy_enabled,
      strategy_min_samples: config.strategy_min_samples,
      strategy_exploration_rate: config.exploration_rate,
    }, job.page_id, resolved?.agent.id ?? null, templates);
    const explore = strategy.ready && Math.random() < strategy.explorationRate;
    const source = config.image_source === "mixed"
      ? explore
        ? strategy.recommendedSource === "ai" ? "stock" : "ai"
        : strategy.recommendedSource
      : config.image_source;

    let image: { url: string; source: "ai" | "stock" | "template" };
    let templateId: string | null = null;
    let baseImageUrl: string | null = null;
    if (source === "template") {
      const selectedId = explore ? strategy.explorationTemplateId : strategy.recommendedTemplateId;
      const template = compatible.find((item) => item.id === selectedId)
        ?? compatible.find((item) => item.id === config.default_template_id)
        ?? compatible[0];
      if (!template) throw new Error("Ative ao menos um template compatível com esta Página.");
      templateId = template.id;
      image = await renderTemplate(template, content.artText || content.imageHook || content.title);
    } else {
      const prompt = source === "stock"
        ? content.stockQuery || content.imagePrompt || chosen.label
        : content.imagePrompt || chosen.label;
      const base = await generateImage(prompt, source);
      baseImageUrl = base.url;
      image = await renderPhotoOverlay({
        imageUrl: base.url,
        hook: content.imageHook || content.title,
        style: "gradient",
        pageId: job.page_id,
      }, base.source);
      await deleteStoredImage(base.url);
      baseImageUrl = null;
    }

    const post = await createPostRecord({
      topic: chosen.label,
      title: content.title,
      description: content.description,
      hashtags: content.hashtags,
      image_url: image.url,
      image_source: image.source,
      base_image_url: baseImageUrl,
      image_hook: source === "template" ? null : content.imageHook || content.title,
      image_prompt: content.imagePrompt ?? null,
      overlay_style: source === "template" ? null : "gradient",
      link_url: null,
      page_id: job.page_id,
      page_name: pageResult.data?.name ?? null,
      scheduled_at: job.scheduled_at,
      status: "scheduled",
      generation_id: generationId,
      template_id: templateId,
      agent_id: resolved?.agent.id ?? null,
      content_language: resolved?.language.locale ?? null,
      agent_prompt_version: resolved?.agent.prompt_version ?? null,
      publication_job_id: job.id,
    });
    if (chosen.topic) await markTopicUsed(chosen.topic);
    await updatePublicationJob(job.id, {
      status: "ready",
      post_id: post.id,
      quality_score: quality.score,
      quality_checks: quality.checks,
      error_message: null,
      locked_by: null,
      lease_until: null,
    });
    return { id: job.id, status: "ready" as const, postId: post.id };
  } catch (error) {
    const attempts = job.attempts + 1;
    const retry = attempts < job.max_attempts;
    await updatePublicationJob(job.id, {
      status: retry ? "retry" : "failed",
      next_retry_at: retry ? new Date(Date.now() + attempts * 15 * 60_000).toISOString() : null,
      error_message: error instanceof Error ? error.message : "Falha inesperada ao preparar o conteúdo.",
      locked_by: null,
      lease_until: null,
    });
    return { id: job.id, status: retry ? "retry" as const : "failed" as const };
  }
}

export async function runCopilotV2Preparation(now = new Date()) {
  const recovered = await recoverExpiredJobLeases();
  const planned = await planCopilotJobs(now);
  const jobs = await listJobsForPreparation(new Date(now.getTime() + 3 * 60 * 60_000).toISOString(), 3);
  const workerId = `worker:${randomUUID()}`;
  const prepared = await Promise.all(jobs.map((job) => prepareJob(job, workerId)));
  let maintenance: Record<string, number> | null = null;
  const maintenanceKey = `maintenance:${now.toISOString().slice(0, 10)}`;
  const db = supabaseAdmin();
  const { error: lockError } = await db.from("autopilot_runs").insert({ slot_key: maintenanceKey });
  if (!lockError) {
    const { data } = await db.rpc("compact_copilot_history");
    maintenance = data as Record<string, number> | null;
    await db.from("autopilot_runs").update({ status: "completed", updated_at: now.toISOString() }).eq("slot_key", maintenanceKey);
  }
  return { recovered, planned, prepared, maintenance };
}
