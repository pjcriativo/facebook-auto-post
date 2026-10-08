import { supabaseAdmin } from "@/lib/supabase/server";
import type { ContentTemplate } from "@/lib/types";

export async function listTemplates(): Promise<ContentTemplate[]> {
  const { data, error } = await supabaseAdmin()
    .from("content_templates")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Não foi possível carregar os templates: ${error.message}`);
  return (data ?? []) as ContentTemplate[];
}

export async function getTemplate(id: string): Promise<ContentTemplate | null> {
  const { data, error } = await supabaseAdmin()
    .from("content_templates")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Não foi possível carregar o template: ${error.message}`);
  return data as ContentTemplate | null;
}

export async function createTemplate(
  input: Pick<ContentTemplate, "name" | "handle" | "layout" | "niche" | "page_id" | "identity_source">
) {
  const { data, error } = await supabaseAdmin()
    .from("content_templates")
    .insert(input)
    .select()
    .single();
  if (error) throw new Error(`Não foi possível criar o template: ${error.message}`);
  return data as ContentTemplate;
}

export async function updateTemplate(id: string, patch: Partial<ContentTemplate>) {
  const { data, error } = await supabaseAdmin()
    .from("content_templates")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`Não foi possível atualizar o template: ${error.message}`);
  return data as ContentTemplate;
}

export async function deleteTemplate(id: string) {
  const { error } = await supabaseAdmin().from("content_templates").delete().eq("id", id);
  if (error) throw new Error(`Não foi possível excluir o template: ${error.message}`);
}
