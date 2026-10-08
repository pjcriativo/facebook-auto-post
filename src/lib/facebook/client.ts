import { supabaseAdmin } from "@/lib/supabase/server";
import { GRAPH_BASE } from "@/lib/facebook/oauth";
import type { AppSettings } from "@/lib/types";

export class FacebookNotConnectedError extends Error {
  constructor() {
    super("O Facebook não está conectado. Conecte-o primeiro em Configurações.");
  }
}

export class NoPageSelectedError extends Error {
  constructor() {
    super("Nenhuma Página do Facebook foi selecionada. Escolha uma na tela Páginas.");
  }
}

async function loadSettings(): Promise<AppSettings> {
  const db = supabaseAdmin();
  const { data } = await db.from("app_settings").select("*").eq("id", 1).single<AppSettings>();
  if (!data) throw new Error("A linha de configurações não foi encontrada.");
  return data;
}

async function graph(path: string, params: Record<string, string>, init?: RequestInit) {
  const url = `${GRAPH_BASE}${path}`;
  const res = await fetch(init?.method === "POST" ? url : `${url}?${new URLSearchParams(params)}`, {
    ...init,
    ...(init?.method === "POST"
      ? {
          headers: { "Content-Type": "application/x-www-form-urlencoded", ...init?.headers },
          body: new URLSearchParams(params),
        }
      : {}),
    signal: AbortSignal.timeout(30_000),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || body?.error) {
    throw new Error(body?.error?.message ?? `A API do Facebook falhou em ${path} (${res.status})`);
  }
  return body;
}

export interface FacebookPage {
  id: string;
  name: string;
  category: string | null;
  username: string | null;
  picture_url: string | null;
  /** Non-expiring when minted from a long-lived user token. */
  access_token: string;
}

function pageReference(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Informe a URL, o nome de usuário ou o ID da Página.");

  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    if (!["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname.toLowerCase())) {
      throw new Error("Use uma URL do Facebook ou o ID da Página.");
    }
    const segment = url.pathname.split("/").filter(Boolean)[0];
    if (!segment || ["pages", "profile.php"].includes(segment.toLowerCase())) {
      const id = url.searchParams.get("id");
      if (id) return id;
      throw new Error("Não foi possível identificar a Página nessa URL.");
    }
    return segment;
  } catch (err) {
    if (/^https?:\/\//i.test(trimmed) || trimmed.includes("facebook.com")) {
      throw err instanceof Error ? err : new Error("URL da Página inválida.");
    }
    return trimmed.replace(/^@/, "");
  }
}

/**
 * Resolves one Page explicitly. Meta sometimes omits business-portfolio Pages
 * from `/me/accounts` even though the same user token can mint their Page
 * token. A direct lookup is both the fallback and the authorization check:
 * users without Page access do not receive `access_token` here.
 */
export async function fetchPage(reference: string): Promise<FacebookPage> {
  const settings = await loadSettings();
  if (!settings.facebook_user_token) throw new FacebookNotConnectedError();

  const ref = pageReference(reference);
  const data = await graph(`/${encodeURIComponent(ref)}`, {
    access_token: settings.facebook_user_token,
    fields: "id,name,category,username,picture.type(large){url},access_token",
  });
  if (!data.id || !data.name || !data.access_token) {
    throw new Error("A conta conectada não tem permissão para publicar nessa Página.");
  }
  return {
    id: data.id,
    name: data.name,
    category: data.category ?? null,
    username: data.username ?? null,
    picture_url: data.picture?.data?.url ?? null,
    access_token: data.access_token,
  };
}

/**
 * Every Page this person can create content on. `tasks` is filtered rather
 * than trusted wholesale: being able to see a Page does not mean being allowed
 * to publish to it, and finding that out at post time would be far worse.
 */
export async function fetchPages(): Promise<FacebookPage[]> {
  const settings = await loadSettings();
  if (!settings.facebook_user_token) throw new FacebookNotConnectedError();

  const pages: FacebookPage[] = [];
  let after: string | undefined;

  do {
    const params: Record<string, string> = {
      access_token: settings.facebook_user_token,
      fields: "id,name,category,username,picture.type(large){url},access_token,tasks",
      limit: "100",
    };
    if (after) params.after = after;

    const data = await graph("/me/accounts", params);
    for (const p of data.data ?? []) {
      if (Array.isArray(p.tasks) && !p.tasks.includes("CREATE_CONTENT")) continue;
      pages.push({
        id: p.id,
        name: p.name,
        category: p.category ?? null,
        username: p.username ?? null,
        picture_url: p.picture?.data?.url ?? null,
        access_token: p.access_token,
      });
    }
    after = data.paging?.cursors?.after && data.paging?.next ? data.paging.cursors.after : undefined;
  } while (after);

  return pages;
}

/** Permissions this app cannot work without. */
export const REQUIRED_PERMISSIONS = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
];

