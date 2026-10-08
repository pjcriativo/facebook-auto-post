import { randomUUID } from "crypto";
import { getAiCredentials } from "@/lib/ai/credentials";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { ImageSource, ImageSourcePref } from "@/lib/types";

const STORAGE_BUCKET = "post-images";

// Square reads well in the Facebook feed on both mobile and desktop, and
// avoids the centre-crop that wide images get in the timeline.
const WIDTH = 1200;
const HEIGHT = 1200;

export function resolveImageSource(pref: ImageSourcePref): Exclude<ImageSource, "template"> {
  if (pref === "template") {
    throw new Error("Templates devem ser renderizados pelo gerador de templates.");
  }
  if (pref === "mixed") return Math.random() < 0.5 ? "ai" : "stock";
  return pref;
}

/**
 * Topics phrased as listicles ("easy weeknight dinner ideas") make the model
 * return a grid of thumbnails, which reads as a stock collage in the feed.
 * Steering it toward one photographed subject fixes that.
 */
const PHOTO_STYLE =
  "single subject, professional photograph, natural light, shallow depth of field, high detail, no text, no watermark, no collage, no grid";

async function fetchAiImageBytes(prompt: string, apiKey: string, model: string): Promise<Blob> {
  if (!apiKey) throw new Error("A chave do Pollinations não está configurada");
  const url = `https://gen.pollinations.ai/image/${encodeURIComponent(
    `${prompt}, ${PHOTO_STYLE}`
  )}?width=${WIDTH}&height=${HEIGHT}&nologo=true&model=${encodeURIComponent(model)}&seed=${Math.floor(Math.random() * 1_000_000)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`A API de imagens do Pollinations respondeu com o status ${res.status}`);
  return res.blob();
}

async function fetchStockImageBytes(query: string, apiKey: string): Promise<Blob> {
  if (!apiKey) throw new Error("A chave do Pexels não está configurada");

  const searchUrl = `https://api.pexels.com/v1/search?${new URLSearchParams({
    query,
    orientation: "square",
    per_page: "10",
  })}`;
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!searchRes.ok) throw new Error(`A pesquisa no Pexels falhou (${searchRes.status})`);
  const data = await searchRes.json();
  const photos: Array<{ src: { large2x: string; large: string } }> = data.photos ?? [];
  if (photos.length === 0) throw new Error("Nenhuma foto de banco de imagens foi encontrada para este tema");

  // Pexels orders search results by relevance. Using the best-ranked result is
  // safer for unattended posting than choosing an arbitrary photo from page 1.
  const chosen = photos[0];
  const imageRes = await fetch(chosen.src.large2x ?? chosen.src.large, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!imageRes.ok) throw new Error("Não foi possível baixar a foto escolhida");
  return imageRes.blob();
}

/**
 * Generates or sources a post image, then re-hosts it in our own Supabase
 * Storage bucket rather than linking the free provider's URL directly. Both
 * free providers are best-effort community services with no uptime guarantee —
 * re-hosting means a post's image keeps working forever, and Facebook's own
 * fetcher (which downloads the image itself at publish time) always sees a
 * stable, fast, first-party URL.
 */
export async function generateImage(
  prompt: string,
  pref: ImageSourcePref
): Promise<{ url: string; source: Exclude<ImageSource, "template"> }> {
  const credentials = await getAiCredentials();
  let source = resolveImageSource(pref);
  if (pref === "mixed" && source === "stock" && !credentials.pexelsApiKey) source = "ai";

  let blob: Blob;
  try {
    blob =
      source === "ai"
        ? await fetchAiImageBytes(
            prompt,
            credentials.pollinationsApiKey,
            credentials.pollinationsImageModel
          )
        : await fetchStockImageBytes(prompt, credentials.pexelsApiKey);
  } catch (err) {
    // Fall back to the other free source rather than failing the whole generation.
    const fallbackSource: Exclude<ImageSource, "template"> = source === "ai" ? "stock" : "ai";
    try {
      blob =
        fallbackSource === "ai"
          ? await fetchAiImageBytes(
              prompt,
              credentials.pollinationsApiKey,
              credentials.pollinationsImageModel
            )
          : await fetchStockImageBytes(prompt, credentials.pexelsApiKey);
      return await uploadImageBlob(blob, fallbackSource);
    } catch {
      throw err instanceof Error ? err : new Error("Não foi possível gerar a imagem");
    }
  }

  return uploadImageBlob(blob, source);
}

export async function uploadImageBlob(
  blob: Blob,
  source: Exclude<ImageSource, "template">
): Promise<{ url: string; source: Exclude<ImageSource, "template"> }> {
  const db = supabaseAdmin();
  const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.jpg`;
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const { error } = await db.storage.from(STORAGE_BUCKET).upload(path, bytes, {
    contentType: blob.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(`Falha ao enviar para o armazenamento: ${error.message}`);

  const { data } = db.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, source };
}
