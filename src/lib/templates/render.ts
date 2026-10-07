import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { ContentTemplate } from "@/lib/types";

// The reference layout is a 1280 × 1280 Facebook square. Keeping that exact
// canvas makes the avatar, handle and text coordinates deterministic.
const SIZE = 1280;
const BUCKET = "post-images";

function xml(value: string) {
  return value.replace(/[<>&"']/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  })[char]!);
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

function textLines(text: string, fontSize: number) {
  const maxChars = Math.max(18, Math.floor(900 / (fontSize * 0.52)));
  const lines: Array<{ text: string; gapBefore: boolean }> = [];
  for (const [index, paragraph] of text.split(/\n\s*\n/).entries()) {
    const explicitLines = paragraph.split("\n");
    for (const explicit of explicitLines) {
      for (const [lineIndex, line] of wrapParagraph(explicit, maxChars).entries()) {
        lines.push({ text: line, gapBefore: index > 0 && lineIndex === 0 });
      }
    }
  }
  return lines;
}

export async function renderTemplate(
  template: ContentTemplate,
  text: string
): Promise<{ url: string; source: "template" }> {
  let fontSize = 64;
  let lines = textLines(text, fontSize);
  const finalBaseline = () => {
    const lineHeight = Math.round(fontSize * 1.38);
    const paragraphGaps = lines.filter((line) => line.gapBefore).length;
    return 412 + (lines.length - 1) * lineHeight + paragraphGaps * Math.round(fontSize * 0.9);
  };
  while ((lines.length > 9 || finalBaseline() > 1090) && fontSize > 38) {
    fontSize -= 4;
    lines = textLines(text, fontSize);
  }
  if (lines.length > 12 || finalBaseline() > 1110) {
    throw new Error("O texto é longo demais para este template. Encurte a mensagem e tente novamente.");
  }

  let avatar = "";
  if (template.avatar_url) {
    const response = await fetch(template.avatar_url, { signal: AbortSignal.timeout(15_000) });
    if (response.ok) {
      const type = response.headers.get("content-type") || "image/jpeg";
      avatar = `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
    }
  }

  let y = 412;
  const lineHeight = Math.round(fontSize * 1.38);
  const tspans = lines.map((line) => {
    if (line.gapBefore) y += Math.round(fontSize * 0.9);
    const currentY = y;
    y += lineHeight;
    return `<text x="145" y="${currentY}" class="copy">${xml(line.text)}</text>`;
  }).join("");

  const avatarSvg = avatar
    ? `<defs><clipPath id="avatar"><circle cx="232" cy="205" r="86"/></clipPath></defs>
       <image href="${avatar}" x="146" y="119" width="172" height="172" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar)"/>`
    : `<circle cx="232" cy="205" r="86" fill="#d9d9d9"/>
       <circle cx="232" cy="183" r="28" fill="#8a8a8a"/>
       <path d="M177 260c8-38 30-57 55-57s47 19 55 57" fill="#8a8a8a"/>`;

  const svg = `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${SIZE}" height="${SIZE}" fill="${xml(template.background_color)}"/>
    ${avatarSvg}
    <style>
      .handle { fill:${xml(template.text_color)}; font:700 56px Arial, Helvetica, sans-serif; }
      .copy { fill:${xml(template.text_color)}; font:400 ${fontSize}px Arial, Helvetica, sans-serif; }
    </style>
    <text x="356" y="225" class="handle">${xml(template.handle)}</text>
    ${tspans}
  </svg>`;

  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  const path = `templates/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.png`;
  const db = supabaseAdmin();
  const { error } = await db.storage.from(BUCKET).upload(path, png, {
    contentType: "image/png",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error(`Não foi possível salvar a arte: ${error.message}`);
  const { data } = db.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, source: "template" };
}
