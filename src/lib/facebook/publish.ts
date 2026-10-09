import { getPageAccessToken, publishPhoto, NoPageSelectedError } from "@/lib/facebook/client";
import { getPost, updatePostRecord } from "@/lib/db/posts";
import { getSettings } from "@/lib/db/settings";
import { composeMessage } from "@/lib/types";
import type { Post } from "@/lib/types";
import { getPublicationJob, updatePageAutomation, updatePublicationJob } from "@/lib/db/page-automation";

/**
 * Publishes one queued post to its Facebook Page and records the outcome.
 * Shared by the "post now" route and the scheduled-queue cron worker so there
 * is exactly one place that talks to the Graph publish endpoint.
 */
export async function publishPostNow(postId: string): Promise<Post> {
  const post = await getPost(postId);
  if (!post) throw new Error("Post não encontrado.");

  const settings = await getSettings();

  // A manual post may target any Page shown in the selector. Keep the cached
  // token for the default Page, but mint the chosen Page's token server-side
  // when it differs (or when no default has been configured yet).
  const pageId = post.page_id ?? settings.default_page_id;
  let pageToken =
    post.page_id && post.page_id !== settings.default_page_id ? null : settings.default_page_token;

  if (!pageId) {
    return updatePostRecord(postId, {
      status: "failed",
      error_message: new NoPageSelectedError().message,
    });
  }

  try {
    if (!pageToken) {
      pageToken = await getPageAccessToken(pageId);
    }
    const result = await publishPhoto({
      pageId,
      pageToken,
      message: composeMessage(post, settings.utm_suffix),
      imageUrl: post.image_url,
    });

    const published = await updatePostRecord(postId, {
      status: "posted",
      facebook_post_id: result.id,
      posted_at: new Date().toISOString(),
      error_message: null,
    });
    if (post.publication_job_id) {
      await updatePublicationJob(post.publication_job_id, {
        status: "published",
        error_message: null,
        locked_by: null,
        lease_until: null,
      });
      await updatePageAutomation(pageId, { last_published_at: published.posted_at });
    }
    return published;
  } catch (err) {
    let message = err instanceof Error ? err.message : "Erro desconhecido durante a publicação.";

    // Facebook reports a token that lacks pages_manage_posts as a bare
    // "(#200) Permissions error", which says nothing about what to fix.
    if (/\(#200\)|permissions? error/i.test(message)) {
      message =
        "O Facebook rejeitou a publicação por falta de permissões. O token conectado precisa de " +
        "pages_manage_posts. Adicione essa permissão ao aplicativo Meta e também à configuração " +
        "do Login for Business, se estiver usando uma. Depois, desconecte e conecte novamente " +
        "para emitir um novo token.";
    }

    const failed = await updatePostRecord(postId, { status: "failed", error_message: message });
    if (!post.publication_job_id) return failed;

    const job = await getPublicationJob(post.publication_job_id);
    const attempts = (job?.attempts ?? 0) + 1;
    if (job && attempts < job.max_attempts) {
      const retryAt = new Date(Date.now() + attempts * 15 * 60_000).toISOString();
      await updatePublicationJob(job.id, {
        status: "retry",
        attempts,
        next_retry_at: retryAt,
        error_message: message,
      });
      return updatePostRecord(postId, { status: "scheduled", scheduled_at: retryAt });
    }
    await updatePublicationJob(post.publication_job_id, {
      status: "failed",
      attempts,
      error_message: message,
    });
    return failed;
  }
}
