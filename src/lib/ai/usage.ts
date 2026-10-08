import { supabaseAdmin } from "@/lib/supabase/server";

export const KIE_CREDIT_USD = 0.005;

export interface UsageItem {
  provider: string;
  operation: string;
  model: string;
  credits: number;
  status: "success" | "failed";
  createdAt: string;
}

export async function recordAiUsage(input: {
  provider: string;
  operation: string;
  model: string;
  creditsUsed?: number;
  status: "success" | "failed";
  latencyMs?: number;
  errorMessage?: string;
  generationId?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await supabaseAdmin().from("ai_usage").insert({
      provider: input.provider,
      operation: input.operation,
      model: input.model,
      credits_used: input.creditsUsed ?? 0,
      status: input.status,
      latency_ms: input.latencyMs ?? null,
      error_message: input.errorMessage ?? null,
      generation_id: input.generationId ?? null,
      metadata: input.metadata ?? {},
    });
  } catch {
    // Usage telemetry must never make a successful generation fail.
  }
}

export async function kieCreditsUsedToday(): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { data, error } = await supabaseAdmin()
    .from("ai_usage")
    .select("credits_used")
    .eq("provider", "kie")
    .eq("status", "success")
    .gte("created_at", start.toISOString());
  if (error) return 0;
  return (data ?? []).reduce((sum, item) => sum + Number(item.credits_used ?? 0), 0);
}

function summarize(rows: Array<Record<string, unknown>>) {
  const items: UsageItem[] = rows.map((row) => ({
    provider: String(row.provider),
    operation: String(row.operation),
    model: String(row.model),
    credits: Number(row.credits_used ?? 0),
    status: row.status === "failed" ? "failed" : "success",
    createdAt: String(row.created_at),
  }));
  const credits = items.filter((item) => item.status === "success").reduce((sum, item) => sum + item.credits, 0);
  return { items, credits, estimatedUsd: credits * KIE_CREDIT_USD };
}

export async function generationUsage(generationId: string) {
  const { data, error } = await supabaseAdmin()
    .from("ai_usage")
    .select("provider,operation,model,credits_used,status,created_at")
    .eq("generation_id", generationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Não foi possível carregar o custo da geração: ${error.message}`);
  return summarize((data ?? []) as Array<Record<string, unknown>>);
}

export async function usageDashboard() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString();
  const { data, error } = await supabaseAdmin()
    .from("ai_usage")
    .select("provider,operation,model,credits_used,status,created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Não foi possível carregar o consumo: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const now = Date.now();
  const within = (days: number) => rows.filter((row) => now - new Date(String(row.created_at)).getTime() <= days * 86_400_000);
  return {
    today: summarize(within(1)),
    sevenDays: summarize(within(7)),
    thirtyDays: summarize(rows),
    recent: summarize(rows.slice(0, 12)).items,
  };
}
