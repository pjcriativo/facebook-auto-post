import { getAiCredentials, type AiCredentials } from "@/lib/ai/credentials";
import { kieChatCompletion } from "@/lib/ai/kie";
import type { ContentProvider, GeneratedContent } from "@/lib/types";

/**
 * Facebook copy generation across free LLM providers, tried in order until
 * one returns usable JSON.
 *
 * Groq, Gemini and Pollinations all use server-only API keys configured in the
 * dashboard (with environment variables as fallbacks). If every provider
 * fails, the caller still gets a postable
 * draft from a deterministic template, but the result says so via `provider`:
 * silently shipping template copy as if it were AI copy is worse than an
 * honest warning.
 */

const SYSTEM_PROMPT = `Você é um redator especialista em conteúdo para Páginas do Facebook no Brasil.
Dado um tema, escreva um único post de alto desempenho, obrigatoriamente em português do Brasil,
em JSON estrito com este formato exato e sem nenhum outro conteúdo:
{"title": string, "description": string, "hashtags": string[], "artText": string, "imageHook": string, "imagePrompt": string, "stockQuery": string}

As três partes serão unidas em uma única legenda, nessa ordem, e devem formar um texto coeso.

Regras:
- title: chamada inicial com até 80 caracteres. Tom natural, envolvente e específico. No máximo um emoji. Sem hashtags.
- description: de 2 a 4 frases curtas e até 400 caracteres, fáceis de ler no celular. Use linguagem brasileira natural, sem clichês de marketing. Termine com uma pergunta ou convite sutil para comentários.
- hashtags: de 3 a 5 hashtags curtas e relevantes, em minúsculas, sem o símbolo "#" e sem espaços.
- artText: uma mensagem impactante e compartilhável de 100 a 260 caracteres sobre o tema. Use 2 a 4 parágrafos curtos separados por duas quebras de linha. Não use hashtags, aspas nem markdown. Deve funcionar sozinha dentro de uma arte quadrada.
- imageHook: gancho emocional de 4 a 12 palavras e no máximo 90 caracteres para aparecer sobre uma fotografia. Deve despertar identificação e vontade espontânea de compartilhar, sem pedir curtidas/compartilhamentos e sem prometer milagres ou resultados.
- imagePrompt: descrição visual detalhada em inglês para criar uma única fotografia coerente com a mensagem. Preserve uma área limpa para texto, não inclua letras, símbolos, logotipos, colagens nem marcas d'água.
- stockQuery: busca visual objetiva em inglês, com 3 a 8 palavras, para encontrar no Pexels uma única fotografia coerente com a mensagem. Descreva sujeito, ação e ambiente; não use conceitos abstratos.
- Use ortografia, vocabulário e expressões naturais do português brasileiro. Não use português europeu.
- Retorne SOMENTE o objeto JSON. Não use blocos Markdown nem comentários.`;

const TIMEOUT_MS = 20_000;

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("A resposta não contém um objeto JSON");
  return JSON.parse(text.slice(start, end + 1));
}

