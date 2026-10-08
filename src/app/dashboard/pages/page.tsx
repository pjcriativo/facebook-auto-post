"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowClockwise, Star, FlagBanner, Info, Plus } from "@phosphor-icons/react/dist/ssr";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { AgentLanguage, ContentAgent, PageCache } from "@/lib/types";

const LANGUAGE_LABELS: Record<AgentLanguage, string> = {
  "pt-BR": "Português", "en-US": "Inglês", "es-419": "Espanhol", "de-DE": "Alemão", "fr-FR": "Francês",
};

export default function PagesPage() {
  const [pages, setPages] = useState<PageCache[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [agents, setAgents] = useState<ContentAgent[]>([]);
  const [assignmentSaving, setAssignmentSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notConnected, setNotConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageReference, setPageReference] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    setNotConnected(false);
    try {
      const [res, agentsRes] = await Promise.all([
        fetch(`/api/facebook/pages${refresh ? "?refresh=1" : ""}`),
        fetch("/api/agents"),
      ]);
      const [data, agentsData] = await Promise.all([res.json(), agentsRes.json()]);
      if (res.status === 409) {
        setNotConnected(true);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Não foi possível carregar as Páginas.");
      setPages(data.pages ?? []);
      setDefaultId(data.defaultPageId ?? null);
      if (agentsRes.ok) setAgents((agentsData.agents ?? []).filter((agent: ContentAgent) => agent.enabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar as Páginas.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  async function setDefault(page: PageCache) {
    setDefaultId(page.page_id);
    setError(null);
    // Only the id is sent: the server re-fetches the Page token itself so a
    // publishing credential never travels through the browser.
    const res = await fetch("/api/facebook/default-page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId: page.page_id }),
    });
    if (!res.ok) {
      setDefaultId(null);
      setError((await res.json()).error ?? "Não foi possível definir essa Página como padrão.");
    }
  }

  async function addPage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pageReference.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/facebook/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: pageReference }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Não foi possível adicionar essa Página.");
      setPageReference("");
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível adicionar essa Página.");
    } finally {
      setAdding(false);
    }
  }

  function assignmentFor(pageId: string) {
    for (const agent of agents) {
      const assignment = agent.page_assignments?.find((item) => item.page_id === pageId);
      if (assignment) return { agent, assignment };
    }
    return null;
  }

  async function changeAgent(pageId: string, agentId: string, language: AgentLanguage = "pt-BR") {
    setAssignmentSaving(pageId); setError(null);
    try {
      const response = agentId
        ? await fetch(`/api/pages/${encodeURIComponent(pageId)}/agent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId, language }) })
        : await fetch(`/api/pages/${encodeURIComponent(pageId)}/agent`, { method: "DELETE" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Não foi possível alterar o agente responsável.");
      await load(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível alterar o agente responsável."); }
    finally { setAssignmentSaving(null); }
  }

  if (notConnected) {
    return (
      <Card className="py-10 text-center">
        <p className="font-medium text-foreground">O Facebook ainda não está conectado</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Conecte sua conta para ver as Páginas em que você pode publicar.
        </p>
        <Link href="/dashboard/settings" className="mt-4 inline-block">
          <Button size="sm">Ir para configurações</Button>
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Escolha a Página em que os novos posts serão publicados. Somente Páginas nas quais você pode criar conteúdo são exibidas.
        </p>
        <Button size="sm" variant="secondary" onClick={() => load(true)} disabled={refreshing}>
          <ArrowClockwise size={14} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Atualizando…" : "Atualizar pelo Facebook"}
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
        <Info size={19} className="mt-0.5 shrink-0 text-primary" />
        <div>
          <p className="font-semibold text-foreground">Uma Página conhecida não aparece?</p>
          <p className="mt-1 text-muted-foreground">
            Algumas Páginas de portfólios empresariais não aparecem na lista automática da Meta.
            Se isso acontecer, cole abaixo a URL ou o ID. O painel só adiciona a Página se a conta
            conectada tiver permissão para publicar nela.
          </p>
        </div>
      </div>

      <Card>
        <form onSubmit={addPage} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-sm font-medium text-foreground">
            Adicionar Página por URL ou ID
            <input
              value={pageReference}
              onChange={(event) => setPageReference(event.target.value)}
              placeholder="https://www.facebook.com/sua-pagina"
              className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal outline-none transition focus:border-primary"
            />
          </label>
          <Button type="submit" disabled={adding || !pageReference.trim()}>
            <Plus size={15} />
            {adding ? "Adicionando…" : "Adicionar Página"}
          </Button>
        </form>
      </Card>

      <Card>
        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : pages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Ainda não há Páginas em cache — clique em &quot;Atualizar pelo Facebook&quot;.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {pages.map((page) => {
              const isDefault = page.page_id === defaultId;
              const responsible = assignmentFor(page.page_id);
              const enabledLanguages = responsible?.agent.languages?.filter((item) => item.enabled) ?? [];
              return (
                <div key={page.page_id} className="flex flex-col gap-3 py-4 xl:flex-row xl:items-center">
                  <div className="flex items-center gap-3">
                    <FlagBanner size={16} className="text-muted-foreground" />
                    <div className="min-w-52">
                      <p className="font-medium text-foreground">{page.name}</p>
                      {page.category && (
                        <p className="text-xs text-muted-foreground">{page.category}</p>
                      )}
                    </div>
                  </div>
                  <div className="grid flex-1 gap-2 sm:grid-cols-2 xl:max-w-2xl">
                    <label className="text-xs font-semibold text-muted-foreground">Agente responsável<select value={responsible?.agent.id ?? ""} disabled={assignmentSaving === page.page_id} onChange={(event) => changeAgent(page.page_id, event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal text-foreground outline-none focus:border-primary"><option value="">Sem agente</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
                    <label className="text-xs font-semibold text-muted-foreground">Idioma da Página<select value={responsible?.assignment.language ?? "pt-BR"} disabled={!responsible || assignmentSaving === page.page_id} onChange={(event) => responsible && changeAgent(page.page_id, responsible.agent.id, event.target.value as AgentLanguage)} className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal text-foreground outline-none focus:border-primary disabled:opacity-50">{(enabledLanguages.length ? enabledLanguages.map((item) => item.locale) : Object.keys(LANGUAGE_LABELS) as AgentLanguage[]).map((locale) => <option key={locale} value={locale}>{LANGUAGE_LABELS[locale]}</option>)}</select></label>
                  </div>
                  <Button size="sm" variant={isDefault ? "primary" : "secondary"} onClick={() => setDefault(page)}><Star size={14} weight={isDefault ? "fill" : "regular"}/>{isDefault ? "Padrão" : "Definir como padrão"}</Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
