"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle,
  GlobeHemisphereWest,
  MagnifyingGlass,
  Plus,
  Robot,
  UsersThree,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AgentLanguage, ContentAgent } from "@/lib/types";

const LANGUAGES: Array<[AgentLanguage, string]> = [
  ["pt-BR", "Português"],
  ["en-US", "Inglês"],
  ["es-419", "Espanhol"],
  ["de-DE", "Alemão"],
  ["fr-FR", "Francês"],
];

const AGENT_COLORS: Record<string, string> = {
  "mestre-biblico": "from-blue-500/30 via-indigo-500/15 to-transparent",
  "intercessor-libertacao": "from-violet-500/30 via-purple-500/15 to-transparent",
  "conselheiro-pastoral": "from-emerald-500/30 via-teal-500/15 to-transparent",
  "devocional-motivacional": "from-amber-500/30 via-orange-500/15 to-transparent",
  "missionario-evangelista": "from-rose-500/30 via-pink-500/15 to-transparent",
};

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<ContentAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState<AgentLanguage | "all">("all");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/agents");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível carregar os agentes.");
      setAgents(body.agents ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os agentes.");
    } finally {
      setLoading(false);
    }
  }

  // A carga inicial sincroniza esta tela cliente com a API autenticada.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => agents.filter((agent) => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    const matchesText = !term || [agent.name, agent.role, agent.description, ...agent.specialties]
      .some((value) => value.toLocaleLowerCase("pt-BR").includes(term));
    const matchesLanguage = language === "all" || agent.languages?.some((item) => item.locale === language && item.enabled);
    const matchesStatus = status === "all" || (status === "active" ? agent.enabled : !agent.enabled);
    return matchesText && matchesLanguage && matchesStatus;
  }), [agents, language, search, status]);

  async function createAgent(event: React.FormEvent) {
    event.preventDefault();
    if (!newName.trim() || !newRole.trim()) return;
    setCreating(true); setError(null);
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: slugify(newName), name: newName, role: newRole, category: "Cristão" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível criar o agente.");
      setAgents((current) => [...current, body.agent].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName(""); setNewRole(""); setShowCreate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o agente.");
    } finally { setCreating(false); }
  }

  return <div className="space-y-5">
    <Card className="overflow-hidden bg-gradient-to-br from-primary/10 via-surface to-surface">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><Robot size={26} weight="fill"/></div>
          <div><h2 className="font-heading text-xl font-bold">Equipe de agentes</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Cada Página pode ter um especialista responsável, com voz, idioma, regras e estratégia próprias.</p></div>
        </div>
        <Button onClick={() => setShowCreate(true)}><Plus size={16}/> Novo agente</Button>
      </div>
    </Card>

    {showCreate && <Card><form onSubmit={createAgent} className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto_auto] sm:items-end"><Field label="Nome" value={newName} onChange={setNewName} placeholder="Ex.: Estudos para Jovens"/><Field label="Função" value={newRole} onChange={setNewRole} placeholder="Ex.: Mentor de jovens cristãos"/><Button type="submit" disabled={creating}>{creating ? "Criando…" : "Criar"}</Button><Button type="button" variant="ghost" onClick={() => setShowCreate(false)}><X size={16}/></Button></form></Card>}
    {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive">{error}</div>}

    <Card className="space-y-3">
      <div className="relative"><MagnifyingGlass size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar por agente, função ou especialidade…" className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-sm outline-none focus:border-primary"/></div>
      <div className="flex flex-wrap gap-2"><Filter active={language === "all"} onClick={() => setLanguage("all")}>Todos os idiomas</Filter>{LANGUAGES.map(([value,label]) => <Filter key={value} active={language === value} onClick={() => setLanguage(value)}>{label}</Filter>)}<span className="mx-1 hidden h-8 w-px bg-border sm:block"/><Filter active={status === "active"} onClick={() => setStatus(status === "active" ? "all" : "active")}>Ativos</Filter><Filter active={status === "inactive"} onClick={() => setStatus(status === "inactive" ? "all" : "inactive")}>Inativos</Filter></div>
    </Card>

    {loading ? <Card className="py-14 text-center text-sm text-muted-foreground">Carregando agentes…</Card> : filtered.length === 0 ? <Card className="py-14 text-center text-sm text-muted-foreground">Nenhum agente corresponde aos filtros.</Card> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{filtered.map((agent) => {
      const enabledLanguages = agent.languages?.filter((item) => item.enabled) ?? [];
      return <Link key={agent.id} href={`/dashboard/agents/${agent.id}`} className="group overflow-hidden rounded-card border border-border bg-surface shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg">
        <div className={`relative flex min-h-44 items-center justify-center bg-gradient-to-br ${AGENT_COLORS[agent.slug] ?? "from-primary/25 via-accent/10 to-transparent"}`}>
          <span className={`absolute left-4 top-4 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${agent.enabled ? "bg-success/15 text-success" : "bg-surface-2 text-muted-foreground"}`}><CheckCircle size={13} weight={agent.enabled ? "fill" : "regular"}/>{agent.enabled ? "Ativo" : "Inativo"}</span>
          {agent.avatar_url ? <Image src={agent.avatar_url} alt={agent.name} width={112} height={112} unoptimized className="h-28 w-28 rounded-full border-4 border-white/20 object-cover shadow-xl"/> : <div className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-white/15 bg-background/80 text-4xl font-bold text-primary shadow-xl">{agent.name.split(/\s+/).slice(0,2).map((part) => part[0]).join("")}</div>}
        </div>
        <div className="p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="font-heading font-bold group-hover:text-primary">{agent.name}</h3><p className="mt-0.5 text-xs text-muted-foreground">{agent.role}</p></div><ArrowRight size={18} className="mt-1 shrink-0 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary"/></div><p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{agent.description || "Configure a missão e a personalidade deste agente."}</p><div className="mt-4 flex flex-wrap gap-1.5">{agent.specialties.slice(0,3).map((item) => <span key={item} className="rounded-full bg-primary/8 px-2.5 py-1 text-[11px] text-primary">{item}</span>)}</div><div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><GlobeHemisphereWest size={14}/>{enabledLanguages.length} idiomas</span><span className="inline-flex items-center gap-1"><UsersThree size={14}/>{agent.page_assignments?.length ?? 0} Páginas</span><span>v{agent.prompt_version}</span></div></div>
      </Link>;
    })}</div>}
  </div>;
}

function Filter({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-surface-2"}`}>{children}</button>; }
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) { return <label className="text-xs font-semibold text-muted-foreground">{label}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal text-foreground outline-none focus:border-primary"/></label>; }
