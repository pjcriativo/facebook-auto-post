"use client";

import { useEffect, useState } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { facebookPostUrl } from "@/lib/types";
import type { Post, PostStatus } from "@/lib/types";

const FILTERS: { label: string; value: PostStatus | "all" }[] = [
  { label: "Todos", value: "all" },
  { label: "Publicados", value: "posted" },
  { label: "Com falha", value: "failed" },
];

export default function HistoryPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [filter, setFilter] = useState<PostStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/posts?status=${filter === "all" ? "posted,failed" : filter}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Não foi possível carregar o histórico.");
        setPosts(data.posts ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível carregar o histórico."))
      .finally(() => setLoading(false));
  }, [filter]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-medium transition",
              filter === f.value
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:bg-surface-2"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive">
          {error}
        </div>
      )}

      {!error && (
      <Card>
        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : posts.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Ainda não há posts aqui.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Post</th>
                  <th className="hidden pb-2 font-medium sm:table-cell">Página</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Data</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr key={post.id} className="border-b border-border last:border-0">
                    <td className="max-w-[260px] py-3 pr-3">
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={post.image_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{post.title}</p>
                          {post.status === "failed" && post.error_message && (
                            <p className="truncate text-xs text-destructive">{post.error_message}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="hidden py-3 pr-3 text-muted-foreground sm:table-cell">
                      {post.page_name ?? "—"}
                    </td>
                    <td className="py-3 pr-3">
                      <StatusBadge status={post.status} />
                    </td>
                    <td className="py-3 pr-3 text-xs text-muted-foreground">
                      {new Date(post.posted_at ?? post.created_at).toLocaleString("pt-BR", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-3 text-right">
                      {post.facebook_post_id && (
                        <a
                          href={facebookPostUrl(post.facebook_post_id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          Ver <ArrowSquareOut size={12} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      )}
    </div>
  );
}
