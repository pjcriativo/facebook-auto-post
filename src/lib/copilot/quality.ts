import { supabaseAdmin } from "@/lib/supabase/server";
import type { GeneratedContent } from "@/lib/types";

const STOPWORDS = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "um", "uma",
  "para", "por", "com", "que", "se", "na", "no", "nas", "nos", "sua", "seu", "hoje",
]);

const UNSAFE_PATTERNS = [
  /compartilhe.{0,30}(milagre|b[eê]n[cç][aã]o)/i,
  /(cura|milagre).{0,20}(garantid[oa]|em troca)/i,
  /deus.{0,20}vai.{0,20}(depositar|pagar|transferir)/i,
  /pare de tomar.{0,20}(rem[eé]dio|medica[cç][aã]o)/i,
];

function tokens(value: string): Set<string> {
  return new Set(value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word)));
}

function similarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

export interface QualityResult {
  passed: boolean;
  score: number;
  checks: Record<string, { passed: boolean; detail: string }>;
}

export async function validateAutomaticContent(
  pageId: string,
  content: GeneratedContent
): Promise<QualityResult> {
  const checks: QualityResult["checks"] = {};
  const visible = `${content.title}\n${content.description}\n${content.artText ?? ""}`.trim();

  checks.provider = {
    passed: content.provider !== "template",
    detail: content.provider === "template"
      ? "Todos os modelos falharam; o texto de emergência não pode ser publicado automaticamente."
      : `Texto criado por ${content.provider}.`,
  };
  checks.length = {
    passed: content.title.length >= 12 && content.title.length <= 90 && content.description.length >= 80 && content.description.length <= 500,
    detail: "Título e descrição precisam caber no formato editorial configurado.",
  };
  const unsafe = UNSAFE_PATTERNS.find((pattern) => pattern.test(visible));
  checks.safety = {
    passed: !unsafe,
    detail: unsafe ? "O texto contém promessa, manipulação ou orientação de saúde proibida." : "Nenhum padrão crítico encontrado.",
  };
  checks.hashtags = {
    passed: content.hashtags.length >= 3 && content.hashtags.length <= 5,
    detail: `${content.hashtags.length} hashtags encontradas.`,
  };

  const { data, error } = await supabaseAdmin()
    .from("posts")
    .select("title,description,image_hook")
    .eq("page_id", pageId)
    .in("status", ["scheduled", "posted"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Não foi possível verificar repetições: ${error.message}`);
  const highest = (data ?? []).reduce((max, post) => Math.max(
    max,
    similarity(visible, `${post.title}\n${post.description}\n${post.image_hook ?? ""}`)
  ), 0);
  checks.originality = {
    passed: highest < 0.68,
    detail: `Similaridade máxima com os últimos posts: ${Math.round(highest * 100)}%.`,
  };

  const values = Object.values(checks);
  const score = Math.round((values.filter((check) => check.passed).length / values.length) * 100);
  return { passed: values.every((check) => check.passed), score, checks };
}
