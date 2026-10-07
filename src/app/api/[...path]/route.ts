import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifySessionToken,
} from "@/lib/auth/session";
import { generateContent } from "@/lib/ai/text";
import { generateImage } from "@/lib/ai/image";
import { getTrendingTopics } from "@/lib/trends";
import {
  createPostRecord,
  deletePostRecord,
  getPost,
  listDuePosts,
  listPosts,
  updatePostRecord,
} from "@/lib/db/posts";
import { getSettings, updateSettings } from "@/lib/db/settings";
import {
  addTopics,
  deleteTopic,
  listTopics,
  MAX_TOPIC_LENGTH,
  nextTopic,
  TopicsTableMissingError,
  updateTopic,
} from "@/lib/db/topics";
import {
  fetchAccount,
  fetchPages,
  missingPermissions,
  FacebookNotConnectedError,
} from "@/lib/facebook/client";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
} from "@/lib/facebook/oauth";
import { getFacebookCredentials, isFacebookConfigured } from "@/lib/facebook/credentials";
import { OAUTH_STATE_COOKIE } from "@/lib/facebook/oauth-state";
import { publishPostNow } from "@/lib/facebook/publish";
import { maybeRunAutopilot } from "@/lib/autopilot";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { PostStatus } from "@/lib/types";

/**
 * Every API endpoint lives in this one catch-all handler on purpose.
 *
 * Next.js turns each `route.ts` into its own serverless function, and this
 * app's endpoints put the deployment over Vercel's per-deployment function
 * limit on the Hobby plan — the build succeeded every time and then died at
 * "Deploying outputs" with no log line explaining why. Collapsing them into one
 * dispatcher takes the deployment from ~16 functions to 2. The endpoint URLs
 * and behaviour are unchanged; only the file layout moved, and all real logic
 * still lives in `src/lib/*`.
 */

export const maxDuration = 60;

type Ctx = { params: Promise<{ path: string[] }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function notFound() {
  return json({ error: "Não encontrado." }, 404);
}

function unauthorized() {
  return json({ error: "Não autorizado." }, 401);
}

/**
 * Routes reachable without the admin session.
 *
 * Everything else requires it. This app stores Meta app credentials and
 * non-expiring Page tokens, and the middleware deliberately does not cover
 * `/api/*`, so without this check the whole API — read settings, publish,
 * delete, disconnect — would be open to anyone who knew the deployment's URL.
 * The OAuth callback is exempt because it is a redirect back from Facebook and
 * is already protected by its single-use `state` cookie.
 */
const OPEN_ROUTES = new Set(["auth/login", "auth/logout", "facebook/oauth/callback"]);

async function hasSession(req: Request): Promise<boolean> {
  const cookies = req.headers.get("cookie")?.split("; ") ?? [];
  const token = cookies
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`) || c.startsWith("pab_session="))
    ?.split("=")[1];
  return verifySessionToken(token);
}

/**
 * The cron route authenticates with CRON_SECRET when one is set. When it is
 * not, it falls back to requiring the admin session rather than being open —
 * an unset optional variable must not silently expose a publishing endpoint.
 */
async function cronAuthorized(req: Request, url: URL): Promise<boolean> {
  if (!env.cronSecret) return hasSession(req);
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${env.cronSecret}` || url.searchParams.get("secret") === env.cronSecret;
}

async function guard(route: string, req: Request, url: URL): Promise<Response | null> {
  if (OPEN_ROUTES.has(route)) return null;
  if (route === "cron/process-queue") {
    return (await cronAuthorized(req, url)) ? null : unauthorized();
  }
  return (await hasSession(req)) ? null : unauthorized();
}

async function safely(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "Erro inesperado no servidor." }, 500);
  }
}

/** Tokens must never reach the browser, so they are stripped in one place. */
async function publicSettings(settings: Awaited<ReturnType<typeof getSettings>>) {
  const { facebook_user_token, default_page_token, facebook_app_secret, ...safe } = settings;
  return {
    ...safe,
    // The App ID is public (it travels in the OAuth URL); the secret never
    // leaves the server, so the UI only learns whether one is stored.
    facebook_app_secret_set: Boolean(facebook_app_secret),
    facebook_connected: Boolean(facebook_user_token),
    facebook_page_ready: Boolean(default_page_token),
    facebook_configured: await isFacebookConfigured(),
  };
}

