import { supabaseAdmin } from "@/lib/supabase/server";
import type {
  AgentLanguage,
  AgentLanguageProfile,
  ContentAgent,
  PageAgentAssignment,
} from "@/lib/types";

export type AgentInput = Pick<ContentAgent, "slug" | "name" | "role"> &
  Partial<Omit<ContentAgent, "id" | "slug" | "name" | "role" | "created_at" | "updated_at" | "languages" | "page_assignments">>;

export type AgentPatch = Partial<Omit<ContentAgent, "id" | "created_at" | "updated_at" | "languages" | "page_assignments">>;

const DEFAULT_LANGUAGES: Array<Pick<AgentLanguageProfile, "locale" | "label" | "instructions">> = [
  { locale: "pt-BR", label: "Português (Brasil)", instructions: "Escreva diretamente em português brasileiro natural, evitando construções de português europeu." },
  { locale: "en-US", label: "English (United States)", instructions: "Write directly in natural American English. Adapt cultural references instead of translating Portuguese literally." },
  { locale: "es-419", label: "Español (Latinoamérica)", instructions: "Escribe directamente en español latinoamericano natural. Adapta expresiones y referencias culturales; no traduzcas literalmente." },
  { locale: "de-DE", label: "Deutsch", instructions: "Schreibe direkt in natürlichem Deutsch für Deutschland. Passe kulturelle Bezüge an und übersetze nicht wörtlich." },
  { locale: "fr-FR", label: "Français", instructions: "Rédige directement en français naturel de France. Adapte les références culturelles sans traduire littéralement." },
];

async function attachRelations(agents: ContentAgent[]): Promise<ContentAgent[]> {
  if (agents.length === 0) return agents;
  const ids = agents.map((agent) => agent.id);
  const db = supabaseAdmin();
  const [{ data: languages, error: languageError }, { data: assignments, error: assignmentError }] = await Promise.all([
    db.from("agent_languages").select("*").in("agent_id", ids).order("locale"),
    db.from("page_agent_assignments").select("*").in("agent_id", ids).order("page_id"),
  ]);
  if (languageError) throw new Error(`Não foi possível carregar os idiomas dos agentes: ${languageError.message}`);
  if (assignmentError) throw new Error(`Não foi possível carregar as Páginas dos agentes: ${assignmentError.message}`);

  return agents.map((agent) => ({
    ...agent,
    creativity: Number(agent.creativity),
    languages: (languages ?? []).filter((item) => item.agent_id === agent.id) as AgentLanguageProfile[],
    page_assignments: (assignments ?? []).filter((item) => item.agent_id === agent.id) as PageAgentAssignment[],
  }));
}

export async function listAgents(opts: { enabledOnly?: boolean } = {}): Promise<ContentAgent[]> {
  let query = supabaseAdmin().from("content_agents").select("*").order("name");
  if (opts.enabledOnly) query = query.eq("enabled", true);
  const { data, error } = await query;
  if (error) throw new Error(`Não foi possível listar os agentes: ${error.message}`);
  return attachRelations((data ?? []) as ContentAgent[]);
}

export async function getAgent(id: string): Promise<ContentAgent | null> {
  const { data, error } = await supabaseAdmin().from("content_agents").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Não foi possível carregar o agente: ${error.message}`);
  if (!data) return null;
  return (await attachRelations([data as ContentAgent]))[0];
}

export async function createAgent(input: AgentInput): Promise<ContentAgent> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("content_agents").insert(input).select().single();
  if (error || !data) throw new Error(`Não foi possível criar o agente: ${error?.message}`);
  const { error: languageError } = await db.from("agent_languages").insert(
    DEFAULT_LANGUAGES.map((language) => ({ agent_id: data.id, ...language }))
  );
  if (languageError) {
    await db.from("content_agents").delete().eq("id", data.id);
    throw new Error(`Não foi possível preparar os idiomas do novo agente: ${languageError.message}`);
  }
  return (await attachRelations([data as ContentAgent]))[0];
}

export async function updateAgent(id: string, patch: AgentPatch): Promise<ContentAgent> {
  const { data, error } = await supabaseAdmin()
    .from("content_agents")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error || !data) throw new Error(`Não foi possível atualizar o agente: ${error?.message}`);
  return (await attachRelations([data as ContentAgent]))[0];
}

export async function upsertAgentLanguage(
  agentId: string,
  locale: AgentLanguage,
  patch: Pick<AgentLanguageProfile, "label" | "instructions" | "enabled" | "voice_id">
): Promise<AgentLanguageProfile> {
  const { data, error } = await supabaseAdmin().from("agent_languages").upsert({
    agent_id: agentId,
    locale,
    ...patch,
    updated_at: new Date().toISOString(),
  }, { onConflict: "agent_id,locale" }).select().single();
  if (error || !data) throw new Error(`Não foi possível salvar o idioma do agente: ${error?.message}`);
  return data as AgentLanguageProfile;
}

export async function getPageAgent(pageId: string): Promise<{
  assignment: PageAgentAssignment;
  agent: ContentAgent;
} | null> {
  const { data, error } = await supabaseAdmin()
    .from("page_agent_assignments")
    .select("*")
    .eq("page_id", pageId)
    .maybeSingle();
  if (error) throw new Error(`Não foi possível carregar o responsável da Página: ${error.message}`);
  if (!data) return null;
  const agent = await getAgent(data.agent_id);
  return agent ? { assignment: data as PageAgentAssignment, agent } : null;
}

export async function assignPageAgent(
  pageId: string,
  agentId: string,
  language: AgentLanguage,
  specialtyWeights: Record<string, number> = {}
): Promise<PageAgentAssignment> {
  const db = supabaseAdmin();
  const [{ data: page }, { data: agent }, { data: languageProfile }] = await Promise.all([
    db.from("pages_cache").select("page_id").eq("page_id", pageId).maybeSingle(),
    db.from("content_agents").select("id,enabled").eq("id", agentId).maybeSingle(),
    db.from("agent_languages").select("locale,enabled").eq("agent_id", agentId).eq("locale", language).maybeSingle(),
  ]);
  if (!page) throw new Error("A Página não foi encontrada. Atualize a lista do Facebook e tente novamente.");
  if (!agent?.enabled) throw new Error("Escolha um agente ativo.");
  if (!languageProfile?.enabled) throw new Error("Esse idioma não está ativo para o agente escolhido.");

  const { data, error } = await db.from("page_agent_assignments").upsert({
    page_id: pageId,
    agent_id: agentId,
    language,
    specialty_weights: specialtyWeights,
    updated_at: new Date().toISOString(),
  }, { onConflict: "page_id" }).select().single();
  if (error || !data) throw new Error(`Não foi possível vincular o agente à Página: ${error?.message}`);
  return data as PageAgentAssignment;
}

export async function unassignPageAgent(pageId: string): Promise<void> {
  const { error } = await supabaseAdmin().from("page_agent_assignments").delete().eq("page_id", pageId);
  if (error) throw new Error(`Não foi possível remover o agente da Página: ${error.message}`);
}
