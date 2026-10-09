import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as fontkit from "fontkit";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { ImageOverlayStyle, ImageSource } from "@/lib/types";
import { optimizePostImage } from "@/lib/images/optimize";

const SIZE = 1280;
const BUCKET = "post-images";
const fonts = Promise.all([
  readFile(path.join(process.cwd(), "node_modules", "@fontsource", "inter", "files", "inter-latin-400-normal.woff2")),
  readFile(path.join(process.cwd(), "node_modules", "@fontsource", "inter", "files", "inter-latin-700-normal.woff2")),
]).then(([regular, bold]) => ({
  regular: fontkit.create(regular) as fontkit.Font,
  bold: fontkit.create(bold) as fontkit.Font,
}));

function xml(value: string) {
  return value.normalize("NFC").replace(/[<>&"']/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  })[char]!);
}

function cleanText(value: string) {
  return value
    .normalize("NFC")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\uFE0E\uFE0F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wrap(text: string, maxChars: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function textPath(
  font: fontkit.Font,
  value: string,
  x: number,
  y: number,
  fontSize: number,
  color: string,
  anchor: "start" | "middle" = "start"
) {
  const run = font.layout(value);
  const scale = fontSize / font.unitsPerEm;
  const startX = anchor === "middle" ? x - (run.advanceWidth * scale) / 2 : x;
  let cursor = 0;
  const paths = run.glyphs.map((glyph, index) => {
    const position = run.positions[index];
    const result = `<path d="${glyph.path.toSVG()}" transform="translate(${cursor + position.xOffset} ${position.yOffset})"/>`;
    cursor += position.xAdvance;
    return result;
  }).join("");
  return `<g fill="${xml(color)}" transform="translate(${startX} ${y}) scale(${scale} ${-scale})">${paths}</g>`;
}

async function fetchImage(url: string, label: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Não foi possível carregar ${label}.`);
  return Buffer.from(await response.arrayBuffer());
}

async function pageIdentity(pageId?: string | null) {
  if (!pageId) return null;
  const { data, error } = await supabaseAdmin()
    .from("pages_cache")
    .select("name,username,picture_url")
    .eq("page_id", pageId)
    .maybeSingle();
  if (error) throw new Error(`Não foi possível carregar a identidade da Página: ${error.message}`);
  return data ? {
    name: data.username ? `@${String(data.username).replace(/^@/, "")}` : data.name,
    pictureUrl: data.picture_url as string | null,
  } : null;
}

export interface PhotoOverlayInput {
  imageUrl: string;
  hook: string;
  style: ImageOverlayStyle;
  pageId?: string | null;
}

/**
 * Adds exact, correctly-spelled copy after the photo has been generated or
 * selected. Keeping typography outside the image model makes previews and the
 * final Facebook asset deterministic.
 */
export async function renderPhotoOverlayPng(input: PhotoOverlayInput): Promise<Buffer> {
  const hook = cleanText(input.hook).slice(0, 90);
  if (hook.length < 2) throw new Error("Digite um gancho curto para aparecer na imagem.");

  const [{ bold }, base, identity] = await Promise.all([
    fonts,
    fetchImage(input.imageUrl, "a imagem de fundo"),
    pageIdentity(input.pageId),
  ]);
  const background = await sharp(base)
    .rotate()
    .resize(SIZE, SIZE, { fit: "cover", position: sharp.strategy.attention })
    .png()
    .toBuffer();

  let fontSize = input.style === "center" ? 92 : 82;
  const textWidth = input.style === "center" ? 940 : 1020;
  let lines = wrap(hook, Math.floor(textWidth / (fontSize * 0.54)));
  while (lines.length > 4 && fontSize > 58) {
    fontSize -= 4;
    lines = wrap(hook, Math.floor(textWidth / (fontSize * 0.54)));
  }
  if (lines.length > 4) throw new Error("O gancho está longo demais. Use uma frase mais curta.");

  const centered = input.style === "center";
  const lineHeight = Math.round(fontSize * 1.18);
  const blockHeight = lines.length * lineHeight;
  const startY = centered
    ? Math.round((SIZE - blockHeight) / 2 + fontSize * 0.72)
    : SIZE - 130 - blockHeight;
  const x = centered ? SIZE / 2 : 100;
  const copy = lines.map((line, index) =>
    textPath(bold, line, x, startY + index * lineHeight, fontSize, "#ffffff", centered ? "middle" : "start")
  ).join("");

  let avatar = "";
  if (identity?.pictureUrl) {
    try {
      const avatarPng = await sharp(await fetchImage(identity.pictureUrl, "a foto da Página"))
        .rotate().resize(96, 96, { fit: "cover", position: sharp.strategy.attention }).png().toBuffer();
      avatar = `<defs><clipPath id="avatar-clip"><circle cx="148" cy="142" r="48"/></clipPath></defs>
        <image href="data:image/png;base64,${avatarPng.toString("base64")}" x="100" y="94" width="96" height="96" clip-path="url(#avatar-clip)"/>`;
    } catch {}
  }
  const identityText = identity?.name
    ? textPath(bold, identity.name, avatar ? 220 : 100, 157, 42, "#ffffff")
    : "";

  const shade = input.style === "gradient"
    ? `<defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="30%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.9"/></linearGradient></defs><rect width="1280" height="1280" fill="url(#shade)"/>`
    : input.style === "card"
      ? `<rect x="64" y="${startY - fontSize - 55}" width="1152" height="${blockHeight + 105}" rx="32" fill="#000" fill-opacity="0.72"/>`
      : `<rect width="1280" height="1280" fill="#000" fill-opacity="0.42"/><rect x="86" y="${startY - fontSize - 65}" width="1108" height="${blockHeight + 120}" rx="38" fill="#000" fill-opacity="0.38"/>`;

  const svg = `<svg width="1280" height="1280" viewBox="0 0 1280 1280" xmlns="http://www.w3.org/2000/svg">
    ${shade}${avatar}${identityText}${copy}
  </svg>`;
  return sharp(background).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png({ compressionLevel: 9 }).toBuffer();
}

export async function renderPhotoOverlay(
  input: PhotoOverlayInput,
  source: Exclude<ImageSource, "template">
): Promise<{ url: string; source: Exclude<ImageSource, "template"> }> {
  const png = await renderPhotoOverlayPng(input);
  const optimized = await optimizePostImage(png);
  const objectPath = `overlays/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.jpg`;
  const db = supabaseAdmin();
  const { error } = await db.storage.from(BUCKET).upload(objectPath, optimized.bytes, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error(`Não foi possível salvar a arte com o gancho: ${error.message}`);
  const { data } = db.storage.from(BUCKET).getPublicUrl(objectPath);
  return { url: data.publicUrl, source };
}
