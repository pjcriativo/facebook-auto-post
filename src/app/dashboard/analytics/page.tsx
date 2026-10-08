"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowClockwise, ArrowSquareOut, ChartBar, ChatCircle, Heart, Robot, ShareNetwork, Sparkle } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface AnalyticsReport {
  totals: { posts: number; measured: number; reactions: number; comments: number; shares: number; viralScore: number };
  lastSyncedAt: string | null;
  agents: Array<{ agentId: string | null; agentName: string; posts: number; measured: number; reactions: number; comments: number; shares: number; viralScore: number }>;
  topPosts: Array<{ id: string; title: string; pageName: string | null; postedAt: string | null; imageUrl: string; agentId: string | null; agentName: string; language: string | null; reactions: number; comments: number; shares: number; viralScore: number; permalinkUrl: string | null; fetchedAt: string }>;
}

export default function AnalyticsPage() {
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/analytics/report");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Não foi possível carregar as métricas.");
    setReport(body);
  }

  useEffect(() => {
    // Initial synchronization of this client view with the authenticated report API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar as métricas.")).finally(() => setLoading(false));
  }, []);

  async function sync() {
    setSyncing(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/analytics/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "A sincronização falhou.");
      const failed = body.failures?.length ?? 0;
      setMessage(`${body.updated} post(s) atualizado(s)${failed ? `; ${failed} não puderam ser lidos pela Meta` : ""}.`);
      if (failed) setError(body.failures[0]?.error ?? "A Meta não permitiu ler alguns posts.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "A sincronização falhou."); }
    finally { setSyncing(false); }
  }

  if (loading) return <Card className="py-14 text-center text-sm text-muted-foreground">Carregando métricas…</Card>;

  return <div className="space-y-5">
    <Card className="flex flex-col justify-between gap-4 bg-gradient-to-br from-primary/10 via-surface to-surface sm:flex-row sm:items-center"><div className="flex gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><ChartBar size={26} weight="fill"/></span><div><h2 className="font-heading text-xl font-bold">Desempenho real dos conteúdos</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Compare posts e agentes usando reações, comentários e compartilhamentos obtidos diretamente da Meta.</p></div></div><Button onClick={sync} disabled={syncing}><ArrowClockwise size={16}/>{syncing ? "Sincronizando…" : "Atualizar métricas"}</Button></Card>
    {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive">{error}</div>}
    {message && <div className="rounded-xl border border-success/30 bg-success/10 p-3.5 text-sm text-success">{message}</div>}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><Metric label="Posts medidos" value={`${report?.totals.measured ?? 0}/${report?.totals.posts ?? 0}`} icon={<ChartBar size={19}/>}/><Metric label="Reações" value={report?.totals.reactions ?? 0} icon={<Heart size={19}/>}/><Metric label="Comentários" value={report?.totals.comments ?? 0} icon={<ChatCircle size={19}/>}/><Metric label="Compartilhamentos" value={report?.totals.shares ?? 0} icon={<ShareNetwork size={19}/>}/><Metric label="Potencial viral" value={report?.totals.viralScore ?? 0} icon={<Sparkle size={19}/>}/></div>
    <p className="text-xs text-muted-foreground">Potencial viral: 1 ponto por reação, 3 por comentário e 5 por compartilhamento. Última leitura: {report?.lastSyncedAt ? new Date(report.lastSyncedAt).toLocaleString("pt-BR") : "ainda não sincronizado"}.</p>

    <Card><h3 className="font-heading font-bold">Resultado por agente</h3><p className="mt-1 text-sm text-muted-foreground">O ranking usa apenas posts publicados que já possuem uma leitura da Meta.</p>{!report?.agents.length ? <Empty/> : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="pb-2">Agente</th><th className="pb-2 text-right">Posts medidos</th><th className="pb-2 text-right">Reações</th><th className="pb-2 text-right">Comentários</th><th className="pb-2 text-right">Compart.</th><th className="pb-2 text-right">Potencial</th></tr></thead><tbody>{report.agents.map((agent) => <tr key={agent.agentId ?? "global"} className="border-b border-border last:border-0"><td className="py-3 font-medium"><span className="inline-flex items-center gap-2"><Robot size={16} className="text-primary"/>{agent.agentId ? <Link href={`/dashboard/agents/${agent.agentId}`} className="hover:text-primary hover:underline">{agent.agentName}</Link> : agent.agentName}</span></td><td className="py-3 text-right">{agent.measured}/{agent.posts}</td><td className="py-3 text-right">{agent.reactions}</td><td className="py-3 text-right">{agent.comments}</td><td className="py-3 text-right font-semibold">{agent.shares}</td><td className="py-3 text-right font-bold text-primary">{agent.viralScore}</td></tr>)}</tbody></table></div>}</Card>

    <Card><h3 className="font-heading font-bold">Posts com maior potencial viral</h3><p className="mt-1 text-sm text-muted-foreground">Use este ranking para descobrir temas, ganchos e agentes que merecem novas variações.</p>{!report?.topPosts.length ? <Empty/> : <div className="mt-4 grid gap-3 lg:grid-cols-2">{report.topPosts.map((post, index) => <div key={post.id} className="flex gap-3 rounded-xl border border-border bg-background p-3"><div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-surface-2"><Image src={post.imageUrl} alt="" fill unoptimized className="object-cover"/><span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-xs font-bold text-white">#{index + 1}</span></div><div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm font-semibold">{post.title}</p><p className="mt-1 text-xs text-muted-foreground">{post.agentName}{post.language ? ` · ${post.language}` : ""}</p><div className="mt-2 flex flex-wrap gap-3 text-xs"><span>❤️ {post.reactions}</span><span>💬 {post.comments}</span><span className="font-semibold">↗ {post.shares}</span><span className="font-bold text-primary">{post.viralScore} pts</span>{post.permalinkUrl && <a href={post.permalinkUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-primary">Abrir <ArrowSquareOut size={12}/></a>}</div></div></div>)}</div>}</Card>
  </div>;
}

function Metric({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) { return <Card className="p-4"><span className="text-primary">{icon}</span><strong className="mt-2 block text-2xl">{value}</strong><span className="text-xs text-muted-foreground">{label}</span></Card>; }
function Empty() { return <p className="py-10 text-center text-sm text-muted-foreground">Ainda não há métricas. Publique conteúdos e clique em “Atualizar métricas”.</p>; }
