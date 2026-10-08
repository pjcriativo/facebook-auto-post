"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Brain,
  ChartLineUp,
  Check,
  FloppyDisk,
  GlobeHemisphereWest,
  ImageSquare,
  Robot,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AgentLanguage, AgentLanguageProfile, ContentAgent, PageCache } from "@/lib/types";

type Tab = "overview" | "expertise" | "languages" | "pages" | "model" | "results";
const LANGUAGE_LABELS: Record<AgentLanguage, string> = {
  "pt-BR": "Português (Brasil)", "en-US": "English (United States)",
  "es-419": "Español (Latinoamérica)", "de-DE": "Deutsch", "fr-FR": "Français",
};
const LANGUAGE_CODES = Object.keys(LANGUAGE_LABELS) as AgentLanguage[];

export default function AgentProfilePage() {
  const id = useParams<{ id: string }>().id;
  const [agent, setAgent] = useState<ContentAgent | null>(null);
  const [allAgents, setAllAgents] = useState<ContentAgent[]>([]);
  const [pages, setPages] = useState<PageCache[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pageLanguages, setPageLanguages] = useState<Record<string, AgentLanguage>>({});

  async function load() {
    setLoading(true); setError(null);
    try {
      const [agentResponse, agentsResponse, pagesResponse] = await Promise.all([
        fetch(`/api/agents/${id}`), fetch("/api/agents"), fetch("/api/facebook/pages"),
      ]);
      const [agentBody, agentsBody, pagesBody] = await Promise.all([agentResponse.json(), agentsResponse.json(), pagesResponse.json()]);
      if (!agentResponse.ok) throw new Error(agentBody.error ?? "Agente não encontrado.");
      setAgent(agentBody.agent); setAllAgents(agentsBody.agents ?? []); setPages(pagesBody.pages ?? []);
      const defaults: Record<string, AgentLanguage> = {};
      for (const item of agentBody.agent.page_assignments ?? []) defaults[item.page_id] = item.language;
      setPageLanguages(defaults);
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível carregar o agente."); }
    finally { setLoading(false); }
  }
  // A troca do parâmetro precisa recarregar o perfil completo e suas relações.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [id]);

  const pageOwners = useMemo(() => new Map(allAgents.flatMap((item) => (item.page_assignments ?? []).map((assignment) => [assignment.page_id, { agent: item, assignment }] as const))), [allAgents]);

  function updateLocal(patch: Partial<ContentAgent>) { if (agent) setAgent({ ...agent, ...patch }); }
  async function saveAgent(patch: Partial<ContentAgent>, key = "agent") {
    if (!agent) return; setSaving(key); setError(null); setSaved(false);
    try {
      const response = await fetch(`/api/agents/${agent.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar o agente.");
      setAgent(body.agent); setSaved(true); window.setTimeout(() => setSaved(false), 2500);
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar o agente."); }
    finally { setSaving(null); }
  }

  async function saveLanguage(locale: AgentLanguage, profile: AgentLanguageProfile) {
    if (!agent) return; setSaving(`language:${locale}`); setError(null);
    try {
      const response = await fetch(`/api/agents/${agent.id}/languages/${locale}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: profile.label, instructions: profile.instructions, enabled: profile.enabled, voice_id: profile.voice_id }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar o idioma.");
      await load(); setSaved(true); window.setTimeout(() => setSaved(false), 2500);
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar o idioma."); }
    finally { setSaving(null); }
  }

  async function assign(pageId: string) {
    if (!agent) return; setSaving(`page:${pageId}`); setError(null);
    try {
      const response = await fetch(`/api/pages/${encodeURIComponent(pageId)}/agent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: agent.id, language: pageLanguages[pageId] ?? "pt-BR" }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Não foi possível vincular a Página.");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível vincular a Página."); }
    finally { setSaving(null); }
  }
  async function unassign(pageId: string) {
    setSaving(`page:${pageId}`); setError(null);
    try {
      const response = await fetch(`/api/pages/${encodeURIComponent(pageId)}/agent`, { method: "DELETE" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Não foi possível remover o vínculo."); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível remover o vínculo."); }
    finally { setSaving(null); }
  }

  if (loading) return <Card className="py-14 text-center text-sm text-muted-foreground">Carregando perfil do agente…</Card>;
  if (!agent) return <Card className="py-14 text-center"><p className="text-sm text-destructive">{error ?? "Agente não encontrado."}</p><Link href="/dashboard/agents" className="mt-4 inline-block text-sm text-primary underline">Voltar aos agentes</Link></Card>;

  const languageProfiles = new Map((agent.languages ?? []).map((item) => [item.locale, item]));
  const photoThemes = Array.isArray(agent.visual_strategy?.photo_themes) ? (agent.visual_strategy.photo_themes as string[]) : [];
  const preferredOverlay = typeof agent.visual_strategy?.preferred_overlay === "string" ? agent.visual_strategy.preferred_overlay : "gradient";

  return <div className="space-y-5">
    <Link href="/dashboard/agents" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"><ArrowLeft size={15}/> Voltar para agentes</Link>
    <Card className="overflow-hidden bg-gradient-to-br from-primary/12 via-surface to-surface">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        {agent.avatar_url ? <Image src={agent.avatar_url} alt={agent.name} width={112} height={112} unoptimized className="h-28 w-28 rounded-full border-4 border-primary/20 object-cover shadow-lg"/> : <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full border-4 border-primary/15 bg-background/80 text-4xl font-bold text-primary shadow-lg">{agent.name.split(/\s+/).slice(0,2).map((part) => part[0]).join("")}</div>}
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-heading text-2xl font-bold">{agent.name}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${agent.enabled ? "bg-success/15 text-success" : "bg-surface-2 text-muted-foreground"}`}>{agent.enabled ? "Ativo" : "Inativo"}</span></div><p className="mt-1 text-sm text-primary">{agent.role}</p><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{agent.description || "Configure a descrição deste especialista."}</p><div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><Brain size={15}/>{agent.specialties.length} especialidades</span><span className="inline-flex items-center gap-1"><GlobeHemisphereWest size={15}/>{agent.languages?.filter((item) => item.enabled).length ?? 0} idiomas</span><span className="inline-flex items-center gap-1"><UsersThree size={15}/>{agent.page_assignments?.length ?? 0} Páginas</span><span>Instruções v{agent.prompt_version}</span></div></div>
      </div>
    </Card>
    {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive">{error}</div>}
    {saved && <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 p-3.5 text-sm text-success"><Check size={16}/>Alterações salvas.</div>}

    <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1">{([
      ["overview","Perfil"],["expertise","Especialidades"],["languages","Idiomas"],["pages","Páginas"],["model","Modelo e visual"],["results","Resultados"],
    ] as [Tab,string][]).map(([value,label]) => <button key={value} onClick={() => setTab(value)} className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium ${tab === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-2"}`}>{label}</button>)}</div>

    {tab === "overview" && <Card className="space-y-4"><SectionTitle icon={<Robot size={20}/>} title="Identidade e missão" description="Estas informações definem como o agente se apresenta e para quem escreve."/><div className="grid gap-4 sm:grid-cols-2"><Field label="Nome" value={agent.name} onChange={(name) => updateLocal({ name })}/><Field label="Função" value={agent.role} onChange={(role) => updateLocal({ role })}/><Field label="Categoria" value={agent.category} onChange={(category) => updateLocal({ category })}/><Field label="URL do avatar (opcional)" value={agent.avatar_url ?? ""} onChange={(avatar_url) => updateLocal({ avatar_url: avatar_url || null })}/></div><Area label="Descrição" value={agent.description} onChange={(description) => updateLocal({ description })}/><Area label="Missão" value={agent.mission} onChange={(mission) => updateLocal({ mission })}/><Area label="Público-alvo" value={agent.audience} onChange={(audience) => updateLocal({ audience })}/><Area label="Tom de voz" value={agent.tone} onChange={(tone) => updateLocal({ tone })}/><div className="flex items-center justify-between rounded-xl border border-border bg-background p-3"><div><p className="text-sm font-semibold">Agente ativo</p><p className="text-xs text-muted-foreground">Agentes inativos não poderão ser escolhidos para novas Páginas.</p></div><button onClick={() => updateLocal({ enabled: !agent.enabled })} className={`relative h-7 w-12 rounded-full transition ${agent.enabled ? "bg-primary" : "bg-surface-2"}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${agent.enabled ? "left-6" : "left-1"}`}/></button></div><Save onClick={() => saveAgent({ name: agent.name, role: agent.role, description: agent.description, category: agent.category, mission: agent.mission, audience: agent.audience, tone: agent.tone, avatar_url: agent.avatar_url, enabled: agent.enabled })} busy={saving === "agent"}/></Card>}

    {tab === "expertise" && <Card className="space-y-4"><SectionTitle icon={<Brain size={20}/>} title="Conhecimento e limites" description="Uma linha por item. Alterações criam uma nova versão das instruções para futura comparação de resultados."/><ListArea label="Especialidades" values={agent.specialties} onChange={(specialties) => updateLocal({ specialties })}/><ListArea label="Pilares de conteúdo" values={agent.content_pillars} onChange={(content_pillars) => updateLocal({ content_pillars })}/><ListArea label="Assuntos e comportamentos proibidos" values={agent.forbidden_topics} onChange={(forbidden_topics) => updateLocal({ forbidden_topics })}/><ListArea label="Chamadas para ação preferidas" values={agent.preferred_ctas} onChange={(preferred_ctas) => updateLocal({ preferred_ctas })}/><div className="grid gap-4 sm:grid-cols-2"><Area label="Linha teológica" value={agent.theological_line} onChange={(theological_line) => updateLocal({ theological_line })}/><Area label="Tradução bíblica preferida" value={agent.bible_translation} onChange={(bible_translation) => updateLocal({ bible_translation })}/></div><Area label="Instrução central do agente" value={agent.system_prompt} rows={8} onChange={(system_prompt) => updateLocal({ system_prompt })}/><Save onClick={() => saveAgent({ specialties: agent.specialties, content_pillars: agent.content_pillars, forbidden_topics: agent.forbidden_topics, preferred_ctas: agent.preferred_ctas, theological_line: agent.theological_line, bible_translation: agent.bible_translation, system_prompt: agent.system_prompt })} busy={saving === "agent"}/></Card>}

    {tab === "languages" && <div className="space-y-4">{LANGUAGE_CODES.map((locale) => { const profile = languageProfiles.get(locale) ?? { agent_id: agent.id, locale, label: LANGUAGE_LABELS[locale], instructions: "", enabled: true, voice_id: null, created_at: "", updated_at: "" }; return <LanguageCard key={locale} profile={profile} saving={saving === `language:${locale}`} onChange={(next) => updateLocal({ languages: [...(agent.languages ?? []).filter((item) => item.locale !== locale), next] })} onSave={() => saveLanguage(locale, (agent.languages ?? []).find((item) => item.locale === locale) ?? profile)}/>; })}</div>}

    {tab === "pages" && <Card className="space-y-4"><SectionTitle icon={<UsersThree size={20}/>} title="Páginas sob responsabilidade" description="Um agente pode cuidar de várias Páginas, mas cada Página possui somente um responsável principal."/>{pages.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma Página do Facebook disponível.</p> : <div className="divide-y divide-border">{pages.map((page) => { const owner = pageOwners.get(page.page_id); const mine = owner?.agent.id === agent.id; const locale = pageLanguages[page.page_id] ?? owner?.assignment.language ?? "pt-BR"; return <div key={page.page_id} className="flex flex-col gap-3 py-4 md:flex-row md:items-center"><div className="min-w-0 flex-1"><p className="font-medium">{page.name}</p><p className="text-xs text-muted-foreground">{owner ? `Responsável atual: ${owner.agent.name}` : "Sem agente responsável"}</p></div><select value={locale} onChange={(event) => setPageLanguages((current) => ({ ...current, [page.page_id]: event.target.value as AgentLanguage }))} className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none">{LANGUAGE_CODES.map((item) => <option key={item} value={item}>{LANGUAGE_LABELS[item]}</option>)}</select>{mine ? <Button size="sm" variant="secondary" onClick={() => unassign(page.page_id)} disabled={saving === `page:${page.page_id}`}>Remover vínculo</Button> : <Button size="sm" onClick={() => assign(page.page_id)} disabled={saving === `page:${page.page_id}`}>{owner ? "Transferir para este agente" : "Vincular Página"}</Button>}</div>; })}</div>}</Card>}

    {tab === "model" && <Card className="space-y-4"><SectionTitle icon={<ImageSquare size={20}/>} title="Modelo e direção visual" description="Campos vazios herdam os modelos econômicos e reservas configurados na aba APIs."/><div className="grid gap-4 sm:grid-cols-2"><Field label="Modelo principal" value={agent.primary_model ?? ""} placeholder="Herdar configuração global" onChange={(primary_model) => updateLocal({ primary_model: primary_model || null })}/><Field label="Modelo reserva" value={agent.fallback_model ?? ""} placeholder="Herdar configuração global" onChange={(fallback_model) => updateLocal({ fallback_model: fallback_model || null })}/></div><label className="block text-xs font-semibold text-muted-foreground">Criatividade: {agent.creativity.toFixed(1)}<input type="range" min={0} max={2} step={0.1} value={agent.creativity} onChange={(event) => updateLocal({ creativity: Number(event.target.value) })} className="mt-2 w-full accent-primary"/></label><label className="block text-xs font-semibold text-muted-foreground">Estilo visual preferido<select value={preferredOverlay} onChange={(event) => updateLocal({ visual_strategy: { ...agent.visual_strategy, preferred_overlay: event.target.value } })} className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal text-foreground outline-none"><option value="gradient">Degradê inferior</option><option value="card">Faixa destacada</option><option value="center">Texto central</option></select></label><ListArea label="Temas visuais permitidos" values={photoThemes} onChange={(next) => updateLocal({ visual_strategy: { ...agent.visual_strategy, photo_themes: next } })}/><Save onClick={() => saveAgent({ primary_model: agent.primary_model, fallback_model: agent.fallback_model, creativity: agent.creativity, visual_strategy: agent.visual_strategy })} busy={saving === "agent"}/></Card>}

    {tab === "results" && <Card className="py-14 text-center"><ChartLineUp size={42} className="mx-auto text-primary"/><h3 className="mt-3 font-heading font-bold">Resultados preparados para a etapa de métricas</h3><p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">Os próximos posts já poderão guardar agente, idioma e versão das instruções. Quando conectarmos os insights da Meta, esta área mostrará alcance, compartilhamentos, custo, conversões e recomendações de melhoria.</p></Card>}
  </div>;
}

function SectionTitle({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) { return <div className="flex gap-3 border-b border-border pb-4"><span className="mt-0.5 text-primary">{icon}</span><div><h3 className="font-heading font-bold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{description}</p></div></div>; }
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) { return <label className="block text-xs font-semibold text-muted-foreground">{label}<input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal text-foreground outline-none focus:border-primary"/></label>; }
function Area({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) { return <label className="block text-xs font-semibold text-muted-foreground">{label}<textarea value={value} rows={rows} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-normal text-foreground outline-none focus:border-primary"/></label>; }
function ListArea({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) { return <Area label={`${label} · uma por linha`} value={values.join("\n")} rows={Math.min(7, Math.max(3, values.length + 1))} onChange={(value) => onChange(value.split("\n").map((item) => item.trim()).filter(Boolean))}/>; }
function Save({ onClick, busy }: { onClick: () => void; busy: boolean }) { return <div className="flex justify-end"><Button onClick={onClick} disabled={busy}><FloppyDisk size={16}/>{busy ? "Salvando…" : "Salvar alterações"}</Button></div>; }
function LanguageCard({ profile, saving, onChange, onSave }: { profile: AgentLanguageProfile; saving: boolean; onChange: (profile: AgentLanguageProfile) => void; onSave: () => void }) { return <Card className="space-y-4"><div className="flex items-center justify-between"><div><h3 className="font-heading font-bold">{LANGUAGE_LABELS[profile.locale]}</h3><p className="text-xs text-muted-foreground">{profile.locale}</p></div><button onClick={() => onChange({ ...profile, enabled: !profile.enabled })} className={`relative h-7 w-12 rounded-full transition ${profile.enabled ? "bg-primary" : "bg-surface-2"}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${profile.enabled ? "left-6" : "left-1"}`}/></button></div><Area label="Instruções culturais e linguísticas" value={profile.instructions} onChange={(instructions) => onChange({ ...profile, instructions })}/><Field label="ID da voz para vídeos (opcional)" value={profile.voice_id ?? ""} placeholder="Será usado na etapa de vídeos" onChange={(voice_id) => onChange({ ...profile, voice_id: voice_id || null })}/><Save onClick={onSave} busy={saving}/></Card>; }
