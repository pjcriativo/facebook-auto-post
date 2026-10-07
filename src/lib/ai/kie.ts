import { createHmac, timingSafeEqual } from "crypto";
import { getAiCredentials } from "@/lib/ai/credentials";
import { generateImage, uploadImageBlob } from "@/lib/ai/image";
import { kieCreditsUsedToday, recordAiUsage } from "@/lib/ai/usage";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { AiGenerationJob } from "@/lib/types";

const KIE_BASE = "https://api.kie.ai";
const CHAT_MODEL_ID = /^[a-zA-Z0-9._-]+$/;
const TASK_MODEL_ID = /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/;

function checkedChatModel(model: string): string {
  if (!CHAT_MODEL_ID.test(model)) throw new Error("O identificador do modelo de texto Kie.ai é inválido.");
  return model;
}

function checkedTaskModel(model: string): string {
  if (!TASK_MODEL_ID.test(model)) throw new Error("O identificador do modelo de imagem Kie.ai é inválido.");
  return model;
}

async function kieRequest(path: string, apiKey: string, init?: RequestInit) {
  const response = await fetch(`${KIE_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || (typeof body?.code === "number" && body.code !== 200)) {
    throw new Error(body?.msg ?? body?.error?.message ?? `Kie.ai respondeu com status ${response.status}`);
  }
  return body;
}

export async function kieChatCompletion(model: string, messages: Array<{ role: string; content: string }>) {
  const credentials = await getAiCredentials();
  if (!credentials.kieApiKey || !credentials.kieEnabled) {
    throw new Error("A geração de texto pela Kie.ai não está ativada.");
  }
  const usedToday = await kieCreditsUsedToday();
  if (
    credentials.kieDailyCreditLimit != null &&
    credentials.kieDailyCreditLimit > 0 &&
    usedToday >= credentials.kieDailyCreditLimit
  ) {
    throw new Error("O limite diário de créditos da Kie.ai foi atingido.");
  }

  const selected = checkedChatModel(model);
  const started = Date.now();
  try {
    const data = await kieRequest(`/${selected}/v1/chat/completions`, credentials.kieApiKey, {
      method: "POST",
      body: JSON.stringify({
        model: selected,
        messages,
        temperature: 0.75,
        stream: false,
      }),
    });
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("A Kie.ai retornou uma resposta vazia.");
    }
    await recordAiUsage({
      provider: "kie",
      operation: "text",
      model: selected,
      creditsUsed: Number(data.credits_consumed ?? 0),
      status: "success",
      latencyMs: Date.now() - started,
    });
    return content;
  } catch (error) {
    await recordAiUsage({
      provider: "kie",
      operation: "text",
      model: selected,
      status: "failed",
      latencyMs: Date.now() - started,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function submitImageTask(model: string, prompt: string, apiKey: string, callback: boolean) {
  const input = model.startsWith("nano-banana")
    ? {
        prompt,
        image_input: [],
        aspect_ratio: "1:1",
        resolution: "1K",
        output_format: "jpg",
      }
    : model.startsWith("flux-2/")
      ? { prompt, aspect_ratio: "1:1", resolution: "1K", nsfw_checker: false }
      : model.startsWith("gpt-image-2-5-")
        ? { prompt, aspect_ratio: "1:1", resolution: "1K", background: "opaque" }
        : { prompt, aspect_ratio: "1:1" };

  const body = await kieRequest("/api/v1/jobs/createTask", apiKey, {
    method: "POST",
    body: JSON.stringify({
      model: checkedTaskModel(model),
      ...(callback ? { callBackUrl: `${env.siteUrl}/api/kie/webhook` } : {}),
      input,
    }),
  });
  const taskId = body?.data?.taskId;
  if (typeof taskId !== "string" || !taskId) throw new Error("A Kie.ai não devolveu o ID da tarefa.");
  return taskId;
}

export async function createKieImageJob(prompt: string): Promise<AiGenerationJob> {
  const credentials = await getAiCredentials();
  if (!credentials.kieApiKey || !credentials.kieEnabled || !credentials.kieImageEnabled) {
    throw new Error("A geração de imagens pela Kie.ai não está ativada.");
  }
  const usedToday = await kieCreditsUsedToday();
  if (
    credentials.kieDailyCreditLimit != null &&
    credentials.kieDailyCreditLimit > 0 &&
    usedToday >= credentials.kieDailyCreditLimit
  ) {
    throw new Error("O limite diário de créditos da Kie.ai foi atingido.");
  }

  const taskId = await submitImageTask(
    credentials.kieImageModel,
    prompt,
    credentials.kieApiKey,
    Boolean(credentials.kieWebhookHmacKey)
  );
  const { data, error } = await supabaseAdmin()
    .from("ai_generation_jobs")
    .insert({
      provider_task_id: taskId,
      model: credentials.kieImageModel,
      fallback_model: credentials.kieImageFallbackModel || null,
      prompt,
    })
    .select()
    .single();
  if (error || !data) throw new Error(`Não foi possível registrar a tarefa de imagem: ${error?.message}`);
  return data as AiGenerationJob;
}

function resultUrl(resultJson: unknown): string | null {
  if (typeof resultJson !== "string") return null;
  try {
    const parsed = JSON.parse(resultJson);
    const urls = parsed?.resultUrls ?? parsed?.result_urls;
    return Array.isArray(urls) && typeof urls[0] === "string" ? urls[0] : null;
  } catch {
    return null;
  }
}

async function replaceWithFallback(job: AiGenerationJob, apiKey: string): Promise<AiGenerationJob | null> {
  if (job.fallback_attempted || !job.fallback_model || job.fallback_model === job.model) return null;
  const credentials = await getAiCredentials();
  const taskId = await submitImageTask(
    job.fallback_model,
    job.prompt,
    apiKey,
    Boolean(credentials.kieWebhookHmacKey)
  );
  const { data, error } = await supabaseAdmin()
    .from("ai_generation_jobs")
    .update({
      provider_task_id: taskId,
      model: job.fallback_model,
      fallback_attempted: true,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .select()
    .single();
  if (error || !data) throw new Error(`Não foi possível iniciar o fallback da imagem: ${error?.message}`);
  return data as AiGenerationJob;
}

export async function refreshKieImageJob(id: string): Promise<AiGenerationJob> {
  const db = supabaseAdmin();
  const { data: current, error } = await db.from("ai_generation_jobs").select("*").eq("id", id).single();
  if (error || !current) throw new Error("Tarefa de imagem não encontrada.");
  const job = current as AiGenerationJob;
  if (job.status !== "pending") return job;

  const credentials = await getAiCredentials();
  if (!credentials.kieApiKey) throw new Error("A chave da Kie.ai não está configurada.");
  const response = await kieRequest(
    `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(job.provider_task_id)}`,
    credentials.kieApiKey
  );
  const task = response?.data;
  if (["waiting", "queuing", "generating"].includes(task?.state)) return job;

  if (task?.state === "fail") {
    const fallback = await replaceWithFallback(job, credentials.kieApiKey).catch(() => null);
    if (fallback) return fallback;
    const message = task?.failMsg || "A geração de imagem da Kie.ai falhou.";
    await recordAiUsage({ provider: "kie", operation: "image", model: job.model, status: "failed", errorMessage: message });
    try {
      const legacy = await generateImage(job.prompt, "ai");
      const { data } = await db
        .from("ai_generation_jobs")
        .update({
          status: "success",
          result_url: legacy.url,
          error_message: `Kie.ai indisponível; imagem criada pelo fallback. ${message}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .select()
        .single();
      return data as AiGenerationJob;
    } catch {
      const { data } = await db
        .from("ai_generation_jobs")
        .update({ status: "failed", error_message: message, updated_at: new Date().toISOString() })
        .eq("id", job.id)
        .select()
        .single();
      return data as AiGenerationJob;
    }
  }

  const remoteUrl = resultUrl(task?.resultJson);
  if (task?.state !== "success" || !remoteUrl) return job;
  const imageResponse = await fetch(remoteUrl, { signal: AbortSignal.timeout(30_000) });
  if (!imageResponse.ok) throw new Error("Não foi possível baixar a imagem concluída da Kie.ai.");
  const uploaded = await uploadImageBlob(await imageResponse.blob(), "ai");
  const credits = Number(task?.creditsConsumed ?? 0);
  const { data } = await db
    .from("ai_generation_jobs")
    .update({
      status: "success",
      result_url: uploaded.url,
      credits_used: credits,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .select()
    .single();
  await recordAiUsage({ provider: "kie", operation: "image", model: job.model, creditsUsed: credits, status: "success" });
  return data as AiGenerationJob;
}

export async function refreshKieImageJobByTaskId(taskId: string) {
  const { data, error } = await supabaseAdmin()
    .from("ai_generation_jobs")
    .select("id")
    .eq("provider_task_id", taskId)
    .maybeSingle();
  if (error || !data) return null;
  return refreshKieImageJob(data.id);
}

export function verifyKieWebhook(body: unknown, timestamp: string | null, signature: string | null, secret: string) {
  if (!timestamp || !signature || !secret) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  const taskId = (body as { data?: { taskId?: unknown; task_id?: unknown } })?.data?.taskId ??
    (body as { data?: { task_id?: unknown } })?.data?.task_id;
  if (typeof taskId !== "string") return false;
  const expected = createHmac("sha256", secret).update(`${taskId}.${timestamp}`).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
