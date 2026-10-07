"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Sparkle,
  ArrowClockwise,
  FloppyDisk,
  Rocket,
  CalendarPlus,
  X,
  WarningCircle,
  CheckCircle,
  ArrowSquareOut,
} from "@phosphor-icons/react/dist/ssr";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { facebookPostUrl } from "@/lib/types";
import type { GeneratedContent, ImageSource, ImageSourcePref, PageCache } from "@/lib/types";

type Step = "idle" | "generating" | "ready";

export default function GeneratePage() {
  const [topic, setTopic] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [ownTopics, setOwnTopics] = useState<string[]>([]);
  const [imagePref, setImagePref] = useState<ImageSourcePref>("ai");

  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);

  const [content, setContent] = useState<GeneratedContent | null>(null);
  const [image, setImage] = useState<{ url: string; source: ImageSource } | null>(null);
  const [hashtagInput, setHashtagInput] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  const [pages, setPages] = useState<PageCache[]>([]);
  const [pageId, setPageId] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState<"draft" | "schedule" | "post_now" | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  useEffect(() => {
    // Arriving from the Topics screen's "write now" link. Read directly rather
    // than through useSearchParams, which would force a Suspense boundary
    // around the whole form for one optional value.
    const fromLink = new URLSearchParams(window.location.search).get("topic");
    if (fromLink) setTopic(fromLink);

    fetch("/api/topics")
      .then((r) => r.json())
      .then((d) =>
        setOwnTopics(
          (d.topics ?? [])
            .filter((t: { enabled: boolean }) => t.enabled)
            .map((t: { text: string }) => t.text)
        )
      )
      .catch(() => {});

    fetch("/api/trends")
      .then((r) => r.json())
      .then((d) => setSuggestions(d.topics ?? []))
      .catch(() => {});

    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setImagePref(d.image_source ?? "ai"))
      .catch(() => {});

    fetch("/api/facebook/pages")
      .then((r) => r.json())
      .then((d) => {
        setPages(d.pages ?? []);
        if (d.defaultPageId) setPageId(d.defaultPageId);
      })
      .catch(() => {});
  }, []);

  const selectedPage = useMemo(() => pages.find((p) => p.page_id === pageId), [pages, pageId]);

  async function generate() {
    if (topic.trim().length < 2) {
      setError("Informe primeiro um tema com pelo menos algumas palavras.");
      return;
    }
    setError(null);
    setSuccess(null);
    setPublishedUrl(null);
    setStep("generating");
    setContent(null);
    setImage(null);

    try {
      const [contentRes, imageRes] = await Promise.all([
        fetch("/api/generate/content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic }),
        }),
        fetch("/api/generate/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: topic, source: imagePref }),
        }),
      ]);

      if (!contentRes.ok) throw new Error((await contentRes.json()).error ?? "Não foi possível gerar o conteúdo.");
      if (!imageRes.ok) throw new Error((await imageRes.json()).error ?? "Não foi possível gerar a imagem.");

      const contentData: GeneratedContent = await contentRes.json();
      const imageData: { url: string; source: ImageSource } = await imageRes.json();

      setContent(contentData);
      setImage(imageData);
      setStep("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo deu errado.");
      setStep("idle");
    }
  }

  function removeHashtag(tag: string) {
    if (!content) return;
    setContent({ ...content, hashtags: content.hashtags.filter((h) => h !== tag) });
  }

  function addHashtag() {
    const tag = hashtagInput.trim().replace(/^#/, "").toLowerCase();
    if (!tag || !content || content.hashtags.includes(tag)) return;
    setContent({ ...content, hashtags: [...content.hashtags, tag] });
    setHashtagInput("");
  }

  async function save(action: "draft" | "schedule" | "post_now") {
    if (!content || !image) return;
    if (action !== "draft" && !pageId) {
      setError("Escolha uma Página antes de agendar ou publicar.");
      return;
    }
    if (action === "schedule" && !scheduledAt) {
      setError("Escolha uma data e um horário para agendar este post.");
      return;
    }

    setError(null);
    setSaving(action);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          title: content.title,
          description: content.description,
          hashtags: content.hashtags,
          imageUrl: image.url,
          imageSource: image.source,
          linkUrl: linkUrl || undefined,
          pageId: pageId || selectedPage?.page_id || "não definido",
          pageName: selectedPage?.name ?? "Não definida",
          action,
          scheduledAt: action === "schedule" ? new Date(scheduledAt).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Não foi possível salvar o post.");

      if (action === "post_now" && data.post.status === "failed") {
        throw new Error(data.post.error_message ?? "O Facebook rejeitou este post.");
      }

      setSuccess(
        action === "draft"
          ? "Salvo como rascunho."
          : action === "schedule"
            ? "Post agendado."
            : "Publicado no Facebook 🎉"
      );
      setPublishedUrl(
        action === "post_now" && data.post.facebook_post_id
          ? facebookPostUrl(data.post.facebook_post_id)
          : null
      );
      setStep("idle");
      setContent(null);
      setImage(null);
      setTopic("");
      setScheduleOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o post.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Card>
        <label className="text-sm font-semibold text-foreground">Tema</label>
        <p className="mt-1 text-sm text-muted-foreground">
          Sobre o que será este post? Seja específico para obter resultados melhores.
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && generate()}
            placeholder="Ex.: ideias de decoração aconchegante para sala"
            className="flex-1 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
          <select
            value={imagePref}
            onChange={(e) => setImagePref(e.target.value as ImageSourcePref)}
            className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            aria-label="Fonte da imagem"
          >
            <option value="ai">Imagem gerada por IA</option>
            <option value="stock">Foto gratuita de banco de imagens</option>
            <option value="mixed">Combinar as duas opções</option>
          </select>
          <Button onClick={generate} disabled={step === "generating"}>
            <Sparkle size={16} weight="fill" />
            {step === "generating" ? "Gerando…" : "Gerar"}
          </Button>
        </div>

        {ownTopics.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="mt-1 text-xs font-medium text-muted-foreground">Seus temas:</span>
            {ownTopics.slice(0, 10).map((t) => (
              <button
                key={t}
                onClick={() => setTopic(t)}
                className="cursor-pointer rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs text-primary transition hover:border-primary"
              >
                {t}
              </button>
            ))}
            <Link
              href="/dashboard/topics"
              className="mt-0.5 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
            >
              Gerenciar
            </Link>
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="mt-1 text-xs font-medium text-muted-foreground">Ideias em alta:</span>
            {suggestions.slice(0, 8).map((s) => (
              <button
                key={s}
                onClick={() => setTopic(s)}
                className="cursor-pointer rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition hover:border-primary hover:text-primary"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </Card>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive">
          <WarningCircle size={18} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-success/30 bg-success/10 p-3.5 text-sm text-success">
          <CheckCircle size={18} className="shrink-0" />
          {success}
          {publishedUrl && (
            <a
              href={publishedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"
            >
              Ver post <ArrowSquareOut size={13} />
            </a>
          )}
        </div>
      )}

      {step === "generating" && (
        <Card className="animate-pulse">
          <div className="grid gap-6 md:grid-cols-[320px_1fr]">
            <div className="aspect-square rounded-xl bg-surface-2" />
            <div className="space-y-3">
              <div className="h-6 w-3/4 rounded bg-surface-2" />
              <div className="h-4 w-full rounded bg-surface-2" />
              <div className="h-4 w-5/6 rounded bg-surface-2" />
              <div className="h-4 w-2/3 rounded bg-surface-2" />
            </div>
          </div>
        </Card>
      )}

      {step === "ready" && content && image && (
        <Card>
          <div className="grid gap-6 md:grid-cols-[320px_1fr]">
            <div>
              <div className="relative aspect-square overflow-hidden rounded-xl bg-surface-2">
                <Image src={image.url} alt={content.title} fill unoptimized className="object-cover" />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <Badge>{image.source === "ai" ? "Gerada por IA" : "Banco de imagens"}</Badge>
                <button
                  onClick={generate}
                  className="flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary"
                >
                  <ArrowClockwise size={13} /> Gerar novamente
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {content.provider === "template" ? (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  Nenhum serviço de IA respondeu, então este texto veio de um modelo básico.
                  Edite-o antes de publicar ou configure e teste uma chave na aba APIs.
                </p>
              ) : content.provider ? (
                <p className="text-xs text-muted-foreground">
                  Texto criado por <span className="font-medium capitalize">{content.provider}</span>
                </p>
              ) : null}

              <div>
                <label className="text-xs font-semibold text-muted-foreground">Chamada inicial</label>
                <input
                  value={content.title}
                  maxLength={120}
                  onChange={(e) => setContent({ ...content, title: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground">Descrição</label>
                <textarea
                  value={content.description}
                  maxLength={500}
                  rows={3}
                  onChange={(e) => setContent({ ...content, description: e.target.value })}
                  className="mt-1 w-full resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground">Hashtags</label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {content.hashtags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent"
                    >
                      #{tag}
                      <button onClick={() => removeHashtag(tag)} aria-label={`Remover ${tag}`} className="cursor-pointer">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  <input
                    value={hashtagInput}
                    onChange={(e) => setHashtagInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addHashtag())}
                    placeholder="adicionar…"
                    className="w-24 rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 text-xs outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground">Link (opcional)</label>
                <input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://seu-site.com.br/post"
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground">Página</label>
                <select
                  value={pageId}
                  onChange={(e) => setPageId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary"
                >
                  <option value="">Selecione uma Página…</option>
                  {pages.map((p) => (
                    <option key={p.page_id} value={p.page_id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {pages.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Nenhuma Página encontrada. Conecte o Facebook nas Configurações primeiro.
                  </p>
                )}
              </div>

              {scheduleOpen && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Agendar para</label>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary"
                  />
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="secondary" onClick={() => save("draft")} disabled={saving !== null}>
                  <FloppyDisk size={16} /> Salvar rascunho
                </Button>
                {scheduleOpen ? (
                  <Button variant="secondary" onClick={() => save("schedule")} disabled={saving !== null}>
                    <CalendarPlus size={16} /> {saving === "schedule" ? "Agendando…" : "Confirmar agendamento"}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => setScheduleOpen(true)} disabled={saving !== null}>
                    <CalendarPlus size={16} /> Agendar
                  </Button>
                )}
                <Button onClick={() => save("post_now")} disabled={saving !== null}>
                  <Rocket size={16} weight="fill" /> {saving === "post_now" ? "Publicando…" : "Publicar agora"}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
