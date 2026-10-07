"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowClockwise, Star, FlagBanner } from "@phosphor-icons/react/dist/ssr";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { PageCache } from "@/lib/types";

export default function PagesPage() {
  const [pages, setPages] = useState<PageCache[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notConnected, setNotConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    setNotConnected(false);
    try {
      const res = await fetch(`/api/facebook/pages${refresh ? "?refresh=1" : ""}`);
      const data = await res.json();
      if (res.status === 409) {
        setNotConnected(true);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Não foi possível carregar as Páginas.");
      setPages(data.pages ?? []);
      setDefaultId(data.defaultPageId ?? null);
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
              return (
                <div key={page.page_id} className="flex items-center justify-between py-3.5">
                  <div className="flex items-center gap-3">
                    <FlagBanner size={16} className="text-muted-foreground" />
                    <div>
                      <p className="font-medium text-foreground">{page.name}</p>
                      {page.category && (
                        <p className="text-xs text-muted-foreground">{page.category}</p>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={isDefault ? "primary" : "secondary"}
                    onClick={() => setDefault(page)}
                  >
                    <Star size={14} weight={isDefault ? "fill" : "regular"} />
                    {isDefault ? "Padrão" : "Definir como padrão"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
