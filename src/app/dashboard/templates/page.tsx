"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  CheckCircle,
  FloppyDisk,
  ImageSquare,
  Plus,
  SpinnerGap,
  Trash,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ContentTemplate } from "@/lib/types";

const SAMPLE_TEXT =
  "Continue firme, mesmo quando o caminho parecer difícil.\n\nA sua fé é maior do que este momento.\n\nRespire. Deus continua cuidando de você.";

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [sampleText, setSampleText] = useState(SAMPLE_TEXT);
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? null,
    [templates, selectedId]
  );

  async function load(preferredId?: string) {
    const response = await fetch("/api/templates");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Não foi possível carregar os templates.");
    const nextTemplates: ContentTemplate[] = body.templates ?? [];
    setTemplates(nextTemplates);
    setSelectedId((current) => {
      const target = preferredId ?? current;
      return nextTemplates.some((template) => template.id === target)
        ? target
        : (nextTemplates[0]?.id ?? "");
    });
  }

  useEffect(() => {
    void Promise.resolve()
      .then(() => load())
      .catch((error) =>
        setMessage({ ok: false, text: error instanceof Error ? error.message : "Falha ao carregar." })
      );
  }, []);

  function updateLocal(patch: Partial<ContentTemplate>) {
    setTemplates((current) =>
      current.map((template) => (template.id === selectedId ? { ...template, ...patch } : template))
    );
    setRenderedUrl(null);
  }

  async function create() {
    setBusy("create");
    setMessage(null);
    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Novo template", handle: "pr.marcosgp" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível criar o template.");
      await load(body.template.id);
      setMessage({ ok: true, text: "Template criado. Agora personalize e salve." });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Falha ao criar." });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!selected) return;
    setBusy("save");
    setMessage(null);
    try {
      const response = await fetch(`/api/templates/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selected.name,
          handle: selected.handle,
          background_color: selected.background_color,
          text_color: selected.text_color,
          enabled: selected.enabled,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar o template.");
      setTemplates((current) => current.map((item) => (item.id === selected.id ? body.template : item)));
      setMessage({ ok: true, text: "Template salvo." });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Falha ao salvar." });
    } finally {
      setBusy(null);
    }
  }

  async function uploadAvatar(file: File) {
    if (!selected) return;
    setBusy("avatar");
    setMessage(null);
    try {
      const data = new FormData();
      data.set("templateId", selected.id);
      data.set("avatar", file);
      const response = await fetch("/api/templates/avatar", { method: "POST", body: data });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível enviar a foto.");
      setTemplates((current) => current.map((item) => (item.id === selected.id ? body.template : item)));
      setRenderedUrl(null);
      setMessage({ ok: true, text: "Foto atualizada." });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Falha ao enviar a foto." });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function renderPreview() {
    if (!selected) return;
    setBusy("render");
    setMessage(null);
    try {
      const response = await fetch("/api/templates/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: selected.id, text: sampleText }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível gerar a prévia.");
      setRenderedUrl(body.url);
      setMessage({ ok: true, text: "Prévia PNG gerada sem consumir créditos de imagem por IA." });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Falha ao gerar a prévia." });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!selected || !window.confirm(`Excluir o template “${selected.name}”?`)) return;
    setBusy("delete");
    setMessage(null);
    try {
      const response = await fetch(`/api/templates/${selected.id}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível excluir o template.");
      await load();
      setRenderedUrl(null);
      setMessage({ ok: true, text: "Template excluído." });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Falha ao excluir." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Card>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ImageSquare size={22} weight="fill" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-foreground">Artes virais reutilizáveis</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                A IA escreve somente o texto. O painel monta a imagem com posição, fonte, foto e cores fixas,
                mantendo o mesmo visual em todos os posts e sem gastar geração de imagem.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={create} disabled={busy !== null}>
            <Plus size={15} /> Novo template
          </Button>
        </div>
      </Card>

      {message && (
        <div className={`flex items-center gap-2 rounded-xl border p-3.5 text-sm ${message.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
          {message.ok ? <CheckCircle size={18} /> : <WarningCircle size={18} />}
          {message.text}
        </div>
      )}

      {templates.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="font-medium text-foreground">Nenhum template cadastrado</p>
          <p className="mt-1 text-sm text-muted-foreground">Crie o primeiro modelo para começar.</p>
          <Button className="mt-4" size="sm" onClick={create} disabled={busy !== null}>
            <Plus size={15} /> Criar template
          </Button>
        </Card>
      ) : selected ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
          <Card className="space-y-5">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Template</label>
              <select
                value={selectedId}
                onChange={(event) => { setSelectedId(event.target.value); setRenderedUrl(null); }}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary"
              >
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Nome do modelo</label>
                <input value={selected.name} onChange={(event) => updateLocal({ name: event.target.value })} className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">@perfil exibido</label>
                <input value={selected.handle} onChange={(event) => updateLocal({ handle: event.target.value })} className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary" />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground">Foto redonda do perfil</label>
              <div className="mt-2 flex items-center gap-3">
                <div className="relative h-16 w-16 overflow-hidden rounded-full bg-surface-2">
                  {selected.avatar_url ? <Image src={selected.avatar_url} alt="Foto do template" fill unoptimized className="object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Foto</div>}
                </div>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => event.target.files?.[0] && uploadAvatar(event.target.files[0])} />
                <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
                  <UploadSimple size={15} /> {busy === "avatar" ? "Enviando…" : "Escolher foto"}
                </Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-semibold text-muted-foreground">Cor do fundo
                <span className="mt-1 flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
                  <input type="color" value={selected.background_color} onChange={(event) => updateLocal({ background_color: event.target.value })} className="h-7 w-9 cursor-pointer bg-transparent" />
                  <span className="font-mono font-normal">{selected.background_color}</span>
                </span>
              </label>
              <label className="text-xs font-semibold text-muted-foreground">Cor do texto
                <span className="mt-1 flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
                  <input type="color" value={selected.text_color} onChange={(event) => updateLocal({ text_color: event.target.value })} className="h-7 w-9 cursor-pointer bg-transparent" />
                  <span className="font-mono font-normal">{selected.text_color}</span>
                </span>
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={selected.enabled} onChange={(event) => updateLocal({ enabled: event.target.checked })} className="h-4 w-4 accent-primary" />
              Disponível na tela Criar post
            </label>

            <div>
              <label className="text-xs font-semibold text-muted-foreground">Texto para testar a arte</label>
              <textarea value={sampleText} maxLength={700} rows={7} onChange={(event) => { setSampleText(event.target.value); setRenderedUrl(null); }} className="mt-1 w-full resize-y rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary" />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={busy !== null}><FloppyDisk size={16} /> {busy === "save" ? "Salvando…" : "Salvar"}</Button>
              <Button variant="secondary" onClick={renderPreview} disabled={busy !== null || !selected.enabled || sampleText.trim().length < 2}>
                {busy === "render" ? <SpinnerGap size={16} className="animate-spin" /> : <ImageSquare size={16} />}
                Gerar PNG de teste
              </Button>
              <Button variant="danger" onClick={remove} disabled={busy !== null}><Trash size={16} /> Excluir</Button>
            </div>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-foreground">Prévia</h3>
            <div className="relative aspect-square overflow-hidden rounded-xl border border-border" style={{ backgroundColor: selected.background_color, color: selected.text_color }}>
              {renderedUrl ? (
                <Image src={renderedUrl} alt="Prévia renderizada do template" fill unoptimized className="object-cover" />
              ) : (
                <div className="absolute inset-0 p-[12%]">
                  <div className="flex items-center gap-[5%]">
                    <div className="relative aspect-square w-[17%] shrink-0 overflow-hidden rounded-full bg-white/30">
                      {selected.avatar_url && <Image src={selected.avatar_url} alt="" fill unoptimized className="object-cover" />}
                    </div>
                    <strong className="truncate text-[clamp(15px,3.4vw,30px)]">{selected.handle}</strong>
                  </div>
                  <p className="mt-[10%] whitespace-pre-line text-[clamp(15px,3.1vw,28px)] leading-[1.38]">{sampleText}</p>
                </div>
              )}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              “Gerar PNG de teste” mostra o arquivo final com as medidas exatas usadas na publicação.
            </p>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