/* ------------------------------------------------------------------ GET */

export async function GET(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  const route = path.join("/");
  const url = new URL(req.url);

  return safely(async () => {
    const denied = await guard(route, req, url);
    if (denied) return denied;

    if (route === "trends") {
      return json(await getTrendingTopics());
    }

    if (route === "settings") {
      return json(await publicSettings(await getSettings()));
    }

    if (route === "posts") {
      const status = url.searchParams.get("status");
      const posts = await listPosts({
        status: status ? (status.split(",") as PostStatus[]) : undefined,
      });
      return json({ posts });
    }

    if (route === "facebook/pages") {
      return getPages(url.searchParams.get("refresh") === "1");
    }

    if (route === "topics") {
      const settings = await getSettings();
      const source = settings.topic_source ?? "mine";
      try {
        const [topics, next] = await Promise.all([listTopics(), nextTopic()]);
        return json({ ready: true, source, topics, nextId: next?.id ?? null });
      } catch (err) {
        // An install that predates topics: report it so the screen can say
        // how to upgrade, rather than failing the request.
        if (err instanceof TopicsTableMissingError) {
          return json({ ready: false, source, topics: [], nextId: null, message: err.message });
        }
        throw err;
      }
    }

    if (route === "facebook/oauth/start") {
      const creds = await getFacebookCredentials(url.origin);
      if (!creds) {
        return redirectToSettings(
          url.origin,
          "error",
          "Adicione primeiro o ID e a Chave Secreta do aplicativo Meta nas Configurações e tente conectar novamente."
        );
      }

      const state = crypto.randomUUID();
      const res = NextResponse.redirect(buildAuthorizeUrl(creds, state));
      res.cookies.set(OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 600,
      });
      return res;
    }

    if (route === "facebook/oauth/callback") {
      return oauthCallback(req, url);
    }

    if (route === "cron/process-queue") {
      return runCron(req, url);
    }

    return notFound();
  });
}

/* ----------------------------------------------------------------- POST */

const LoginBody = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string(),
});

const ContentBody = z.object({ topic: z.string().trim().min(2).max(200) });

const ImageBody = z.object({
  prompt: z.string().trim().min(2).max(300),
  source: z.enum(["ai", "stock", "mixed"]),
});

const CreatePostBody = z.object({
  topic: z.string().min(1).max(200),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  hashtags: z.array(z.string()).max(15).default([]),
  imageUrl: z.string().url(),
  imageSource: z.enum(["ai", "stock"]),
  linkUrl: z.string().url().optional().or(z.literal("")),
  pageId: z.string().min(1),
  pageName: z.string().min(1),
  action: z.enum(["draft", "schedule", "post_now"]),
  scheduledAt: z.string().datetime().optional(),
});

const DefaultPageBody = z.object({ pageId: z.string().min(1) });

// A pasted list is split client-side into lines; 500 is far more than anyone
// types, and bounds a single request.
const AddTopicsBody = z.object({
  texts: z.array(z.string().max(MAX_TOPIC_LENGTH * 2)).min(1).max(500),
});