/**
 * Which of the required permissions the connected account actually granted.
 *
 * Worth checking explicitly: when the Meta app uses Login for Business the
 * permissions come from a saved configuration, so a configuration missing
 * `pages_manage_posts` connects perfectly and then fails at publish time with a
 * bare "(#200) Permissions error" that names nothing.
 */
export async function missingPermissions(userToken: string): Promise<string[]> {
  try {
    const data = await graph("/me/permissions", { access_token: userToken });
    const granted = new Set(
      (data.data ?? [])
        .filter((p: { status: string }) => p.status === "granted")
        .map((p: { permission: string }) => p.permission)
    );
    return REQUIRED_PERMISSIONS.filter((p) => !granted.has(p));
  } catch {
    return [];
  }
}

export async function fetchAccount(): Promise<{ name: string }> {
  const settings = await loadSettings();
  if (!settings.facebook_user_token) throw new FacebookNotConnectedError();
  const data = await graph("/me", { access_token: settings.facebook_user_token, fields: "name" });
  return { name: data.name };
}

export interface PublishPhotoInput {
  pageId: string;
  pageToken: string;
  message: string;
  imageUrl: string;
}

/**
 * Publishes a photo post. Meta fetches the image from `url` itself, which is
 * why every generated image is re-hosted on Supabase Storage first — a
 * best-effort free provider's URL would not be a safe thing for Facebook's
 * crawler to depend on.
 */
export async function publishPhoto(input: PublishPhotoInput): Promise<{ id: string }> {
  const data = await graph(
    `/${input.pageId}/photos`,
    {
      url: input.imageUrl,
      message: input.message,
      access_token: input.pageToken,
      published: "true",
    },
    { method: "POST" }
  );
  return { id: data.post_id ?? data.id };
}

/** Stable engagement fields available on Page posts with pages_read_engagement. */
export async function fetchPostEngagement(
  facebookPostId: string,
  pageToken: string
): Promise<{
  reactions: number;
  comments: number;
  shares: number;
  permalinkUrl: string | null;
  raw: Record<string, unknown>;
}> {
  const path = `/${encodeURIComponent(facebookPostId)}`;
  let commentsAvailable = true;
  let data;
  try {
    data = await graph(path, {
      access_token: pageToken,
      fields: "permalink_url,shares,reactions.limit(0).summary(true),comments.limit(0).summary(true)",
    });
  } catch (error) {
    // Visitor-content access is optional and must never block login or the
    // remaining Page metrics available through pages_read_engagement.
    if (!(error instanceof Error) || !/pages_read_user_content/i.test(error.message)) throw error;
    commentsAvailable = false;
    data = await graph(path, {
      access_token: pageToken,
      fields: "permalink_url,shares,reactions.limit(0).summary(true)",
    });
  }
  return {
    reactions: Math.max(0, Number(data.reactions?.summary?.total_count ?? 0)),
    comments: Math.max(0, Number(data.comments?.summary?.total_count ?? 0)),
    shares: Math.max(0, Number(data.shares?.count ?? 0)),
    permalinkUrl: typeof data.permalink_url === "string" ? data.permalink_url : null,
    raw: { ...data, comments_available: commentsAvailable } as Record<string, unknown>,
  };
}
