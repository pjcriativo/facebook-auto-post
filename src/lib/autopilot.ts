import { getSettings, updateSettings } from "@/lib/db/settings";
import { createPostRecord } from "@/lib/db/posts";
import { publishPostNow } from "@/lib/facebook/publish";
import { generateContent } from "@/lib/ai/text";
import { generateImage } from "@/lib/ai/image";
import { listTemplates } from "@/lib/db/templates";
import { renderTemplate } from "@/lib/templates/render";
import { renderPhotoOverlay } from "@/lib/images/overlay";
import { getTrendingTopics } from "@/lib/trends";
import { markTopicUsed, nextTopic, TopicsTableMissingError } from "@/lib/db/topics";
import { decideTopicOrigin } from "@/lib/topic-origin";
import { getPageContentAgent } from "@/lib/db/agents";
import { supabaseAdmin } from "@/lib/supabase/server";
import { localParts, startOfTodayIso } from "@/lib/time";
import { isFacebookConnected } from "@/lib/types";
import { buildContentStrategy } from "@/lib/content-strategy";
import type { Post, Topic, TopicSource } from "@/lib/types";
import { randomUUID } from "node:crypto";

export type AutopilotResult =
  | { ran: true; post: Post }
  | {
      ran: false;
      reason:
        | "disabled"
        | "not_connected"
        | "no_default_page"
        | "outside_posting_hours"
        | "already_posted_this_slot"
        | "daily_quota_reached";
    };

/**
 * What the next autopilot post is about. The owner's own list wins unless the
 * setting says otherwise; trending ideas cover the gap while that list is
 * empty, and also on databases that predate topics entirely — autopilot must
 * keep working on an install that has not re-run schema.sql yet.
 */
async function chooseTopic(
  source: TopicSource | undefined,
  contentPillars: string[],
  recentTopics: string[]
): Promise<{ text: string; topic: Topic | null }> {
  let own: Topic | null = null;
  if (source !== "trending") {
    try {
      own = await nextTopic();
    } catch (err) {
      if (!(err instanceof TopicsTableMissingError)) throw err;
    }
  }

  const localChoice = own?.text ?? contentPillars
    .filter((pillar) => pillar.trim())
    .sort((a, b) => {
      const aIndex = recentTopics.indexOf(a.trim().toLocaleLowerCase());
      const bIndex = recentTopics.indexOf(b.trim().toLocaleLowerCase());
      return (aIndex < 0 ? Number.MIN_SAFE_INTEGER : -aIndex) - (bIndex < 0 ? Number.MIN_SAFE_INTEGER : -bIndex);
    })[0];
  if (localChoice && decideTopicOrigin(source, true, Math.random()) === "mine") {
    return { text: localChoice, topic: own };
  }

  const { topics } = await getTrendingTopics();
  const freshTopics = topics.filter((topic) => !recentTopics.includes(topic.trim().toLocaleLowerCase()));
  const pool = freshTopics.length ? freshTopics : topics;
  return { text: pool[Math.floor(Math.random() * pool.length)], topic: null };
}

/**
 * The "fully automatic" half of the product: on each cron tick, decide
 * whether it is time to invent a fresh post on its own (no human in the
 * loop) and, if so, do it — pick a topic, write the copy, source the
 * image, and publish. Called once per cron invocation; safe to call more
 * often than the posting cadence since every guard is idempotent.
 */
