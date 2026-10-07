import { getSettings } from "@/lib/db/settings";
import { env } from "@/lib/env";

export const DEFAULT_AI_MODELS = {
  groq: "llama-3.3-70b-versatile",
  gemini: "gemini-3.5-flash-lite",
  pollinationsText: "openai",
  pollinationsImage: "flux",
} as const;

export interface AiCredentials {
  groqApiKey: string;
  groqModel: string;
  geminiApiKey: string;
  geminiModel: string;
  pollinationsApiKey: string;
  pollinationsTextModel: string;
  pollinationsImageModel: string;
  pexelsApiKey: string;
}

export async function getAiCredentials(): Promise<AiCredentials> {
  let settings: Awaited<ReturnType<typeof getSettings>> | null = null;
  try {
    settings = await getSettings();
  } catch {
    // Environment variables remain a deploy-time fallback if the database is
    // temporarily unavailable or has not received the newest migration yet.
  }

  return {
    groqApiKey: settings?.groq_api_key?.trim() || env.groqApiKey,
    groqModel: settings?.groq_model?.trim() || DEFAULT_AI_MODELS.groq,
    geminiApiKey: settings?.gemini_api_key?.trim() || env.geminiApiKey,
    geminiModel: settings?.gemini_model?.trim() || DEFAULT_AI_MODELS.gemini,
    pollinationsApiKey: settings?.pollinations_api_key?.trim() || env.pollinationsApiKey,
    pollinationsTextModel:
      settings?.pollinations_text_model?.trim() || DEFAULT_AI_MODELS.pollinationsText,
    pollinationsImageModel:
      settings?.pollinations_image_model?.trim() || DEFAULT_AI_MODELS.pollinationsImage,
    pexelsApiKey: settings?.pexels_api_key?.trim() || env.pexelsApiKey,
  };
}

export type ApiProvider = "groq" | "gemini" | "pollinations" | "pexels";

export async function testApiProvider(provider: ApiProvider): Promise<{ message: string }> {
  const credentials = await getAiCredentials();
  let response: Response;

  if (provider === "groq") {
    if (!credentials.groqApiKey) throw new Error("Adicione uma chave da Groq primeiro.");
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: credentials.groqModel,
        messages: [{ role: "user", content: "Responda somente: ok" }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } else if (provider === "gemini") {
    if (!credentials.geminiApiKey) throw new Error("Adicione uma chave do Gemini primeiro.");
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(credentials.geminiModel)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": credentials.geminiApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Responda somente: ok" }] }] }),
        signal: AbortSignal.timeout(20_000),
      }
    );
  } else if (provider === "pexels") {
    if (!credentials.pexelsApiKey) throw new Error("Adicione uma chave do Pexels primeiro.");
    response = await fetch("https://api.pexels.com/v1/curated?per_page=1", {
      headers: { Authorization: credentials.pexelsApiKey },
      signal: AbortSignal.timeout(15_000),
    });
  } else {
    if (!credentials.pollinationsApiKey) {
      throw new Error("Adicione uma chave do Pollinations primeiro.");
    }
    response = await fetch("https://gen.pollinations.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.pollinationsApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: credentials.pollinationsTextModel,
        messages: [{ role: "user", content: "Responda somente: ok" }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.error?.message ?? body?.message ?? `status ${response.status}`;
    throw new Error(`A API recusou o teste: ${detail}`);
  }

  return { message: "Conexão validada com sucesso." };
}
