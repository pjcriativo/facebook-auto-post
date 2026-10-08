import { fetchPage, publishPhoto, NoPageSelectedError } from "@/lib/facebook/client";
import { getPost, updatePostRecord } from "@/lib/db/posts";
import { getSettings } from "@/lib/db/settings";
import { composeMessage } from "@/lib/types";
import type { Post } from "@/lib/types";

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
      const selectedPage = await fetchPage(pageId);
      pageToken = selectedPage.access_token;
    }
    const result = await publishPhoto({
      pageId,
      pageToken,
      message: composeMessage(post, settings.utm_suffix),
      imageUrl: post.image_url,
    });

    return await updatePostRecord(postId, {
      status: "posted",
      facebook_post_id: result.id,
      posted_at: new Date().toISOString(),
      error_message: null,
    });
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

    return await updatePostRecord(postId, { status: "failed", error_message: message });
  }
}
