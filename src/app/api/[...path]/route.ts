import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifySessionToken,
} from "@/lib/auth/session";
import {
  hashAdminPassword,
  verifyAdminLogin,
  verifyCurrentAdminPassword,
} from "@/lib/auth/credentials";
import { generateContent } from "@/lib/ai/text";
import { generateImage, resolveImageSource } from "@/lib/ai/image";
import {
  createKieImageJob,
  refreshKieImageJob,
  refreshKieImageJobByTaskId,
  verifyKieWebhook,
} from "@/lib/ai/kie";
import {
  DEFAULT_AI_MODELS,
  getAiCredentials,
  testApiProvider,
} from "@/lib/ai/credentials";
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
  assignPageAgent,
  createAgent,
  getAgent,
  getPageAgent,
  getPageContentAgent,
  listAgents,
  unassignPageAgent,
  updateAgent,
  upsertAgentLanguage,
} from "@/lib/db/agents";
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from "@/lib/db/templates";
import { renderTemplate, renderTemplatePng } from "@/lib/templates/render";
import { renderPhotoOverlay, renderPhotoOverlayPng } from "@/lib/images/overlay";
import { generationUsage, usageDashboard } from "@/lib/ai/usage";
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
  fetchPage,
  fetchPages,
  missingPermissions,
  REQUIRED_PERMISSIONS,
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
import type { AgentLanguage, AppSettings, PostStatus } from "@/lib/types";

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
const OPEN_ROUTES = new Set(["auth/login", "auth/logout", "facebook/oauth/callback", "kie/webhook"]);

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
  if (route === "cron/process-queue" || route.startsWith("cron/process-queue/")) {
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
  const {
    facebook_user_token,
    default_page_token,
    facebook_app_secret,
    admin_password_hash,
    groq_api_key,
    gemini_api_key,
    pollinations_api_key,
    pexels_api_key,
    kie_api_key,
    kie_webhook_hmac_key,
    ...safe
  } = settings;
  void [
    admin_password_hash,
    groq_api_key,
    gemini_api_key,
    pollinations_api_key,
    pexels_api_key,
    kie_api_key,
    kie_webhook_hmac_key,
  ];
  return {
    ...safe,
    admin_email: settings.admin_email?.trim().toLowerCase() || env.adminEmail,
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

    if (route === "integrations") {
      const settings = await getSettings();
      const credentials = await getAiCredentials();
      const source = (stored: string | null | undefined, fallback: string) =>
        stored?.trim() ? "panel" : fallback ? "environment" : "none";
      return json({
        providers: {
          kie: {
            configured: Boolean(credentials.kieApiKey),
            source: source(settings.kie_api_key, env.kieApiKey),
            enabled: credentials.kieEnabled,
            imageEnabled: credentials.kieImageEnabled,
            textModel: credentials.kieTextModel,
            textFallbackModel: credentials.kieTextFallbackModel,
            imageModel: credentials.kieImageModel,
            imageFallbackModel: credentials.kieImageFallbackModel,
            dailyCreditLimit: credentials.kieDailyCreditLimit,
            lowBalanceThreshold: credentials.kieLowBalanceThreshold,
            webhookConfigured: Boolean(credentials.kieWebhookHmacKey),
          },
          groq: {
            configured: Boolean(credentials.groqApiKey),
            source: source(settings.groq_api_key, env.groqApiKey),
            model: credentials.groqModel,
          },
          gemini: {
            configured: Boolean(credentials.geminiApiKey),
            source: source(settings.gemini_api_key, env.geminiApiKey),
            model: credentials.geminiModel,
          },
          pollinations: {
            configured: Boolean(credentials.pollinationsApiKey),
            source: source(settings.pollinations_api_key, env.pollinationsApiKey),
            textModel: credentials.pollinationsTextModel,
            imageModel: credentials.pollinationsImageModel,
          },
          pexels: {
            configured: Boolean(credentials.pexelsApiKey),
            source: source(settings.pexels_api_key, env.pexelsApiKey),
          },
        },
        defaults: DEFAULT_AI_MODELS,
      });
    }

    if (route === "templates") {
      return json({ templates: await listTemplates() });
    }

    if (route === "agents") {
      return json({ agents: await listAgents() });
    }

    if (path.length === 2 && path[0] === "agents") {
      const agent = await getAgent(path[1]);
      return agent ? json({ agent }) : json({ error: "Agente não encontrado." }, 404);
    }

    if (path.length === 3 && path[0] === "pages" && path[2] === "agent") {
      return json({ responsible: await getPageAgent(path[1]) });
    }

    if (route === "automation/status") {
      const settings = await getSettings();
      const templates = await listTemplates();
      const compatibleTemplates = templates.filter(
        (item) => item.enabled && (!item.page_id || item.page_id === settings.default_page_id)
      );
      let missing = settings.facebook_user_token ? [] : [...REQUIRED_PERMISSIONS];
      let pageAccess = false;
      let pageError: string | null = null;
      if (settings.facebook_user_token) {
        missing = await missingPermissions(settings.facebook_user_token);
      }
      if (settings.default_page_id) {
        try {
          await fetchPage(settings.default_page_id);
          pageAccess = true;
        } catch (error) {
          pageError = error instanceof Error ? error.message : "Não foi possível validar a Página.";
        }
      }
      const credentials = await getAiCredentials();
      const preferredTemplate = compatibleTemplates.find((item) => item.id === settings.default_template_id) ?? compatibleTemplates[0] ?? null;
      const responsible = settings.default_page_id ? await getPageAgent(settings.default_page_id) : null;
      const responsibleLanguage = responsible?.agent.languages?.find(
        (item) => item.locale === responsible.assignment.language
      );
      return json({
        connected: Boolean(settings.facebook_user_token),
        defaultPage: settings.default_page_name,
        pageAccess,
        pageError,
        missingPermissions: missing,
        aiTextReady: Boolean(
          (credentials.kieEnabled && credentials.kieApiKey) ||
          credentials.groqApiKey || credentials.geminiApiKey || credentials.pollinationsApiKey
        ),
        templateRequired: settings.image_source === "template",
        templateReady: settings.image_source !== "template" || Boolean(preferredTemplate),
        preferredTemplate: preferredTemplate ? { id: preferredTemplate.id, name: preferredTemplate.name } : null,
        agentReady: Boolean(responsible?.agent.enabled && responsibleLanguage?.enabled),
        responsibleAgent: responsible ? {
          id: responsible.agent.id,
          name: responsible.agent.name,
          role: responsible.agent.role,
          language: responsible.assignment.language,
          languageLabel: responsibleLanguage?.label ?? responsible.assignment.language,
          promptVersion: responsible.agent.prompt_version,
        } : null,
        cronConfigured: Boolean(env.cronSecret),
        autopilotEnabled: settings.auto_post_enabled,
      });
    }

    if (route === "usage/summary") {
      const credentials = await getAiCredentials();
      let balance: number | null = null;
      if (credentials.kieApiKey) {
        try {
          const response = await fetch("https://api.kie.ai/api/v1/chat/credit", {
            headers: { Authorization: `Bearer ${credentials.kieApiKey}` },
            signal: AbortSignal.timeout(15_000),
          });
          const body = await response.json();
          if (response.ok && body?.code === 200) balance = Number(body.data);
        } catch {}
      }
      return json({ ...(await usageDashboard()), balance });
    }

    if (path.length === 3 && path[0] === "usage" && path[1] === "generation") {
      const generationId = z.string().uuid().safeParse(path[2]);
      if (!generationId.success) return json({ error: "Geração inválida." }, 400);
      return json(await generationUsage(generationId.data));
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

    if (path.length === 3 && path[0] === "generate" && path[1] === "image") {
      try {
        const job = await refreshKieImageJob(path[2]);
        return json({
          jobId: job.id,
          status: job.status,
          ...(job.result_url ? { image: { url: job.result_url, source: "ai" } } : {}),
          ...(job.error_message ? { error: job.error_message } : {}),
        });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : "Tarefa não encontrada." }, 404);
      }
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

    if (route === "cron/process-queue" || route.startsWith("cron/process-queue/")) {
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

const AgentLanguageCode = z.enum(["pt-BR", "en-US", "es-419", "de-DE", "fr-FR"]);

const ContentBody = z.object({
  topic: z.string().trim().min(2).max(200),
  generationId: z.string().uuid().optional(),
  pageId: z.string().trim().min(1).nullable().optional(),
});

const ImageBody = z.object({
  prompt: z.string().trim().min(2).max(700),
  source: z.enum(["ai", "stock", "mixed"]),
  generationId: z.string().uuid().optional(),
});

const PhotoOverlayBody = z.object({
  imageUrl: z.string().url(),
  hook: z.string().trim().min(2).max(90),
  style: z.enum(["gradient", "card", "center"]),
  pageId: z.string().min(1).nullable().optional(),
  source: z.enum(["ai", "stock"]),
});

const CreatePostBody = z.object({
  topic: z.string().min(1).max(200),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  hashtags: z.array(z.string()).max(15).default([]),
  imageUrl: z.string().url(),
  imageSource: z.enum(["ai", "stock", "template"]),
  baseImageUrl: z.string().url().optional(),
  imageHook: z.string().trim().max(90).optional(),
  imagePrompt: z.string().trim().max(700).optional(),
  overlayStyle: z.enum(["gradient", "card", "center"]).optional(),
  linkUrl: z.string().url().optional().or(z.literal("")),
  pageId: z.string().min(1).nullable(),
  pageName: z.string().min(1).nullable(),
  action: z.enum(["draft", "schedule", "post_now"]),
  scheduledAt: z.string().datetime().optional(),
  generationId: z.string().uuid().optional(),
  agentId: z.string().uuid().nullable().optional(),
  contentLanguage: AgentLanguageCode.nullable().optional(),
  agentPromptVersion: z.number().int().positive().nullable().optional(),
});

const DefaultPageBody = z.object({ pageId: z.string().min(1) });
const AddFacebookPageBody = z.object({ reference: z.string().trim().min(1).max(300) });

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

const PasswordBody = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z
    .string()
    .min(8)
    .max(128)
    .regex(/[A-Za-z]/)
    .regex(/[0-9]/),
});

const ProviderName = z.enum(["kie", "groq", "gemini", "pollinations", "pexels"]);
const TestProviderBody = z.object({ provider: ProviderName });
const AgentFields = {
  name: z.string().trim().min(2).max(80),
  role: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500),
  category: z.string().trim().min(2).max(80),
  mission: z.string().trim().max(500),
  avatar_url: z.string().url().nullable(),
  enabled: z.boolean(),
  tone: z.string().trim().max(500),
  audience: z.string().trim().max(500),
  specialties: z.array(z.string().trim().min(1).max(100)).max(30),
  content_pillars: z.array(z.string().trim().min(1).max(150)).max(30),
  forbidden_topics: z.array(z.string().trim().min(1).max(200)).max(50),
  preferred_ctas: z.array(z.string().trim().min(1).max(200)).max(30),
  theological_line: z.string().trim().max(500),
  bible_translation: z.string().trim().max(120),
  system_prompt: z.string().trim().max(8_000),
  primary_model: z.string().trim().max(120).nullable(),
  fallback_model: z.string().trim().max(120).nullable(),
  creativity: z.number().min(0).max(2),
  visual_strategy: z.record(z.string(), z.unknown()),
  avatar_config: z.record(z.string(), z.unknown()),
  voice_config: z.record(z.string(), z.unknown()),
};
const CreateAgentBody = z.object({
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  ...AgentFields,
}).partial().required({ slug: true, name: true, role: true });
const UpdateAgentBody = z.object(AgentFields).partial();
const AgentLanguageBody = z.object({
  label: z.string().trim().min(2).max(80),
  instructions: z.string().trim().max(2_000),
  enabled: z.boolean(),
  voice_id: z.string().trim().max(200).nullable(),
});
const PageAgentBody = z.object({
  agentId: z.string().uuid(),
  language: AgentLanguageCode,
  specialtyWeights: z.record(z.string(), z.number().min(0).max(100)).optional(),
});
const CreateTemplateBody = z.object({
  name: z.string().trim().min(2).max(80),
  handle: z.string().trim().min(2).max(80),
  layout: z.enum(["viral_quote", "centered_quote", "bold_statement"]).default("viral_quote"),
  niche: z.string().trim().min(2).max(80).default("Geral"),
  page_id: z.string().trim().min(1).nullable().optional(),
  identity_source: z.enum(["profile", "page", "custom"]).default("profile"),
});
const RenderTemplateBody = z.object({
  templateId: z.string().uuid(),
  text: z.string().trim().min(2).max(700),
});