export async function maybeRunAutopilot(): Promise<AutopilotResult> {
  const settings = await getSettings();

  if (!settings.auto_post_enabled) return { ran: false, reason: "disabled" };
  if (!isFacebookConnected(settings)) return { ran: false, reason: "not_connected" };
  if (!settings.default_page_id || !settings.default_page_token) {
    return { ran: false, reason: "no_default_page" };
  }

  const { dateKey, hour } = localParts(new Date(), settings.timezone);
  if (!settings.posting_hours.includes(hour)) {
    return { ran: false, reason: "outside_posting_hours" };
  }

  if (settings.last_auto_post_at) {
    const last = localParts(new Date(settings.last_auto_post_at), settings.timezone);
    if (last.dateKey === dateKey && last.hour === hour) {
      return { ran: false, reason: "already_posted_this_slot" };
    }
  }

  const db = supabaseAdmin();
  const { count } = await db
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("status", "posted")
    .gte("posted_at", startOfTodayIso(settings.timezone));

  if ((count ?? 0) >= settings.posts_per_day) {
    return { ran: false, reason: "daily_quota_reached" };
  }

  // Vercel documents that the same cron event may occasionally be delivered
  // more than once. Claim this Page/hour slot atomically before spending any
  // credits so duplicate invocations cannot create duplicate posts.
  const slotKey = `${settings.default_page_id}:${dateKey}:${hour}`;
  const { error: claimError } = await db.from("autopilot_runs").insert({ slot_key: slotKey });
  if (claimError?.code === "23505") {
    return { ran: false, reason: "already_posted_this_slot" };
  }
  if (claimError) throw new Error(`Não foi possível reservar o horário automático: ${claimError.message}`);

  try {
  const generationId = randomUUID();
  const responsible = await getPageContentAgent(settings.default_page_id);
  const templates = await listTemplates();
  const strategy = await buildContentStrategy(
    settings,
    settings.default_page_id,
    responsible?.agent.id ?? null,
    templates
  );
  const chosen = await chooseTopic(
    settings.topic_source,
    responsible?.agent.content_pillars ?? [],
    strategy.recentTopics
  );
  const topic = chosen.text;
  const content = await generateContent(topic, generationId, {
    agent: responsible?.agent,
    language: responsible?.language,
  });
  const preferredOverlay = responsible?.agent.visual_strategy?.preferred_overlay;
  const overlayStyle = preferredOverlay === "card" || preferredOverlay === "center"
    ? preferredOverlay
    : "gradient";
  const photoThemes = Array.isArray(responsible?.agent.visual_strategy?.photo_themes)
    ? responsible.agent.visual_strategy.photo_themes.filter((item): item is string => typeof item === "string")
    : [];
  let image;
  let baseImageUrl: string | null = null;
  let usedImagePrompt: string | null = null;
  let usedTemplateId: string | null = null;
  const explore = strategy.ready && Math.random() < strategy.explorationRate;
  const strategicSource = settings.image_source === "mixed"
    ? explore
      ? strategy.recommendedSource === "ai" ? "stock" : "ai"
      : strategy.recommendedSource
    : settings.image_source;
  if (strategicSource === "template") {
    const compatible = templates.filter(
      (item) => item.enabled && (!item.page_id || item.page_id === settings.default_page_id)
    );
    const strategicTemplateId = explore ? strategy.explorationTemplateId : strategy.recommendedTemplateId;
    const template = compatible.find((item) => item.id === strategicTemplateId)
      ?? compatible.find((item) => item.id === settings.default_template_id)
      ?? compatible[0];
    if (!template) throw new Error("Ative pelo menos um template para o piloto automático.");
    usedTemplateId = template.id;
    image = await renderTemplate(
      template,
      content.artText || `${content.title}\n\n${content.description}`
    );
  } else {
    const baseVisualPrompt = strategicSource === "stock"
      ? content.stockQuery || content.imagePrompt || topic
      : content.imagePrompt || `${content.title} — ${topic}`;
    const visualPrompt = (photoThemes.length > 0
      ? `${baseVisualPrompt}. Preferred visual themes: ${photoThemes.join(", ")}`
      : baseVisualPrompt).slice(0, 700);
    usedImagePrompt = visualPrompt;
    const baseImage = await generateImage(visualPrompt, strategicSource);
    baseImageUrl = baseImage.url;
    image = await renderPhotoOverlay({
      imageUrl: baseImage.url,
      hook: content.imageHook || content.title,
      style: overlayStyle,
      pageId: settings.default_page_id,
    }, baseImage.source);
  }

  const draft = await createPostRecord({
    topic,
    title: content.title,
    description: content.description,
    hashtags: content.hashtags,
    image_url: image.url,
    image_source: image.source,
    base_image_url: baseImageUrl,
    image_hook: strategicSource === "template" ? null : content.imageHook || content.title,
    image_prompt: usedImagePrompt,
    overlay_style: strategicSource === "template" ? null : overlayStyle,
    link_url: null,
    page_id: settings.default_page_id,
    page_name: settings.default_page_name,
    scheduled_at: null,
    status: "draft",
    generation_id: generationId,
    template_id: usedTemplateId,
    agent_id: responsible?.agent.id ?? null,
    content_language: responsible?.language.locale ?? null,
    agent_prompt_version: responsible?.agent.prompt_version ?? null,
  });

  // Recorded once the draft exists, so a failure while generating does not
  // push the topic to the back of the rotation without a post to show for it.
  if (chosen.topic) await markTopicUsed(chosen.topic);

  const published = await publishPostNow(draft.id);
  await db.from("autopilot_runs").update({
    status: published.status === "posted" ? "posted" : "failed",
    post_id: published.id,
    error_message: published.error_message,
    updated_at: new Date().toISOString(),
  }).eq("slot_key", slotKey);
  if (published.status === "posted") {
    await updateSettings({ last_auto_post_at: new Date().toISOString() });
  }

  return { ran: true, post: published };
  } catch (error) {
    await db.from("autopilot_runs").update({
      status: "failed",
      error_message: error instanceof Error ? error.message : "Falha inesperada no piloto automático.",
      updated_at: new Date().toISOString(),
    }).eq("slot_key", slotKey);
    throw error;
  }
}
