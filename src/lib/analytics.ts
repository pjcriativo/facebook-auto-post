import { listAgents } from "@/lib/db/agents";
import { listPosts } from "@/lib/db/posts";
import { getSettings } from "@/lib/db/settings";
import { listTemplates } from "@/lib/db/templates";
import { KIE_CREDIT_USD } from "@/lib/ai/usage";
import { fetchPage, fetchPostEngagement } from "@/lib/facebook/client";
import { supabaseAdmin } from "@/lib/supabase/server";
import { localParts } from "@/lib/time";
import type { PostMetricSnapshot } from "@/lib/types";
import { buildContentStrategy } from "@/lib/content-strategy";

const DEFAULT_REFRESH_HOURS = 6;

export async function syncPublishedPostMetrics(options: {
  limit?: number;
  force?: boolean;
} = {}) {
  const limit = Math.min(100, Math.max(1, options.limit ?? 30));
  const posts = (await listPosts({ status: "posted", limit })).filter(
    (post) => post.facebook_post_id && post.page_id
  );
  if (posts.length === 0) return { checked: 0, updated: 0, skipped: 0, failures: [] as Array<{ postId: string; error: string }> };

  const db = supabaseAdmin();
  const { data: previous } = await db
    .from("post_metric_snapshots")
    .select("post_id,fetched_at")
    .in("post_id", posts.map((post) => post.id))
    .order("fetched_at", { ascending: false });
  const latest = new Map<string, string>();
  for (const row of previous ?? []) if (!latest.has(row.post_id)) latest.set(row.post_id, row.fetched_at);

  const settings = await getSettings();
  const pageTokens = new Map<string, string>();
  if (settings.default_page_id && settings.default_page_token) {
    pageTokens.set(settings.default_page_id, settings.default_page_token);
  }

  let updated = 0;
  let skipped = 0;
  const failures: Array<{ postId: string; error: string }> = [];
  const freshAfter = Date.now() - DEFAULT_REFRESH_HOURS * 60 * 60 * 1000;

  for (const post of posts) {
    const fetchedAt = latest.get(post.id);
    if (!options.force && fetchedAt && new Date(fetchedAt).getTime() >= freshAfter) {
      skipped += 1;
      continue;
    }
    try {
      let token = pageTokens.get(post.page_id!);
      if (!token) {
        const page = await fetchPage(post.page_id!);
        token = page.access_token;
        pageTokens.set(post.page_id!, token);
      }
      const metric = await fetchPostEngagement(post.facebook_post_id!, token);
      const viralScore = metric.reactions + metric.comments * 3 + metric.shares * 5;
      const { error } = await db.from("post_metric_snapshots").insert({
        post_id: post.id,
        page_id: post.page_id,
        facebook_post_id: post.facebook_post_id,
        reactions: metric.reactions,
        comments: metric.comments,
        shares: metric.shares,
        clicks: metric.clicks,
        views: metric.views,
        metric_source: metric.source,
        viral_score: viralScore,
        permalink_url: metric.permalinkUrl,
        raw_data: metric.raw,
      });
      if (error) throw new Error(error.message);
      updated += 1;
    } catch (error) {
      const original = error instanceof Error ? error.message : String(error);
      const message = /pages_read_engagement/i.test(original)
        ? "Reconecte o Facebook concedendo pages_read_engagement para ler as métricas da Página."
        : original;
      failures.push({ postId: post.id, error: message });
    }
  }

  return { checked: posts.length, updated, skipped, failures };
}

