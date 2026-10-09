import { supabaseAdmin } from "@/lib/supabase/server";
import type { Topic } from "@/lib/types";

/**
 * Thrown when the database predates the topics feature. Installs made before
 * it shipped have no `topics` table until schema.sql is run again, and that
 * has to surface as an instruction, not a crash — the rest of the app,
 * autopilot included, keeps working without it.
 */
export class TopicsTableMissingError extends Error {
  constructor() {
    super(
      "Seu banco ainda não possui a tabela de temas. Execute supabase/schema.sql novamente no SQL Editor do Supabase — é seguro executar de novo e somente o que estiver faltando será adicionado."
    );
  }
}

// PostgREST reports an unknown table as PGRST205; Postgres itself as 42P01.
const MISSING_TABLE = new Set(["PGRST205", "42P01"]);

function raise(error: { code?: string; message: string } | null, action: string): void {
  if (!error) return;
  if (error.code && MISSING_TABLE.has(error.code)) throw new TopicsTableMissingError();
  throw new Error(`Não foi possível ${action}: ${error.message}`);
}

export const MAX_TOPIC_LENGTH = 200;

/** Trims, collapses inner whitespace and drops a leading bullet or number. */
export function normaliseTopic(raw: string): string {
  return raw
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TOPIC_LENGTH);
}

export async function listTopics(pageId?: string | null): Promise<Topic[]> {
  let query = supabaseAdmin()
    .from("topics")
    .select("*")
    .order("created_at", { ascending: true });
  query = pageId ? query.eq("page_id", pageId) : query.is("page_id", null);
  const { data, error } = await query;
  raise(error, "listar os temas");
  return (data ?? []) as Topic[];
}

/**
 * Adds topics, skipping blanks and anything already present. Matching is
 * case-insensitive, both within the pasted batch and against the stored list,
 * so pasting the same list twice changes nothing.
 */
export async function addTopics(rawTexts: string[], pageId?: string | null): Promise<{ added: number; skipped: number }> {
  const existing = new Set((await listTopics(pageId)).map((t) => t.text.toLowerCase()));

  const fresh: string[] = [];
  let skipped = 0;
  for (const raw of rawTexts) {
    const text = normaliseTopic(raw);
    if (!text) continue;
    const key = text.toLowerCase();
    if (existing.has(key)) {
      skipped++;
      continue;
    }
    existing.add(key);
    fresh.push(text);
  }

  if (fresh.length > 0) {
    const { error } = await supabaseAdmin()
      .from("topics")
      .insert(fresh.map((text) => ({ text, page_id: pageId ?? null })));
    raise(error, "adicionar os temas");
  }

  return { added: fresh.length, skipped };
}

export async function updateTopic(
  id: string,
  patch: Partial<Pick<Topic, "enabled" | "text">>
): Promise<Topic> {
  const { data, error } = await supabaseAdmin()
    .from("topics")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  raise(error, "atualizar o tema");
  return data as Topic;
}

export async function deleteTopic(id: string): Promise<void> {
  const { error } = await supabaseAdmin().from("topics").delete().eq("id", id);
  raise(error, "excluir o tema");
}

/**
 * The enabled topic autopilot would take next: never-used ones first in the
 * order they were added, then whichever was used longest ago. That covers the
 * whole list before anything repeats, and "next up" stays predictable enough
 * to show on screen.
 */
export async function nextTopic(pageId?: string | null): Promise<Topic | null> {
  let query = supabaseAdmin()
    .from("topics")
    .select("*")
    .eq("enabled", true)
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(1);
  query = pageId ? query.eq("page_id", pageId) : query.is("page_id", null);
  const { data, error } = await query;
  raise(error, "escolher um tema");
  return ((data ?? [])[0] as Topic | undefined) ?? null;
}

export async function markTopicUsed(topic: Topic): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("topics")
    .update({ use_count: topic.use_count + 1, last_used_at: new Date().toISOString() })
    .eq("id", topic.id);
  raise(error, "registrar o uso do tema");
}