const CredentialsBody = z.object({
  appId: z.string().trim().min(5).max(64),
  // Optional so the UI can save an edited App ID without re-typing a secret it
  // never received in the first place.
  appSecret: z.string().trim().min(10).max(128).optional(),
  // Empty string clears it, for an app that uses classic Facebook Login.
  configId: z.string().trim().max(64).optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  const route = path.join("/");
  const url = new URL(req.url);

  return safely(async () => {
    const denied = await guard(route, req, url);
    if (denied) return denied;

    if (route === "auth/login") {
      const parsed = LoginBody.safeParse(await req.json().catch(() => null));
      if (
        !parsed.success ||
        parsed.data.email !== env.adminEmail ||
        parsed.data.password !== env.adminPassword
      ) {
        return json({ error: "E-mail ou senha incorretos." }, 401);
      }
      const res = json({ ok: true });
      res.cookies.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions);
      return res;
    }

    if (route === "auth/logout") {
      const res = json({ ok: true });
      res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
      return res;
    }

    if (route === "generate/content") {
      const parsed = ContentBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: "Informe um tema com 2 a 200 caracteres." }, 400);
      return json(await generateContent(parsed.data.topic));
    }

    if (route === "generate/image") {
      const parsed = ImageBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: "Informe uma descrição e a fonte da imagem." }, 400);
      try {
        return json(await generateImage(parsed.data.prompt, parsed.data.source));
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : "Não foi possível gerar a imagem." }, 502);
      }
    }

    if (route === "posts") {
      const parsed = CreatePostBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return json({ error: parsed.error.issues[0]?.message ?? "Post inválido." }, 400);
      }
      const b = parsed.data;
      if (b.action === "schedule" && !b.scheduledAt) {
        return json({ error: "A data e o horário são obrigatórios para agendar um post." }, 400);
      }

      const post = await createPostRecord({
        topic: b.topic,
        title: b.title,
        description: b.description,
        hashtags: b.hashtags,
        image_url: b.imageUrl,
        image_source: b.imageSource,
        link_url: b.linkUrl || null,
        page_id: b.pageId,
        page_name: b.pageName,
        scheduled_at: b.action === "schedule" ? b.scheduledAt! : null,
        status: b.action === "schedule" ? "scheduled" : "draft",
      });

      if (b.action === "post_now") {
        return json({ post: await publishPostNow(post.id) });
      }
      return json({ post });
    }

    if (route === "topics") {
      const parsed = AddTopicsBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: "Envie pelo menos um tema." }, 400);
      try {
        return json(await addTopics(parsed.data.texts));
      } catch (err) {
        if (err instanceof TopicsTableMissingError) return json({ error: err.message }, 409);
        throw err;
      }
    }

    // posts/<id>/post-now
    if (path.length === 3 && path[0] === "posts" && path[2] === "post-now") {
      try {
        return json({ post: await publishPostNow(path[1]) });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : "Não foi possível publicar." }, 502);
      }
    }

    if (route === "facebook/default-page") {
      const parsed = DefaultPageBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: "O ID da Página é obrigatório." }, 400);

      // The Page token is fetched fresh rather than taken from the client, so
      // a token never has to travel to the browser and back.
      try {
        const page = (await fetchPages()).find((p) => p.id === parsed.data.pageId);
        if (!page) return json({ error: "Essa Página não está disponível nesta conta." }, 404);

        await updateSettings({
          default_page_id: page.id,
          default_page_name: page.name,
          default_page_token: page.access_token,
        });
        return json({ ok: true, pageName: page.name });
      } catch (err) {
        if (err instanceof FacebookNotConnectedError) return json({ error: err.message }, 409);
        throw err;
      }
    }

    if (route === "facebook/credentials") {
      const parsed = CredentialsBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return json({ error: "Informe um ID de Aplicativo válido e uma Chave Secreta com pelo menos 10 caracteres." }, 400);
      }

      const existing = await getSettings();
      if (!parsed.data.appSecret && !existing.facebook_app_secret) {
        return json({ error: "A Chave Secreta do Aplicativo é obrigatória na primeira configuração." }, 400);
      }

      await updateSettings({
        facebook_app_id: parsed.data.appId,
        ...(parsed.data.appSecret ? { facebook_app_secret: parsed.data.appSecret } : {}),
        ...(parsed.data.configId !== undefined
          ? { facebook_config_id: parsed.data.configId || null }
          : {}),
      });
      return json({ ok: true, redirectUri: `${url.origin}/api/facebook/oauth/callback` });
    }

    if (route === "facebook/credentials/clear") {
      await updateSettings({
        facebook_app_id: null,
        facebook_app_secret: null,
        facebook_config_id: null,
      });
      return json({ ok: true });
    }

    if (route === "facebook/disconnect") {
      await updateSettings({
        facebook_user_token: null,
        facebook_token_expires_at: null,
        facebook_user_name: null,
        default_page_id: null,
        default_page_name: null,
        default_page_token: null,
      });
      await supabaseAdmin().from("pages_cache").delete().neq("page_id", "");
      return json({ ok: true });
    }

    return notFound();
  });
}

