import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as fontkit from "fontkit";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getSettings } from "@/lib/db/settings";
import type { ContentTemplate } from "@/lib/types";
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

function cleanArtworkText(value: string) {
  return value
    .normalize("NFC")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\uFE0E\uFE0F]/g, "")
    .trim();
}

function wrapParagraph(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function textLines(text: string, fontSize: number, width = 900) {
  const maxChars = Math.max(15, Math.floor(width / (fontSize * 0.52)));
  const lines: Array<{ text: string; gapBefore: boolean }> = [];
  for (const [index, paragraph] of text.split(/\n\s*\n/).entries()) {
    for (const explicit of paragraph.split("\n")) {
      for (const [lineIndex, line] of wrapParagraph(explicit, maxChars).entries()) {
        lines.push({ text: line, gapBefore: index > 0 && lineIndex === 0 });
      }
    }
  }
  return lines;
}

function textAsPath(
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

async function resolvedIdentity(template: ContentTemplate) {
  if (template.identity_source === "custom") {
    return { avatarUrl: template.avatar_url, handle: template.handle };
  }

  if (template.identity_source === "page" && template.page_id) {
    const { data } = await supabaseAdmin()
      .from("pages_cache")
      .select("username,picture_url")
      .eq("page_id", template.page_id)
      .maybeSingle();
    return { avatarUrl: data?.picture_url ?? null, handle: data?.username || template.handle };
  }

  const settings = await getSettings();
  return { avatarUrl: settings.admin_avatar_url || template.avatar_url, handle: template.handle };
}

async function imageDataUrl(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Não foi possível carregar a foto usada pelo template.");
  const square = await sharp(Buffer.from(await response.arrayBuffer()))
    .rotate()
    .resize(400, 400, { fit: "cover", position: sharp.strategy.attention })
    .png()
    .toBuffer();
  return `data:image/png;base64,${square.toString("base64")}`;
}

export async function renderTemplatePng(template: ContentTemplate, inputText: string): Promise<Buffer> {
  const text = cleanArtworkText(inputText);
  if (!text) throw new Error("Digite um texto para aparecer dentro da arte.");

  const identity = await resolvedIdentity(template);
  if (!identity.avatarUrl) {
    throw new Error("A foto escolhida não está disponível. Atualize as Páginas, escolha o perfil do administrador ou envie uma foto própria.");
  }

  const { regular: regularFont, bold: boldFont } = await fonts;

  const centered = template.layout === "centered_quote";
  const bold = template.layout === "bold_statement";
  let fontSize = bold ? 72 : 64;
  const width = centered ? 940 : 900;
  let lines = textLines(text, fontSize, width);
  const lineHeight = () => Math.round(fontSize * (bold ? 1.22 : 1.38));
  const contentHeight = () =>
    lines.length * lineHeight() + lines.filter((line) => line.gapBefore).length * Math.round(fontSize * 0.9);

  while ((lines.length > 10 || contentHeight() > 720) && fontSize > 38) {
    fontSize -= 4;
    lines = textLines(text, fontSize, width);
  }
  if (lines.length > 12 || contentHeight() > 780) {
    throw new Error("O texto é longo demais para este template. Encurte a mensagem e tente novamente.");
  }

  const avatar = await imageDataUrl(identity.avatarUrl);
  const textX = centered ? 640 : bold ? 120 : 145;
  let y = centered ? Math.max(455, Math.round((SIZE - contentHeight()) / 2 + 100)) : bold ? 420 : 412;
  const tspans = lines.map((line) => {
    if (line.gapBefore) y += Math.round(fontSize * 0.9);
    const currentY = y;
    y += lineHeight();
    return textAsPath(bold ? boldFont : regularFont, line.text, textX, currentY, fontSize, template.text_color, centered ? "middle" : "start");
  }).join("");

  const header = centered
    ? `<defs><clipPath id="avatar"><circle cx="640" cy="165" r="74"/></clipPath></defs>
       <image href="${avatar}" x="566" y="91" width="148" height="148" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar)"/>
       ${textAsPath(boldFont, identity.handle, 640, 300, 56, template.text_color, "middle")}`
    : `<defs><clipPath id="avatar"><circle cx="232" cy="205" r="86"/></clipPath></defs>
       <image href="${avatar}" x="146" y="119" width="172" height="172" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar)"/>
       ${textAsPath(boldFont, identity.handle, 356, 225, 56, template.text_color)}`;

  const accent = bold
    ? `<rect x="120" y="354" width="150" height="10" rx="5" fill="${xml(template.text_color)}" opacity="0.9"/>`
    : "";
  const svg = `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${SIZE}" height="${SIZE}" fill="${xml(template.background_color)}"/>
    ${header}
    ${accent}
    ${tspans}
  </svg>`;

  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

export async function renderTemplate(
  template: ContentTemplate,
  text: string
): Promise<{ url: string; source: "template" }> {
  const png = await renderTemplatePng(template, text);
  const optimized = await optimizePostImage(png);
  const path = `templates/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.jpg`;
  const db = supabaseAdmin();
  const { error } = await db.storage.from(BUCKET).upload(path, optimized.bytes, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error(`Não foi possível salvar a arte: ${error.message}`);
  const { data } = db.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, source: "template" };
}
