import { supabaseAdmin } from "@/lib/supabase/server";
import type { AppSettings } from "@/lib/types";

export async function getSettings(): Promise<AppSettings> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("app_settings").select("*").eq("id", 1).single();
  if (error || !data) {
    throw new Error(`Não foi possível carregar as configurações: ${error?.message ?? "linha inexistente"}`);
  }
  return data as AppSettings;
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("app_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", 1)
    .select()
    .single();
  if (error || !data) {
    throw new Error(`Não foi possível atualizar as configurações: ${error?.message ?? "linha inexistente"}`);
  }
  return data as AppSettings;
}