export async function analyticsReport() {
  const [posts, agents, templates, settings, snapshotResult] = await Promise.all([
    listPosts({ status: "posted", limit: 500 }),
    listAgents(),
    listTemplates(),
    getSettings(),
    supabaseAdmin().from("post_metric_snapshots").select("*").order("fetched_at", { ascending: false }).limit(3000),
  ]);
  if (snapshotResult.error) throw new Error(`Não foi possível carregar as métricas: ${snapshotResult.error.message}`);

  const generationIds = posts.map((post) => post.generation_id).filter((id): id is string => Boolean(id));
  const usageResult = generationIds.length
    ? await supabaseAdmin().from("ai_usage").select("generation_id,credits_used,status").in("generation_id", generationIds)
    : { data: [], error: null };
  if (usageResult.error) throw new Error(`Não foi possível relacionar os custos: ${usageResult.error.message}`);
  const creditsByGeneration = new Map<string, number>();
  for (const item of usageResult.data ?? []) {
    if (item.status !== "success" || !item.generation_id) continue;
    creditsByGeneration.set(item.generation_id, (creditsByGeneration.get(item.generation_id) ?? 0) + Number(item.credits_used ?? 0));
  }

  const latest = new Map<string, PostMetricSnapshot>();
  for (const row of snapshotResult.data ?? []) {
    if (!latest.has(row.post_id)) latest.set(row.post_id, row as PostMetricSnapshot);
  }
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
  const templateNames = new Map(templates.map((template) => [template.id, template.name]));
  const rows = posts.map((post) => ({
    post,
    metric: latest.get(post.id) ?? null,
    credits: post.generation_id ? creditsByGeneration.get(post.generation_id) ?? 0 : 0,
    hour: post.posted_at ? localParts(new Date(post.posted_at), settings.timezone).hour : null,
  }));
  const totals = rows.reduce((sum, row) => ({
    posts: sum.posts + 1,
    measured: sum.measured + (row.metric ? 1 : 0),
    reactions: sum.reactions + (row.metric?.reactions ?? 0),
    comments: sum.comments + (row.metric?.comments ?? 0),
    shares: sum.shares + (row.metric?.shares ?? 0),
    clicks: sum.clicks + (row.metric?.clicks ?? 0),
    views: sum.views + (row.metric?.views ?? 0),
    viralScore: sum.viralScore + Number(row.metric?.viral_score ?? 0),
    credits: sum.credits + row.credits,
  }), { posts: 0, measured: 0, reactions: 0, comments: 0, shares: 0, clicks: 0, views: 0, viralScore: 0, credits: 0 });

  const grouped = new Map<string, { agentId: string | null; agentName: string; posts: number; measured: number; reactions: number; comments: number; shares: number; viralScore: number }>();
  for (const row of rows) {
    const key = row.post.agent_id ?? "global";
    const current = grouped.get(key) ?? { agentId: row.post.agent_id ?? null, agentName: row.post.agent_id ? agentNames.get(row.post.agent_id) ?? "Agente removido" : "Redator global", posts: 0, measured: 0, reactions: 0, comments: 0, shares: 0, viralScore: 0 };
    current.posts += 1;
    if (row.metric) current.measured += 1;
    current.reactions += row.metric?.reactions ?? 0;
    current.comments += row.metric?.comments ?? 0;
    current.shares += row.metric?.shares ?? 0;
    current.viralScore += Number(row.metric?.viral_score ?? 0);
    grouped.set(key, current);
  }

  function breakdown(getLabel: (row: typeof rows[number]) => string) {
    const groups = new Map<string, { label: string; posts: number; measured: number; shares: number; viralScore: number; credits: number }>();
    for (const row of rows) {
      const label = getLabel(row);
      const current = groups.get(label) ?? { label, posts: 0, measured: 0, shares: 0, viralScore: 0, credits: 0 };
      current.posts += 1;
      current.credits += row.credits;
      if (row.metric) {
        current.measured += 1;
        current.shares += row.metric.shares;
        current.viralScore += Number(row.metric.viral_score);
      }
      groups.set(label, current);
    }
    return [...groups.values()].map((item) => ({
      ...item,
      averageScore: item.measured ? Number((item.viralScore / item.measured).toFixed(1)) : 0,
      estimatedUsd: Number((item.credits * KIE_CREDIT_USD).toFixed(4)),
    })).sort((a, b) => b.averageScore - a.averageScore);
  }

  const sourceLabels: Record<string, string> = { template: "Template reutilizável", stock: "Foto gratuita", ai: "Imagem por IA" };
  const languageLabels: Record<string, string> = { "pt-BR": "Português", "en-US": "Inglês", "es-419": "Espanhol", "de-DE": "Alemão", "fr-FR": "Francês" };
  const breakdowns = {
    imageSource: breakdown((row) => sourceLabels[row.post.image_source] ?? row.post.image_source),
    language: breakdown((row) => languageLabels[row.post.content_language ?? ""] ?? row.post.content_language ?? "Sem idioma registrado"),
    hour: breakdown((row) => row.hour == null ? "Sem horário" : `${String(row.hour).padStart(2, "0")}:00`),
    template: breakdown((row) => row.post.template_id ? templateNames.get(row.post.template_id) ?? "Template removido" : "Sem template"),
  };
  const recommendations: string[] = [];
  const limitedMetrics = rows.filter((row) => row.metric?.metric_source === "post_insights").length;
  if (limitedMetrics > 0) {
    recommendations.push(`${limitedMetrics} post(s) usam Insights básicos; comentários e compartilhamentos serão incluídos após a permissão avançada da Meta.`);
  }
  if (totals.measured === 0) {
    recommendations.push("Sincronize as métricas após reconectar a Meta para liberar comparações e recomendações.");
  } else {
    const bestSource = breakdowns.imageSource.find((item) => item.measured > 0 && item.averageScore > 0);
    const bestHour = breakdowns.hour.find((item) => item.measured > 0 && item.averageScore > 0 && item.label !== "Sem horário");
    const bestLanguage = breakdowns.language.find((item) => item.measured > 0 && item.averageScore > 0 && item.label !== "Sem idioma registrado");
    if (bestSource) recommendations.push(`${bestSource.label} lidera com média de ${bestSource.averageScore} pontos virais por post medido.`);
    if (bestHour) recommendations.push(`O horário com melhor média até agora é ${bestHour.label}; teste mais publicações próximas desse horário antes de torná-lo padrão.`);
    if (bestLanguage) recommendations.push(`${bestLanguage.label} apresenta a melhor média atual entre os idiomas medidos.`);
    if (totals.shares === 0) recommendations.push("Ainda não houve compartilhamentos nos posts medidos; teste ganchos mais curtos e mensagens que funcionem fora do contexto da legenda.");
  }

  const strategyAgentId = agents.find((agent) =>
    agent.page_assignments?.some((assignment) => assignment.page_id === settings.default_page_id)
  )?.id ?? null;
  const strategy = await buildContentStrategy(settings, settings.default_page_id, strategyAgentId, templates);

  return {
    totals: {
      ...totals,
      credits: Number(totals.credits.toFixed(3)),
      estimatedUsd: Number((totals.credits * KIE_CREDIT_USD).toFixed(4)),
    },
    lastSyncedAt: [...latest.values()].map((item) => item.fetched_at).sort().at(-1) ?? null,
    agents: [...grouped.values()].sort((a, b) => b.viralScore - a.viralScore),
    breakdowns,
    recommendations,
    strategy,
    topPosts: rows.filter((row) => row.metric).sort((a, b) => Number(b.metric!.viral_score) - Number(a.metric!.viral_score)).slice(0, 20).map(({ post, metric, credits, hour }) => ({
      id: post.id,
      title: post.title,
      pageName: post.page_name,
      postedAt: post.posted_at,
      imageUrl: post.image_url,
      agentId: post.agent_id ?? null,
      agentName: post.agent_id ? agentNames.get(post.agent_id) ?? "Agente removido" : "Redator global",
      language: post.content_language ?? null,
      imageSource: post.image_source,
      templateName: post.template_id ? templateNames.get(post.template_id) ?? "Template removido" : null,
      postingHour: hour,
      credits,
      estimatedUsd: Number((credits * KIE_CREDIT_USD).toFixed(4)),
      reactions: metric!.reactions,
      comments: metric!.comments,
      shares: metric!.shares,
      clicks: metric!.clicks ?? 0,
      views: metric!.views ?? 0,
      metricSource: metric!.metric_source ?? "graph_fields",
      viralScore: Number(metric!.viral_score),
      permalinkUrl: metric!.permalink_url,
      fetchedAt: metric!.fetched_at,
    })),
  };
}
