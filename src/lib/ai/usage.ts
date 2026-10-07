import { supabaseAdmin } from "@/lib/supabase/server";

export async function recordAiUsage(input: {
  provider: string;
  operation: string;
  model: string;
  creditsUsed?: number;
  status: "success" | "failed";
  latencyMs?: number;
  errorMessage?: string;
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