/* ---------------------------------------------------------------- PATCH */

const SettingsBody = z.object({
  image_source: z.enum(["ai", "stock", "mixed"]).optional(),
  utm_suffix: z.string().max(200).optional(),
  auto_post_enabled: z.boolean().optional(),
  posts_per_day: z.number().int().min(1).max(20).optional(),
  posting_hours: z.array(z.number().int().min(0).max(23)).min(1).max(24).optional(),
  timezone: z.string().min(1).max(64).optional(),
  topic_source: z.enum(["mine", "trending", "mixed"]).optional(),
});

const UpdateTopicBody = z.object({
  enabled: z.boolean().optional(),
  text: z.string().trim().min(1).max(MAX_TOPIC_LENGTH).optional(),
});

const UpdatePostBody = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(500).optional(),
  hashtags: z.array(z.string()).max(15).optional(),
  linkUrl: z.string().url().optional().or(z.literal("")),
  pageId: z.string().min(1).optional(),
  pageName: z.string().min(1).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  status: z.enum(["draft", "scheduled"]).optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  const route = path.join("/");
  const url = new URL(req.url);

  return safely(async () => {
    const denied = await guard(route, req, url);
    if (denied) return denied;

    if (route === "settings") {
      const parsed = SettingsBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: "Dados de configuração inválidos." }, 400);
      try {
        return json(await publicSettings(await updateSettings(parsed.data)));
      } catch (err) {
        // Installs made before topics existed lack the column until
        // schema.sql is run again.
        if (err instanceof Error && /topic_source/.test(err.message)) {
          return json({ error: new TopicsTableMissingError().message }, 409);
        }
        throw err;
      }
    }

    // topics/<id>
    if (path.length === 2 && path[0] === "topics") {
      const parsed = UpdateTopicBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: "Atualização de tema inválida." }, 400);
      return json({ topic: await updateTopic(path[1], parsed.data) });
    }

    // posts/<id>
    if (path.length === 2 && path[0] === "posts") {
      const id = path[1];
      const existing = await getPost(id);
      if (!existing) return json({ error: "Post não encontrado." }, 404);
      if (existing.status === "posted") {
        return json({ error: "Um post já publicado não pode mais ser editado aqui." }, 409);
      }

      const parsed = UpdatePostBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: "Dados de atualização inválidos." }, 400);
      const b = parsed.data;

      const updated = await updatePostRecord(id, {
        ...(b.title !== undefined && { title: b.title }),
        ...(b.description !== undefined && { description: b.description }),
        ...(b.hashtags !== undefined && { hashtags: b.hashtags }),
        ...(b.linkUrl !== undefined && { link_url: b.linkUrl || null }),
        ...(b.pageId !== undefined && { page_id: b.pageId }),
        ...(b.pageName !== undefined && { page_name: b.pageName }),
        ...(b.scheduledAt !== undefined && { scheduled_at: b.scheduledAt }),
        ...(b.status !== undefined && { status: b.status }),
      });

      return json({ post: updated });
    }

    return notFound();
  });
}

/* --------------------------------------------------------------- DELETE */

export async function DELETE(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  const route = path.join("/");
  const url = new URL(req.url);

  return safely(async () => {
    const denied = await guard(route, req, url);
    if (denied) return denied;

    if (path.length === 2 && path[0] === "posts") {
      await deletePostRecord(path[1]);
      return json({ ok: true });
    }

    if (path.length === 2 && path[0] === "topics") {
      await deleteTopic(path[1]);
      return json({ ok: true });
    }
    return notFound();
  });
}

/* ------------------------------------------------------------- handlers */

async function getPages(refresh: boolean) {
  const db = supabaseAdmin();
  try {
    if (refresh) {
      const pages = await fetchPages();
      if (pages.length > 0) {
        await db.from("pages_cache").delete().neq("page_id", "");
        await db
          .from("pages_cache")
          .insert(pages.map((p) => ({ page_id: p.id, name: p.name, category: p.category })));
      }
    }

    const { data: cached } = await db.from("pages_cache").select("*").order("name");
    const settings = await getSettings();
    return json({ pages: cached ?? [], defaultPageId: settings.default_page_id });
  } catch (err) {
    if (err instanceof FacebookNotConnectedError) return json({ error: err.message }, 409);
    return json({ error: err instanceof Error ? err.message : "Não foi possível carregar as Páginas." }, 502);
  }
}

