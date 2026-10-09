"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ListBullets,
  Shuffle,
  TrendUp,
  Plus,
  Trash,
  PencilSimpleLine,
  WarningCircle,
  CheckCircle,
} from "@phosphor-icons/react/dist/ssr";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { PageCache, Topic, TopicSource } from "@/lib/types";

const SOURCES: {
  value: TopicSource;
  title: string;
  body: string;
  icon: typeof ListBullets;
}[] = [
  {
    value: "mine",
    title: "Seus temas",
    body: "Percorre sua lista, começando pelos menos usados recentemente. Usa ideias em alta somente enquanto a lista estiver vazia.",
    icon: ListBullets,
  },
  {
    value: "mixed",
    title: "Misturar os dois",
    body: "Usa aproximadamente metade da sua lista e metade de ideias em alta.",
    icon: Shuffle,
  },
  {
    value: "trending",
    title: "Ideias em alta",
    body: "Usa o Google Trends e uma lista interna de ideias atemporais. Sua lista fica salva, mas não é usada.",
    icon: TrendUp,
  },
];

const PLACEHOLDER = `Ideias de Reels para pequenos negócios
Como planejar um mês de posts para redes sociais
Erros que marcas cometem em anúncios no Facebook
Por que consistência é melhor que viralidade`;

function relativeTime(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "agora mesmo";
}

