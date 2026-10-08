import { listAgents } from "@/lib/db/agents";
import { listPosts } from "@/lib/db/posts";
import { getSettings } from "@/lib/db/settings";
import { fetchPage, fetchPostEngagement } from "@/lib/facebook/client";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { PostMetricSnapshot } from "@/lib/types";

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
        viral_score: viralScore,
        permalink_url: metric.permalinkUrl,
        raw_data: metric.raw,
      });
      if (error) throw new Error(error.message);
      updated += 1;
    } catch (error) {
      const original = error instanceof Error ? error.message : String(error);
      const message = /pages_read_user_content/i.test(original)
        ? "Reconecte o Facebook concedendo pages_read_user_content para ler reações e comentários."
        : original;
      failures.push({ postId: post.id, error: message });
    }
  }

  return { checked: posts.length, updated, skipped, failures };
}

export async function analyticsReport() {
  const [posts, agents, snapshotResult] = await Promise.all([
    listPosts({ status: "posted", limit: 500 }),
    listAgents(),
    supabaseAdmin().from("post_metric_snapshots").select("*").order("fetched_at", { ascending: false }).limit(3000),
  ]);
  if (snapshotResult.error) throw new Error(`Não foi possível carregar as métricas: ${snapshotResult.error.message}`);

  const latest = new Map<string, PostMetricSnapshot>();
  for (const row of snapshotResult.data ?? []) {
    if (!latest.has(row.post_id)) latest.set(row.post_id, row as PostMetricSnapshot);
  }
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
  const rows = posts.map((post) => ({ post, metric: latest.get(post.id) ?? null }));
  const totals = rows.reduce((sum, row) => ({
    posts: sum.posts + 1,
    measured: sum.measured + (row.metric ? 1 : 0),
    reactions: sum.reactions + (row.metric?.reactions ?? 0),
    comments: sum.comments + (row.metric?.comments ?? 0),
    shares: sum.shares + (row.metric?.shares ?? 0),
    viralScore: sum.viralScore + Number(row.metric?.viral_score ?? 0),
  }), { posts: 0, measured: 0, reactions: 0, comments: 0, shares: 0, viralScore: 0 });

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

  return {
    totals,
    lastSyncedAt: [...latest.values()].map((item) => item.fetched_at).sort().at(-1) ?? null,
    agents: [...grouped.values()].sort((a, b) => b.viralScore - a.viralScore),
    topPosts: rows.filter((row) => row.metric).sort((a, b) => Number(b.metric!.viral_score) - Number(a.metric!.viral_score)).slice(0, 20).map(({ post, metric }) => ({
      id: post.id,
      title: post.title,
      pageName: post.page_name,
      postedAt: post.posted_at,
      imageUrl: post.image_url,
      agentId: post.agent_id ?? null,
      agentName: post.agent_id ? agentNames.get(post.agent_id) ?? "Agente removido" : "Redator global",
      language: post.content_language ?? null,
      reactions: metric!.reactions,
      comments: metric!.comments,
      shares: metric!.shares,
      viralScore: Number(metric!.viral_score),
      permalinkUrl: metric!.permalink_url,
      fetchedAt: metric!.fetched_at,
    })),
  };
}