/**
 * Send the browser back to Settings on the SAME origin it arrived from. The
 * project answers on more than one Vercel alias, and the session cookie is
 * scoped to whichever one the user is actually on, so redirecting to a
 * configured canonical URL would silently drop their login.
 */
function redirectToSettings(origin: string, status: "connected" | "error", message?: string) {
  const target = new URL("/dashboard/settings", origin || env.siteUrl);
  target.searchParams.set("facebook", status);
  if (message) target.searchParams.set("message", message);
  return NextResponse.redirect(target);
}

async function oauthCallback(req: Request, url: URL) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.headers
    .get("cookie")
    ?.split("; ")
    .find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))
    ?.split("=")[1];

  if (!code || !state || !cookieState || state !== cookieState) {
    return redirectToSettings(
      url.origin,
      "error",
      "Login was cancelled or the request expired. Please try again."
    );
  }

  const creds = await getFacebookCredentials(url.origin);
  if (!creds) {
    return redirectToSettings(url.origin, "error", "Meta app credentials are no longer set.");
  }

  try {
    // The short-lived token is immediately traded up: Page tokens minted from a
    // long-lived user token never expire, which is what the autopilot needs.
    const shortLived = await exchangeCodeForToken(creds, code);
    const longLived = await exchangeForLongLivedToken(creds, shortLived.access_token);

    await updateSettings({
      facebook_user_token: longLived.access_token,
      facebook_token_expires_at: longLived.expires_in
        ? new Date(Date.now() + longLived.expires_in * 1000).toISOString()
        : null,
    });

    // Catch a half-granted connection here rather than at publish time, where
    // Facebook reports it as a bare "(#200) Permissions error".
    const missing = await missingPermissions(longLived.access_token);
    if (missing.length > 0) {
      return redirectToSettings(
        url.origin,
        "error",
        `Connected, but these permissions were not granted: ${missing.join(", ")}. ` +
          `Add them to your Meta app (use case permissions, and the Login for Business ` +
          `configuration if you use one), then disconnect and connect again.`
      );
    }

    // Best-effort extras: the connection still counts as successful without a
    // display name, and without a Page the user simply picks one next.
    try {
      const account = await fetchAccount();
      await updateSettings({ facebook_user_name: account.name });
    } catch {}

    try {
      const pages = await fetchPages();
      if (pages.length === 1) {
        await updateSettings({
          default_page_id: pages[0].id,
          default_page_name: pages[0].name,
          default_page_token: pages[0].access_token,
        });
      }
    } catch {}

    const res = redirectToSettings(url.origin, "connected");
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  } catch (err) {
    return redirectToSettings(
      url.origin,
      "error",
      err instanceof Error ? err.message : "Connection failed."
    );
  }
}

/**
 * Autopilot tick. Vercel's Hobby plan permits only one cron run per day — a
 * more frequent schedule in vercel.json is rejected at deploy time — so the
 * built-in cron fires once at 12:00 UTC (09:00 America/Sao_Paulo, the first default
 * posting hour). Every guard in maybeRunAutopilot is idempotent, so the
 * remaining posting slots can be driven by pointing any free external cron
 * (cron-job.org, UptimeRobot) at this same path with the CRON_SECRET.
 */
async function runCron(req: Request, url: URL) {
  if (env.cronSecret) {
    const auth = req.headers.get("authorization");
    const provided = url.searchParams.get("secret");
    if (auth !== `Bearer ${env.cronSecret}` && provided !== env.cronSecret) {
      return json({ error: "Não autorizado" }, 401);
    }
  }

  const due = await listDuePosts(new Date().toISOString());
  const queueResults = [];
  for (const post of due) {
    const result = await publishPostNow(post.id);
    queueResults.push({ id: result.id, status: result.status });
  }

  return json({
    processedFromQueue: queueResults.length,
    queueResults,
    autopilot: await maybeRunAutopilot(),
  });
}
