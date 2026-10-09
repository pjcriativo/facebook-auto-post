import { supabaseAdmin } from "@/lib/supabase/server";
import type {
  PageAgentPoolMember,
  PageAutomationSettings,
  PublicationJob,
} from "@/lib/types";

const DEFAULTS: Omit<
  PageAutomationSettings,
  "page_id" | "last_planned_at" | "last_published_at" | "created_at" | "updated_at"
> = {
  enabled: false,
  target_posts_per_day: 8,
  timezone: "America/Sao_Paulo",
  active_start_minute: 390,
  active_end_minute: 1410,
  schedule_jitter_minutes: 5,
  topic_source: "mine",
  image_source: "template",
  default_template_id: null,
  daily_credit_limit: null,
  retention_days: 14,
  strategy_enabled: true,
  strategy_min_samples: 20,
  exploration_rate: 0.15,
};

export async function ensurePageAutomation(pageId: string): Promise<PageAutomationSettings> {
  const db = supabaseAdmin();
  const { data: existing, error: selectError } = await db
    .from("page_automation_settings")
    .select("*")
    .eq("page_id", pageId)
    .maybeSingle();
  if (selectError) throw new Error(`Não foi possível carregar a automação da Página: ${selectError.message}`);
  if (existing) return existing as PageAutomationSettings;

  const { data, error } = await db
    .from("page_automation_settings")
    .insert({ page_id: pageId, ...DEFAULTS })
    .select()
    .single();
  if (error || !data) throw new Error(`Não foi possível preparar a automação da Página: ${error?.message}`);
  return data as PageAutomationSettings;
}

export async function listPageAutomations(): Promise<PageAutomationSettings[]> {
  const { data, error } = await supabaseAdmin()
    .from("page_automation_settings")
    .select("*")
    .order("page_id");
  if (error) throw new Error(`Não foi possível listar as automações: ${error.message}`);
  return (data ?? []) as PageAutomationSettings[];
}

export async function getPageAutomation(pageId: string): Promise<PageAutomationSettings | null> {
  const { data, error } = await supabaseAdmin()
    .from("page_automation_settings")
    .select("*")
    .eq("page_id", pageId)
    .maybeSingle();
  if (error) throw new Error(`Não foi possível carregar a automação da Página: ${error.message}`);
  return data as PageAutomationSettings | null;
}

export async function updatePageAutomation(
  pageId: string,
  patch: Partial<PageAutomationSettings>
): Promise<PageAutomationSettings> {
  await ensurePageAutomation(pageId);
  const { data, error } = await supabaseAdmin()
    .from("page_automation_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("page_id", pageId)
    .select()
    .single();
  if (error || !data) throw new Error(`Não foi possível salvar a automação da Página: ${error?.message}`);
  return data as PageAutomationSettings;
}

export async function syncPrimaryAgentPool(pageId: string, agentId: string): Promise<void> {
  const db = supabaseAdmin();
  await db.from("page_agent_pool").update({ is_primary: false, updated_at: new Date().toISOString() }).eq("page_id", pageId);
  const { error } = await db.from("page_agent_pool").upsert({
    page_id: pageId,
    agent_id: agentId,
    weight: 100,
    is_primary: true,
    enabled: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "page_id,agent_id" });
  if (error) throw new Error(`Não foi possível atualizar a equipe da Página: ${error.message}`);
}

export async function listPageAgentPool(pageId: string): Promise<PageAgentPoolMember[]> {
  const { data, error } = await supabaseAdmin()
    .from("page_agent_pool")
    .select("*")
    .eq("page_id", pageId)
    .eq("enabled", true)
    .order("is_primary", { ascending: false })
    .order("weight", { ascending: false });
  if (error) throw new Error(`Não foi possível carregar a equipe da Página: ${error.message}`);
  return (data ?? []) as PageAgentPoolMember[];
}

export async function createPublicationJobs(
  rows: Array<Pick<PublicationJob, "page_id" | "agent_id" | "scheduled_at" | "idempotency_key">>
): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabaseAdmin()
    .from("publication_jobs")
    .upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`Não foi possível planejar as publicações: ${error.message}`);
  return data?.length ?? 0;
}

export async function listJobsForPreparation(beforeIso: string, limit = 4): Promise<PublicationJob[]> {
  const { data, error } = await supabaseAdmin()
    .from("publication_jobs")
    .select("*")
    .in("status", ["planned", "retry"])
    .lte("scheduled_at", beforeIso)
    .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Não foi possível carregar a fila de preparação: ${error.message}`);
  return (data ?? []) as PublicationJob[];
}

export async function recoverExpiredJobLeases(): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin()
    .from("publication_jobs")
    .update({ status: "retry", locked_by: null, lease_until: null, next_retry_at: now, updated_at: now })
    .eq("status", "generating")
    .lt("lease_until", now)
    .select("id");
  if (error) throw new Error(`Não foi possível recuperar trabalhos interrompidos: ${error.message}`);
  return data?.length ?? 0;
}

export async function claimPublicationJob(job: PublicationJob, workerId: string): Promise<boolean> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 4 * 60_000).toISOString();
  const { data, error } = await supabaseAdmin()
    .from("publication_jobs")
    .update({
      status: "generating",
      attempts: job.attempts + 1,
      locked_by: workerId,
      lease_until: leaseUntil,
      updated_at: now.toISOString(),
    })
    .eq("id", job.id)
    .in("status", ["planned", "retry"])
    .select("id");
  if (error) throw new Error(`Não foi possível reservar a publicação: ${error.message}`);
  return Boolean(data?.length);
}

export async function updatePublicationJob(
  id: string,
  patch: Partial<PublicationJob>
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("publication_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Não foi possível atualizar a publicação planejada: ${error.message}`);
}

export async function getPublicationJob(id: string): Promise<PublicationJob | null> {
  const { data, error } = await supabaseAdmin()
    .from("publication_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Não foi possível carregar a publicação planejada: ${error.message}`);
  return data as PublicationJob | null;
}

export async function listPublicationJobs(pageId?: string, limit = 100): Promise<PublicationJob[]> {
  let query = supabaseAdmin()
    .from("publication_jobs")
    .select("*")
    .order("scheduled_at", { ascending: false })
    .limit(limit);
  if (pageId) query = query.eq("page_id", pageId);
  const { data, error } = await query;
  if (error) throw new Error(`Não foi possível listar o planejamento: ${error.message}`);
  return (data ?? []) as PublicationJob[];
}