function parseContent(raw: string): GeneratedContent {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object") throw new Error("A resposta da geração está malformada");
  const o = parsed as Record<string, unknown>;
  if (
    typeof o.title !== "string" ||
    typeof o.description !== "string" ||
    !Array.isArray(o.hashtags) ||
    !o.hashtags.every((h) => typeof h === "string") ||
    (o.artText !== undefined && typeof o.artText !== "string") ||
    (o.imageHook !== undefined && typeof o.imageHook !== "string") ||
    (o.imagePrompt !== undefined && typeof o.imagePrompt !== "string") ||
    (o.stockQuery !== undefined && typeof o.stockQuery !== "string")
  ) {
    throw new Error("A resposta da geração está malformada");
  }
  return {
    title: o.title.trim(),
    description: o.description.trim(),
    hashtags: (o.hashtags as string[]).map((h) => h.replace(/^#/, "").trim()).filter(Boolean),
    artText: typeof o.artText === "string" ? o.artText.trim() : undefined,
    imageHook: typeof o.imageHook === "string" ? o.imageHook.trim().slice(0, 90) : undefined,
    imagePrompt: typeof o.imagePrompt === "string" ? o.imagePrompt.trim() : undefined,
    stockQuery: typeof o.stockQuery === "string" ? o.stockQuery.trim() : undefined,
  };
}

/** Shared call shape for the OpenAI-compatible endpoints (Pollinations, Groq). */
async function chatCompletion(
  url: string,
  model: string,
  topic: string,
  apiKey?: string
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0.9,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Tema: ${topic}` },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const host = new URL(url).host;
  const body = await res.text();
  if (!res.ok) throw new Error(`${host} respondeu com o status ${res.status}`);

  const data = JSON.parse(body);
  // Some OpenAI-compatible providers return quota errors inside a successful
  // HTTP response, so the body has to be inspected rather than trusting res.ok.
  if (data?.error) {
    const message = typeof data.error === "string" ? data.error : data.error?.message;
    throw new Error(`${host}: ${message ?? "erro desconhecido"}`);
  }

  const content: unknown = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("A geração retornou vazia");
  return content;
}

async function geminiCompletion(topic: string, apiKey: string, model: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `Tema: ${topic}` }] }],
        generationConfig: { temperature: 0.9, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  );

  if (!res.ok) throw new Error(`O Gemini respondeu com o status ${res.status}`);
  const data = await res.json();
  const content: unknown = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof content !== "string" || !content.trim()) throw new Error("A geração retornou vazia");
  return content;
}

function template(topic: string): GeneratedContent {
  const clean = topic.trim();
  const words = clean.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  return {
    title: `${clean} — vale a pena conferir`,
    description: `Reunimos algumas ideias sobre ${clean.toLowerCase()}. São sugestões simples que você pode colocar em prática nesta semana. Por qual delas você começaria?`,
    hashtags: [...new Set(words)].concat(["ideias"]).slice(0, 5),
    artText: `${clean}.\n\nRespire, siga com calma e lembre-se de que cada passo também faz parte do caminho.`,
    imageHook: clean.split(/\s+/).slice(0, 12).join(" ").slice(0, 90),
    imagePrompt: `A warm, authentic editorial photograph representing ${clean}, natural light, one clear subject, clean negative space for a headline`,
    stockQuery: clean.split(/\s+/).slice(0, 8).join(" "),
  };
}

type Attempt = { provider: ContentProvider; run: () => Promise<string> };

function providerChain(topic: string, credentials: AiCredentials, generationId?: string): Attempt[] {
  const chain: Attempt[] = [];

  // Kie is deliberately first when enabled: the economical model writes the
  // normal high-volume posts and the second Kie model is only used when the
  // first one fails. Existing providers remain untouched as a second safety net.
  if (credentials.kieApiKey && credentials.kieEnabled) {
    for (const model of [...new Set([credentials.kieTextModel, credentials.kieTextFallbackModel])]) {
      chain.push({
        provider: "kie",
        run: () =>
          kieChatCompletion(model, [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `Tema: ${topic}` },
          ], generationId),
      });
    }
  }

  // A configured free-tier key beats the keyless service on both quality and
  // reliability, so those go first whenever one is present.
  // Groq retires model ids without notice (llama-3.3-70b-versatile vanished
  // mid-build), so try a short list rather than pinning a single name.
  const groqKey = credentials.groqApiKey;
  if (groqKey) {
    const models = [
      credentials.groqModel,
      "llama-3.3-70b-versatile",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
    ];
    for (const model of [...new Set(models)]) {
      chain.push({
        provider: "groq",
        run: () =>
          chatCompletion("https://api.groq.com/openai/v1/chat/completions", model, topic, groqKey),
      });
    }
  }

  const geminiKey = credentials.geminiApiKey;
  if (geminiKey) {
    chain.push({
      provider: "gemini",
      run: () => geminiCompletion(topic, geminiKey, credentials.geminiModel),
    });
  }

  if (credentials.pollinationsApiKey) {
    chain.push({
      provider: "pollinations",
      run: () =>
        chatCompletion(
          "https://gen.pollinations.ai/v1/chat/completions",
          credentials.pollinationsTextModel,
          topic,
          credentials.pollinationsApiKey
        ),
    });
  }

  return chain;
}

export async function generateContent(topic: string, generationId?: string): Promise<GeneratedContent> {
  const failures: string[] = [];
  const credentials = await getAiCredentials();

  for (const { provider, run } of providerChain(topic, credentials, generationId)) {
    try {
      return { ...parseContent(await run()), provider };
    } catch (err) {
      failures.push(`${provider}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.warn("[generateContent] every provider failed:", failures.join(" | "));
  return { ...template(topic), provider: "template", providerError: failures[0] };
}