export async function POST(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  const route = path.join("/");
  const url = new URL(req.url);

  return safely(async () => {
    const denied = await guard(route, req, url);
    if (denied) return denied;

    if (route === "kie/webhook") {
      const body = await req.json().catch(() => null);
      const credentials = await getAiCredentials();
      if (
        !verifyKieWebhook(
          body,
          req.headers.get("x-webhook-timestamp"),
          req.headers.get("x-webhook-signature"),
          credentials.kieWebhookHmacKey
        )
      ) {
        return json({ error: "Assinatura do webhook inválida." }, 401);
      }
      const taskId = body?.data?.taskId ?? body?.data?.task_id;
      await refreshKieImageJobByTaskId(taskId);
      return json({ ok: true });
    }

    if (route === "auth/login") {
      const parsed = LoginBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success || !(await verifyAdminLogin(parsed.data.email, parsed.data.password))) {
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

    if (route === "profile/password") {
      const parsed = PasswordBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return json({ error: "A nova senha deve ter de 8 a 128 caracteres, com letras e números." }, 400);
      }
      if (!(await verifyCurrentAdminPassword(parsed.data.currentPassword))) {
        return json({ error: "A senha atual está incorreta." }, 401);
      }

      try {
        await updateSettings({ admin_password_hash: hashAdminPassword(parsed.data.newPassword) });
      } catch (err) {
        if (err instanceof Error && /admin_password_hash/.test(err.message)) {
          return json({ error: "Atualize o banco executando supabase/schema.sql antes de alterar a senha." }, 409);
        }
        throw err;
      }
      return json({ ok: true });
    }

    if (route === "profile/avatar") {
      const form = await req.formData().catch(() => null);
      const avatar = form?.get("avatar");
      if (!(avatar instanceof File)) return json({ error: "Selecione uma imagem." }, 400);

      const extensions: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      };
      const extension = extensions[avatar.type];
      if (!extension) return json({ error: "Use uma imagem JPG, PNG ou WebP." }, 400);
      if (avatar.size > 5 * 1024 * 1024) {
        return json({ error: "A foto deve ter no máximo 5 MB." }, 400);
      }

      const db = supabaseAdmin();
      const existing = await getSettings();
      const path = `profiles/admin-${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await db.storage.from("post-images").upload(path, avatar, {
        contentType: avatar.type,
        cacheControl: "3600",
        upsert: false,
      });
      if (uploadError) return json({ error: `Não foi possível enviar a foto: ${uploadError.message}` }, 502);

      const { data } = db.storage.from("post-images").getPublicUrl(path);
      try {
        await updateSettings({ admin_avatar_url: data.publicUrl });
      } catch (err) {
        await db.storage.from("post-images").remove([path]);
        if (err instanceof Error && /admin_avatar_url/.test(err.message)) {
          return json({ error: "Atualize o banco executando supabase/schema.sql antes de enviar a foto." }, 409);
        }
        throw err;
      }

      const marker = "/storage/v1/object/public/post-images/";
      const oldPath = existing.admin_avatar_url?.split(marker)[1]?.split("?")[0];
      if (oldPath) await db.storage.from("post-images").remove([decodeURIComponent(oldPath)]);
      return json({ avatarUrl: data.publicUrl });
    }

    if (route === "integrations/test") {
      const parsed = TestProviderBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: "Provedor inválido." }, 400);
      const startedAt = Date.now();
      try {
        const result = await testApiProvider(parsed.data.provider);
        return json({ ok: true, ...result, latencyMs: Date.now() - startedAt });
      } catch (err) {
        return json(
          {
            error: err instanceof Error ? err.message : "Não foi possível validar essa API.",
            latencyMs: Date.now() - startedAt,
          },
          502
        );
      }
    }

    if (route === "templates") {
      const parsed = CreateTemplateBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: "Informe um nome e um @perfil válidos." }, 400);
      return json({ template: await createTemplate({ ...parsed.data, page_id: parsed.data.page_id ?? null }) }, 201);
    }

    if (route === "agents") {
      const parsed = CreateAgentBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Dados do agente inválidos." }, 400);
      return json({ agent: await createAgent(parsed.data) }, 201);
    }

    if (path.length === 3 && path[0] === "pages" && path[2] === "agent") {
      const parsed = PageAgentBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: "Escolha um agente e um idioma válidos." }, 400);
      return json({ assignment: await assignPageAgent(
        path[1],
        parsed.data.agentId,
        parsed.data.language as AgentLanguage,
        parsed.data.specialtyWeights
      ) });
    }

    if (route === "templates/render") {
      const parsed = RenderTemplateBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: "Template ou texto inválido." }, 400);
      const template = await getTemplate(parsed.data.templateId);
      if (!template || !template.enabled) return json({ error: "Template não encontrado ou desativado." }, 404);
      return json(await renderTemplate(template, parsed.data.text));
    }

    if (route === "templates/preview") {
      const parsed = RenderTemplateBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: "Template ou texto inválido." }, 400);
      const template = await getTemplate(parsed.data.templateId);
      if (!template || !template.enabled) return json({ error: "Template não encontrado ou desativado." }, 404);
      const png = await renderTemplatePng(template, parsed.data.text);
      return new NextResponse(new Uint8Array(png), {
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
      });
    }

    if (route === "templates/avatar") {
      const form = await req.formData().catch(() => null);
      const templateId = form?.get("templateId");
      const avatar = form?.get("avatar");
      if (typeof templateId !== "string" || !(avatar instanceof File)) {
        return json({ error: "Selecione um template e uma imagem." }, 400);
      }
      const extensions: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      };
      const extension = extensions[avatar.type];
      if (!extension) return json({ error: "Use uma imagem JPG, PNG ou WebP." }, 400);
      if (avatar.size > 5 * 1024 * 1024) return json({ error: "A foto deve ter no máximo 5 MB." }, 400);

      const existing = await getTemplate(templateId);
      if (!existing) return json({ error: "Template não encontrado." }, 404);

      const db = supabaseAdmin();
      const path = `templates/avatars/${templateId}-${crypto.randomUUID()}.${extension}`;
      const { error } = await db.storage.from("post-images").upload(path, avatar, {
        contentType: avatar.type,
        cacheControl: "31536000",
        upsert: false,
      });
      if (error) return json({ error: `Não foi possível enviar a foto: ${error.message}` }, 502);
      const { data } = db.storage.from("post-images").getPublicUrl(path);
      const updated = await updateTemplate(templateId, {
        avatar_url: data.publicUrl,
        identity_source: "custom",
      });
      const marker = "/storage/v1/object/public/post-images/";
      const oldPath = existing.avatar_url?.split(marker)[1]?.split("?")[0];
      if (oldPath) await db.storage.from("post-images").remove([decodeURIComponent(oldPath)]);
      return json({ template: updated });
    }

    if (route === "generate/content") {
      const parsed = ContentBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: "Informe um tema com 2 a 200 caracteres." }, 400);
      try {
        const responsible = parsed.data.pageId
          ? await getPageContentAgent(parsed.data.pageId)
          : null;
        return json(await generateContent(parsed.data.topic, parsed.data.generationId, {
          agent: responsible?.agent,
          language: responsible?.language,
        }));
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : "Não foi possível preparar o agente da Página." }, 409);
      }
    }

    if (route === "generate/image") {
      const parsed = ImageBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: "Informe uma descrição e a fonte da imagem." }, 400);
      try {
        const credentials = await getAiCredentials();
        let resolved = resolveImageSource(parsed.data.source);
        if (resolved === "stock" && !credentials.pexelsApiKey) {
          if (parsed.data.source === "mixed") {
            resolved = "ai";
          } else {
            return json({ error: "Configure a chave do Pexels na aba APIs para usar fotos gratuitas." }, 409);
          }
        }
        if (
          resolved === "ai" &&
          credentials.kieApiKey &&
          credentials.kieEnabled &&
          credentials.kieImageEnabled
        ) {
          try {
            const job = await createKieImageJob(parsed.data.prompt, parsed.data.generationId);
            return json({ jobId: job.id, status: job.status }, 202);
          } catch (error) {
            console.warn("[generate/image] Kie.ai unavailable; using existing fallback:", error);
          }
        }
        return json(await generateImage(parsed.data.prompt, resolved));
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : "Não foi possível gerar a imagem." }, 502);
      }
    }

    if (route === "images/overlay/preview" || route === "images/overlay/render") {
      const parsed = PhotoOverlayBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: "Informe a imagem, o gancho e o estilo visual." }, 400);
      try {
        if (route.endsWith("/preview")) {
          const png = await renderPhotoOverlayPng(parsed.data);
          return new Response(new Uint8Array(png), {
            headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
          });
        }
        return json(await renderPhotoOverlay(parsed.data, parsed.data.source));
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : "Não foi possível aplicar o gancho." }, 502);
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
        base_image_url: b.baseImageUrl ?? null,
        image_hook: b.imageHook ?? null,
        image_prompt: b.imagePrompt ?? null,
        overlay_style: b.overlayStyle ?? null,
        link_url: b.linkUrl || null,
        page_id: b.pageId,
        page_name: b.pageName,
        scheduled_at: b.action === "schedule" ? b.scheduledAt! : null,
        status: b.action === "schedule" ? "scheduled" : "draft",
        generation_id: b.generationId ?? null,
        agent_id: b.agentId ?? null,
        content_language: b.contentLanguage ?? null,
        agent_prompt_version: b.agentPromptVersion ?? null,
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
        const page = await fetchPage(parsed.data.pageId);

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

    if (route === "facebook/pages") {
      const parsed = AddFacebookPageBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: "Informe a URL ou o ID da Página." }, 400);

      try {
        const page = await fetchPage(parsed.data.reference);
        const db = supabaseAdmin();
        const { error } = await db.from("pages_cache").upsert(
          { page_id: page.id, name: page.name, category: page.category },
          { onConflict: "page_id" }
        );
        if (error) throw error;
        return json({ page: { page_id: page.id, name: page.name, category: page.category } });
      } catch (err) {
        if (err instanceof FacebookNotConnectedError) return json({ error: err.message }, 409);
        return json({
          error: err instanceof Error
            ? err.message
            : "Não foi possível adicionar essa Página.",
        }, 422);
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
  image_source: z.enum(["ai", "stock", "mixed", "template"]).optional(),
  utm_suffix: z.string().max(200).optional(),
  auto_post_enabled: z.boolean().optional(),
  posts_per_day: z.number().int().min(1).max(20).optional(),
  posting_hours: z.array(z.number().int().min(0).max(23)).min(1).max(24).optional(),
  timezone: z.string().min(1).max(64).optional(),
  topic_source: z.enum(["mine", "trending", "mixed"]).optional(),
  default_template_id: z.string().uuid().nullable().optional(),
});

const ProfileBody = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
});

const IntegrationBody = z.object({
  provider: ProviderName,
  apiKey: z.string().trim().min(8).max(500).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  textModel: z.string().trim().min(1).max(120).optional(),
  textFallbackModel: z.string().trim().min(1).max(120).optional(),
  imageModel: z.string().trim().min(1).max(120).optional(),
  imageFallbackModel: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  imageEnabled: z.boolean().optional(),
  dailyCreditLimit: z.number().min(0).max(1_000_000).nullable().optional(),
  lowBalanceThreshold: z.number().min(0).max(1_000_000).optional(),
  webhookHmacKey: z.string().trim().min(16).max(500).optional(),
});
const UpdateTemplateBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  handle: z.string().trim().min(2).max(80).optional(),
  layout: z.enum(["viral_quote", "centered_quote", "bold_statement"]).optional(),
  niche: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(240).optional(),
  page_id: z.string().trim().min(1).nullable().optional(),
  identity_source: z.enum(["profile", "page", "custom"]).optional(),
  background_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  text_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  enabled: z.boolean().optional(),
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

    if (route === "profile") {
      const parsed = ProfileBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return json({ error: "Informe um nome completo e um e-mail válidos." }, 400);
      }
      try {
        const updated = await updateSettings({
          admin_full_name: parsed.data.fullName,
          admin_email: parsed.data.email,
        });
        return json({
          fullName: updated.admin_full_name,
          email: updated.admin_email,
          avatarUrl: updated.admin_avatar_url,
        });
      } catch (err) {
        if (err instanceof Error && /admin_(full_name|email|avatar|password)/.test(err.message)) {
          return json({ error: "Atualize o banco executando supabase/schema.sql antes de salvar o perfil." }, 409);
        }
        throw err;
      }
    }

    if (route === "integrations") {
      const parsed = IntegrationBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: "Chave ou modelo inválido." }, 400);
      const input = parsed.data;
      const patch: Partial<AppSettings> = {};

      if (input.provider === "kie") {
        if (input.apiKey) patch.kie_api_key = input.apiKey;
        if (input.textModel) patch.kie_text_model = input.textModel;
        if (input.textFallbackModel) patch.kie_text_fallback_model = input.textFallbackModel;
        if (input.imageModel) patch.kie_image_model = input.imageModel;
        if (input.imageFallbackModel) patch.kie_image_fallback_model = input.imageFallbackModel;
        if (input.enabled !== undefined) patch.kie_enabled = input.enabled;
        if (input.imageEnabled !== undefined) patch.kie_image_enabled = input.imageEnabled;
        if (input.dailyCreditLimit !== undefined) patch.kie_daily_credit_limit = input.dailyCreditLimit;
        if (input.lowBalanceThreshold !== undefined) {
          patch.kie_low_balance_threshold = input.lowBalanceThreshold;
        }
        if (input.webhookHmacKey) patch.kie_webhook_hmac_key = input.webhookHmacKey;
      } else if (input.provider === "groq") {
        if (input.apiKey) patch.groq_api_key = input.apiKey;
        if (input.model) patch.groq_model = input.model;
      } else if (input.provider === "gemini") {
        if (input.apiKey) patch.gemini_api_key = input.apiKey;
        if (input.model) patch.gemini_model = input.model;
      } else if (input.provider === "pollinations") {
        if (input.apiKey) patch.pollinations_api_key = input.apiKey;
        if (input.textModel) patch.pollinations_text_model = input.textModel;
        if (input.imageModel) patch.pollinations_image_model = input.imageModel;
      } else if (input.apiKey) {
        patch.pexels_api_key = input.apiKey;
      }

      if (Object.keys(patch).length === 0) {
        return json({ error: "Informe uma nova chave ou modelo para salvar." }, 400);
      }
      try {
        await updateSettings(patch);
        return json({ ok: true });
      } catch (err) {
        if (err instanceof Error && /(kie|groq|gemini|pollinations|pexels)_/.test(err.message)) {
          return json({ error: "Aplique a migração mais recente do Supabase antes de salvar APIs." }, 409);
        }
        throw err;
      }
    }

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

    if (path.length === 2 && path[0] === "templates") {
      const parsed = UpdateTemplateBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: "Dados do template inválidos." }, 400);
      return json({ template: await updateTemplate(path[1], parsed.data) });
    }

    if (path.length === 2 && path[0] === "agents") {
      const parsed = UpdateAgentBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Dados do agente inválidos." }, 400);
      const current = await getAgent(path[1]);
      if (!current) return json({ error: "Agente não encontrado." }, 404);
      const promptFields = new Set([
        "tone", "audience", "specialties", "content_pillars", "forbidden_topics",
        "preferred_ctas", "theological_line", "bible_translation", "system_prompt",
        "primary_model", "fallback_model", "creativity",
      ]);
      const changesPrompt = Object.keys(parsed.data).some((key) => promptFields.has(key));
      return json({ agent: await updateAgent(path[1], {
        ...parsed.data,
        ...(changesPrompt ? { prompt_version: current.prompt_version + 1 } : {}),
      }) });
    }

    if (path.length === 4 && path[0] === "agents" && path[2] === "languages") {
      const locale = AgentLanguageCode.safeParse(path[3]);
      const parsed = AgentLanguageBody.safeParse(await req.json().catch(() => null));
      if (!locale.success || !parsed.success) return json({ error: "Configuração de idioma inválida." }, 400);
      const current = await getAgent(path[1]);
      if (!current) return json({ error: "Agente não encontrado." }, 404);
      const language = await upsertAgentLanguage(path[1], locale.data as AgentLanguage, parsed.data);
      await updateAgent(path[1], { prompt_version: current.prompt_version + 1 });
      return json({ language });
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

    if (path.length === 3 && path[0] === "pages" && path[2] === "agent") {
      await unassignPageAgent(path[1]);
      return json({ ok: true });
    }

    if (path.length === 2 && path[0] === "topics") {
      await deleteTopic(path[1]);
      return json({ ok: true });
    }

    if (path.length === 2 && path[0] === "integrations") {
      const parsed = ProviderName.safeParse(path[1]);
      if (!parsed.success) return json({ error: "Provedor inválido." }, 400);
      const columns = {
        kie: { kie_api_key: null, kie_enabled: false, kie_image_enabled: false, kie_webhook_hmac_key: null },
        groq: { groq_api_key: null },
        gemini: { gemini_api_key: null },
        pollinations: { pollinations_api_key: null },
        pexels: { pexels_api_key: null },
      } as const;
      await updateSettings(columns[parsed.data]);
      return json({ ok: true });
    }

    if (path.length === 2 && path[0] === "templates") {
      await deleteTemplate(path[1]);
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
      const { data: previous } = await db.from("pages_cache").select("page_id");
      const found = new Set(pages.map((page) => page.id));

      // Preserve manually added business Pages only while Meta still confirms
      // the connected account can obtain their Page token.
      for (const cached of previous ?? []) {
        if (found.has(cached.page_id)) continue;
        try {
          const page = await fetchPage(cached.page_id);
          pages.push(page);
          found.add(page.id);
        } catch {}
      }
      if (pages.length > 0) {
        await db.from("pages_cache").delete().neq("page_id", "");
        await db
          .from("pages_cache")
          .insert(pages.map((p) => ({
            page_id: p.id,
            name: p.name,
            category: p.category,
            username: p.username,
            picture_url: p.picture_url,
          })));
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
 * Queue/autopilot tick. Hobby cron expressions can run at most once per day,
 * so vercel.json registers one distinct daily path for each UTC hour. The
 * application timezone and posting-hour guards decide whether a post is due.
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
    // A cron delivery may be duplicated. Reuse the atomic run ledger to make
    // each scheduled post publish at most once across concurrent invocations.
    const slotKey = `queue:${post.id}`;
    const db = supabaseAdmin();
    const { error: claimError } = await db.from("autopilot_runs").insert({ slot_key: slotKey });
    if (claimError?.code === "23505") continue;
    if (claimError) throw new Error(`Não foi possível reservar a publicação ${post.id}: ${claimError.message}`);

    try {
      const result = await publishPostNow(post.id);
      await db.from("autopilot_runs").update({
        status: result.status === "posted" ? "posted" : "failed",
        post_id: result.id,
        error_message: result.error_message,
        updated_at: new Date().toISOString(),
      }).eq("slot_key", slotKey);
      queueResults.push({ id: result.id, status: result.status });
    } catch (error) {
      await db.from("autopilot_runs").update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Falha inesperada na fila.",
        updated_at: new Date().toISOString(),
      }).eq("slot_key", slotKey);
      throw error;
    }
  }

  return json({
    processedFromQueue: queueResults.length,
    queueResults,
    autopilot: await maybeRunAutopilot(),
  });
}
