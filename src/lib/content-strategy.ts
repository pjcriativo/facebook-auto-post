import { listPosts } from "@/lib/db/posts";
import { listTemplates } from "@/lib/db/templates";
import { supabaseAdmin } from "@/lib/supabase/server";
import { localParts } from "@/lib/time";
import type { AppSettings, ContentTemplate, ImageSource, PostMetricSnapshot } from "@/lib/types";

interface Score {
  id: string;
  label: string;
  posts: number;
  averageScore: number;
  shares: number;
}

export interface ContentStrategyReport {
  enabled: boolean;
  ready: boolean;
  sampleCount: number;
  minSamples: number;
  explorationRate: number;
  configuredSource: AppSettings["image_source"];
  recommendedSource: ImageSource | "mixed";
  recommendedTemplateId: string | null;
  recommendedTemplateName: string | null;
  explorationTemplateId: string | null;
  bestHours: number[];
  formatScores: Score[];
  templateScores: Score[];
  insights: string[];
  recentTopics: string[];
}

function rank<T>(
  rows: T[],
  identify: (row: T) => { id: string; label: string },
  metric: (row: T) => PostMetricSnapshot
): Score[] {
  const groups = new Map<string, Score & { total: number }>();
  for (const row of rows) {
    const item = identify(row);
    const snapshot = metric(row);
    const current = groups.get(item.id) ?? { ...item, posts: 0, averageScore: 0, shares: 0, total: 0 };
    current.posts += 1;
    current.total += Number(snapshot.viral_score);
    current.shares += snapshot.shares;
    groups.set(item.id, current);
  }
  return [...groups.values()]
    .map(({ total, ...item }) => ({ ...item, averageScore: Number((total / item.posts).toFixed(1)) }))
    .sort((a, b) => b.averageScore - a.averageScore || b.shares - a.shares || b.posts - a.posts);
}

export async function buildContentStrategy(
  settings: AppSettings,
  pageId: string | null,
  agentId: string | null,
  suppliedTemplates?: ContentTemplate[]
): Promise<ContentStrategyReport> {
  const posts = (await listPosts({ status: "posted", limit: 500 })).filter(
    (post) => (!pageId || post.page_id === pageId) && (!agentId || post.agent_id === agentId)
  );
  const db = supabaseAdmin();
  const snapshotResult = posts.length
    ? await db.from("post_metric_snapshots").select("*").in("post_id", posts.map((post) => post.id)).order("fetched_at", { ascending: false })
    : { data: [], error: null };
  if (snapshotResult.error) throw new Error(`Não foi possível preparar a estratégia: ${snapshotResult.error.message}`);

  const latest = new Map<string, PostMetricSnapshot>();
  for (const item of snapshotResult.data ?? []) {
    if (!latest.has(item.post_id)) latest.set(item.post_id, item as PostMetricSnapshot);
  }
  const measured = posts.flatMap((post) => {
    const metric = latest.get(post.id);
    return metric ? [{ post, metric }] : [];
  });
  const templates = suppliedTemplates ?? await listTemplates();
  const compatibleTemplates = templates.filter((template) => template.enabled && (!template.page_id || template.page_id === pageId));
  const templateNames = new Map(templates.map((template) => [template.id, template.name]));
  const minSamples = Math.max(1, Number(settings.strategy_min_samples ?? 3));
  const enabled = settings.strategy_optimization_enabled !== false;
  const explorationRate = Math.min(0.5, Math.max(0, Number(settings.strategy_exploration_rate ?? 0.15)));

  const formatScores = rank(measured, ({ post }) => ({ id: post.image_source, label: post.image_source }), ({ metric }) => metric);
  const templateScores = rank(
    measured.filter(({ post }) => Boolean(post.template_id)),
    ({ post }) => ({ id: post.template_id!, label: templateNames.get(post.template_id!) ?? "Template removido" }),
    ({ metric }) => metric
  );
  const hourScores = rank(
    measured.filter(({ post }) => Boolean(post.posted_at)),
    ({ post }) => {
      const hour = localParts(new Date(post.posted_at!), settings.timezone).hour;
      return { id: String(hour), label: `${String(hour).padStart(2, "0")}:00` };
    },
    ({ metric }) => metric
  );
  const eligibleFormats = formatScores.filter((item) => item.posts >= minSamples);
  const eligibleTemplates = templateScores.filter(
    (item) => item.posts >= minSamples && compatibleTemplates.some((template) => template.id === item.id)
  );

  let recommendedSource: ContentStrategyReport["recommendedSource"] = settings.image_source;
  if (enabled && settings.image_source === "mixed") {
    recommendedSource = (eligibleFormats.find((item) => item.id === "stock" || item.id === "ai")?.id as ImageSource | undefined) ?? "stock";
  }
  const defaultTemplate = compatibleTemplates.find((item) => item.id === settings.default_template_id) ?? compatibleTemplates[0] ?? null;
  const winningTemplate = eligibleTemplates[0]
    ? compatibleTemplates.find((item) => item.id === eligibleTemplates[0].id) ?? null
    : null;
  const recommendedTemplate = enabled ? winningTemplate ?? defaultTemplate : defaultTemplate;
  const templateCounts = new Map(templateScores.map((item) => [item.id, item.posts]));
  const explorationTemplate = [...compatibleTemplates]
    .filter((item) => item.id !== recommendedTemplate?.id)
    .sort((a, b) => (templateCounts.get(a.id) ?? 0) - (templateCounts.get(b.id) ?? 0))[0] ?? null;
  const bestHours = hourScores.filter((item) => item.posts >= minSamples).slice(0, 5).map((item) => Number(item.id));
  const insights: string[] = [];
  if (!enabled) insights.push("O aprendizado automático está pausado; o Copiloto seguirá apenas as escolhas manuais.");
  else if (measured.length < minSamples) insights.push(`Faltam ${minSamples - measured.length} posts medidos para a primeira decisão automática segura.`);
  else insights.push(`A estratégia já possui ${measured.length} posts medidos desta Página${agentId ? " e agente" : ""}.`);
  if (settings.image_source === "template" && recommendedTemplate) {
    insights.push(`${recommendedTemplate.name} é o template principal atual; alternativas recebem testes controlados de ${Math.round(explorationRate * 100)}%.`);
  }
  if (bestHours.length) insights.push(`Melhores horários observados: ${bestHours.map((hour) => `${String(hour).padStart(2, "0")}:00`).join(", ")}.`);
  insights.push("O sistema nunca troca uma fonte visual fixa; a otimização entre foto e IA só ocorre quando a opção “Combinar” está selecionada.");

  return {
    enabled,
    ready: enabled && measured.length >= minSamples,
    sampleCount: measured.length,
    minSamples,
    explorationRate,
    configuredSource: settings.image_source,
    recommendedSource,
    recommendedTemplateId: recommendedTemplate?.id ?? null,
    recommendedTemplateName: recommendedTemplate?.name ?? null,
    explorationTemplateId: explorationTemplate?.id ?? null,
    bestHours,
    formatScores,
    templateScores,
    insights,
    recentTopics: posts.slice(0, 30).map((post) => post.topic.trim().toLocaleLowerCase()),
  };
}