export default function TopicsPage() {
  const [pages, setPages] = useState<PageCache[]>([]);
  const [pageId, setPageId] = useState<string>("");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [source, setSource] = useState<TopicSource>("mine");
  const [nextId, setNextId] = useState<string | null>(null);
  const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [savingSource, setSavingSource] = useState(false);

  const load = useCallback(async () => {
    try {
      const query = pageId ? `?pageId=${encodeURIComponent(pageId)}` : "";
      const res = await fetch(`/api/topics${query}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Não foi possível carregar seus temas.");
      setTopics(data.topics ?? []);
      setSource(data.source ?? "mine");
      setNextId(data.nextId ?? null);
      setUpgradeMessage(data.ready === false ? data.message : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar seus temas.");
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    fetch("/api/facebook/pages")
      .then((res) => res.json())
      .then((data) => {
        const available = (data.pages ?? []) as PageCache[];
        setPages(available);
        if (data.defaultPageId && available.some((page) => page.page_id === data.defaultPageId)) {
          setPageId(data.defaultPageId);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pendingLines = useMemo(
    () => draft.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    [draft]
  );
  const activeCount = topics.filter((t) => t.enabled).length;

  async function add() {
    if (pendingLines.length === 0) return;
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: pendingLines, pageId: pageId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Não foi possível adicionar esses temas.");

      const parts = [`${data.added} tema${data.added === 1 ? " adicionado" : "s adicionados"}`];
      if (data.skipped) parts.push(`${data.skipped} já existente${data.skipped === 1 ? " foi ignorado" : "s foram ignorados"}`);
      setNotice(parts.join(", ") + ".");
      setDraft("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível adicionar esses temas.");
    } finally {
      setAdding(false);
    }
  }

  async function toggle(topic: Topic) {
    setBusyId(topic.id);
    setError(null);
    setTopics((list) => list.map((t) => (t.id === topic.id ? { ...t, enabled: !t.enabled } : t)));
    try {
      const res = await fetch(`/api/topics/${topic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !topic.enabled }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Não foi possível atualizar esse tema.");
      // "Next up" can move when a topic is switched on or off.
      await load();
    } catch (err) {
      setTopics((list) => list.map((t) => (t.id === topic.id ? topic : t)));
      setError(err instanceof Error ? err.message : "Não foi possível atualizar esse tema.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/topics/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Não foi possível excluir esse tema.");
      setConfirmingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível excluir esse tema.");
    } finally {
      setBusyId(null);
    }
  }

  async function chooseSource(value: TopicSource) {
    if (value === source) return;
    const previous = source;
    setSource(value);
    setSavingSource(true);
    setError(null);
    try {
      const res = await fetch(pageId ? `/api/pages/${pageId}/automation` : "/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic_source: value }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Não foi possível salvar essa escolha.");
    } catch (err) {
      setSource(previous);
      setError(err instanceof Error ? err.message : "Não foi possível salvar essa escolha.");
    } finally {
      setSavingSource(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }

  if (upgradeMessage) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="border-warning/40 bg-warning/5">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
              <WarningCircle size={22} weight="bold" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-foreground">Falta uma etapa no banco para ativar os temas</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Seu banco foi criado antes do recurso de temas. Abra o Supabase, acesse{" "}
                <strong>SQL Editor → New query</strong>, cole todo o arquivo{" "}
                <code className="rounded bg-surface-2 px-1 text-xs">supabase/schema.sql</code> do
                repositório novamente e clique em <strong>Run</strong>.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                É seguro executar novamente: apenas o que estiver faltando será adicionado,
                sem alterar posts, configurações ou conexão. Até lá, o piloto automático
                continuará usando ideias em alta.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive"
        >
          <WarningCircle size={18} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <Card>
        <label htmlFor="topic-page" className="font-heading font-bold text-foreground">
          Página desta biblioteca
        </label>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Cada Página possui seus próprios temas. A biblioteca geral funciona como reserva para todas elas.
        </p>
        <select
          id="topic-page"
          value={pageId}
          onChange={(event) => {
            setLoading(true);
            setPageId(event.target.value);
          }}
          className="mt-3 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
        >
          <option value="">Biblioteca geral (reserva)</option>
          {pages.map((page) => <option key={page.page_id} value={page.page_id}>{page.name}</option>)}
        </select>
      </Card>

      {/* Where autopilot's subjects come from */}
      <Card>
        <h2 className="font-heading font-bold text-foreground">Sobre o que o piloto automático escreve</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Cada post automático usa um tema. Escolha de onde esses temas serão obtidos.
        </p>

        <div role="radiogroup" aria-label="Origem dos temas" className="mt-4 grid gap-3 sm:grid-cols-3">
          {SOURCES.map((option) => {
            const selected = option.value === source;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={savingSource}
                onClick={() => chooseSource(option.value)}
                className={cn(
                  "flex cursor-pointer flex-col items-start gap-2 rounded-xl border p-3.5 text-left transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  selected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40 hover:bg-surface-2"
                )}
              >
                <Icon
                  size={20}
                  weight={selected ? "fill" : "regular"}
                  className={selected ? "text-primary" : "text-muted-foreground"}
                />
                <span className="text-sm font-semibold text-foreground">{option.title}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{option.body}</span>
              </button>
            );
          })}
        </div>

        {source !== "trending" && activeCount === 0 && (
          <p className="mt-3 text-xs text-warning">
            Sua lista não tem temas ativos, então o piloto automático usará ideias em alta até você adicionar algum.
          </p>
        )}
        {source === "trending" && activeCount > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {activeCount === 1 ? "Seu tema está salvo" : `Seus ${activeCount} temas estão salvos`}, mas não será{activeCount === 1 ? "" : "ão"} usado{activeCount === 1 ? "" : "s"} enquanto esta opção estiver definida como ideias em alta.
          </p>
        )}
      </Card>

      {/* Add */}
      <Card>
        <label htmlFor="new-topics" className="font-heading font-bold text-foreground">
          Adicionar temas
        </label>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Insira um por linha — pode ser uma palavra-chave ou uma ideia completa. Cole uma
          lista inteira de uma vez; itens que já estiverem na lista serão ignorados.
        </p>
        <textarea
          id="new-topics"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setNotice(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) add();
          }}
          rows={5}
          placeholder={PLACEHOLDER}
          className="mt-3 w-full resize-y rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm leading-relaxed outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={add} disabled={adding || pendingLines.length === 0}>
            <Plus size={16} weight="bold" />
            {adding
              ? "Adicionando…"
              : pendingLines.length > 1
                ? `Adicionar ${pendingLines.length} temas`
                : "Adicionar tema"}
          </Button>
          {notice && (
            <span role="status" className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle size={16} /> {notice}
            </span>
          )}
        </div>
      </Card>

      {/* List */}
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-heading font-bold text-foreground">Seus temas</h2>
          {topics.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {activeCount} de {topics.length} ativo{activeCount === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {topics.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Ainda não há temas. Adicione alguns acima para o piloto automático começar a usá-los.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {topics.map((topic) => {
              const isNext = topic.id === nextId && source !== "trending";
              const confirming = confirmingId === topic.id;
              return (
                <li key={topic.id} className="flex items-center gap-3 py-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={topic.enabled}
                    aria-label={`${topic.enabled ? "Pausar" : "Usar"} “${topic.text}”`}
                    disabled={busyId === topic.id}
                    onClick={() => toggle(topic)}
                    className={cn(
                      "relative h-6 w-10 shrink-0 cursor-pointer rounded-full transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      topic.enabled ? "bg-primary" : "bg-surface-2"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-[left]",
                        topic.enabled ? "left-5" : "left-1"
                      )}
                    />
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p
                        className={cn(
                          "break-words text-sm font-medium",
                          topic.enabled ? "text-foreground" : "text-muted-foreground line-through"
                        )}
                      >
                        {topic.text}
                      </p>
                      {isNext && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                          Próximo
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {topic.use_count > 0 && topic.last_used_at
                        ? `Usado ${topic.use_count}× · última vez ${relativeTime(topic.last_used_at)}`
                        : "Ainda não usado"}
                    </p>
                  </div>

                  {confirming ? (
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => remove(topic.id)}
                        disabled={busyId === topic.id}
                        className="text-destructive"
                      >
                        Excluir
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)}>
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      <Link
                        href={`/dashboard/generate?topic=${encodeURIComponent(topic.text)}`}
                        aria-label={`Escrever agora um post sobre “${topic.text}”`}
                        title="Escrever um post sobre este tema agora"
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-surface-2 hover:text-primary"
                      >
                        <PencilSimpleLine size={17} />
                      </Link>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(topic.id)}
                        aria-label={`Excluir “${topic.text}”`}
                        title="Excluir"
                        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash size={17} />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
