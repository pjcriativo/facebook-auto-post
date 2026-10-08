"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { CheckCircle, FloppyDisk, ImageSquare, Plus, SpinnerGap, Trash, UploadSimple, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AppSettings, ContentTemplate, PageCache } from "@/lib/types";

const SAMPLE_TEXT = "Jesus não prometeu uma vida sem aflições.\n\nPrometeu Sua paz em meio a elas.\n\nRespire.\n\nVocê pode confiar nEle.";

function identityImage(template: ContentTemplate, pages: PageCache[], settings: Partial<AppSettings>) {
  if (template.identity_source === "custom") return template.avatar_url;
  if (template.identity_source === "page") return pages.find((page) => page.page_id === template.page_id)?.picture_url ?? null;
  return settings.admin_avatar_url ?? template.avatar_url;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [pages, setPages] = useState<PageCache[]>([]);
  const [settings, setSettings] = useState<Partial<AppSettings>>({});
  const [selectedId, setSelectedId] = useState("");
  const [sampleText, setSampleText] = useState(SAMPLE_TEXT);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => templates.find((item) => item.id === selectedId) ?? null, [templates, selectedId]);

  function replacePreview(next: string | null) {
    setPreviewUrl((current) => {
      if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
      return next;
    });
  }

  async function load(preferredId?: string) {
    const [templateRes, pageRes, settingsRes] = await Promise.all([
      fetch("/api/templates"), fetch("/api/facebook/pages"), fetch("/api/settings"),
    ]);
    const templateBody = await templateRes.json();
    if (!templateRes.ok) throw new Error(templateBody.error ?? "Não foi possível carregar os templates.");
    const next: ContentTemplate[] = templateBody.templates ?? [];
    setTemplates(next);
    setPages(pageRes.ok ? (await pageRes.json()).pages ?? [] : []);
    setSettings(settingsRes.ok ? await settingsRes.json() : {});
    setSelectedId((current) => {
      const target = preferredId ?? current;
      return next.some((item) => item.id === target) ? target : next[0]?.id ?? "";
    });
  }

  useEffect(() => {
    void Promise.resolve().then(() => load()).catch((error) => setMessage({ ok: false, text: error instanceof Error ? error.message : "Falha ao carregar." }));
    return () => { if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl); };
    // previewUrl is intentionally managed by replacePreview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateLocal(patch: Partial<ContentTemplate>) {
    setTemplates((current) => current.map((item) => item.id === selectedId ? { ...item, ...patch } : item));
    replacePreview(null);
  }

  async function create() {
    setBusy("create"); setMessage(null);
    try {
      const response = await fetch("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Novo template", handle: "@seuperfil", niche: "Geral", layout: "viral_quote", identity_source: "profile" }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível criar o template.");
      await load(body.template.id);
      setMessage({ ok: true, text: "Template adicionado à galeria. Personalize e salve." });
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : "Falha ao criar." }); }
    finally { setBusy(null); }
  }

  async function save() {
    if (!selected) return;
    if (selected.identity_source === "page" && !selected.page_id) {
      setMessage({ ok: false, text: "Escolha uma Página para usar a foto e o @perfil dela." });
      return;
    }
    if (selected.identity_source === "custom" && !selected.avatar_url) {
      setMessage({ ok: false, text: "Envie uma foto própria antes de salvar este template." });
      return;
    }
    setBusy("save"); setMessage(null);
    try {
      const response = await fetch(`/api/templates/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        name: selected.name, handle: selected.handle, layout: selected.layout, niche: selected.niche,
        description: selected.description, page_id: selected.page_id, identity_source: selected.identity_source,
        background_color: selected.background_color, text_color: selected.text_color, enabled: selected.enabled,
      }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar o template.");
      setTemplates((current) => current.map((item) => item.id === selected.id ? body.template : item));
      setMessage({ ok: true, text: "Template salvo e disponível na galeria." });
      await renderPreview();
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : "Falha ao salvar." }); }
    finally { setBusy(null); }
  }

  async function uploadAvatar(file: File) {
    if (!selected) return;
    setBusy("avatar"); setMessage(null);
    try {
      const data = new FormData(); data.set("templateId", selected.id); data.set("avatar", file);
      const response = await fetch("/api/templates/avatar", { method: "POST", body: data });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível enviar a foto.");
      setTemplates((current) => current.map((item) => item.id === selected.id ? body.template : item));
      replacePreview(null); setMessage({ ok: true, text: "Foto própria selecionada para este template." });
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : "Falha ao enviar a foto." }); }
    finally { setBusy(null); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function renderPreview() {
    if (!selected) return;
    setBusy("render"); setMessage(null);
    try {
      const response = await fetch("/api/templates/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId: selected.id, text: sampleText }) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? "Não foi possível gerar a prévia."); }
      replacePreview(URL.createObjectURL(await response.blob()));
      setMessage({ ok: true, text: "Prévia exata gerada localmente, sem custo de imagem por IA." });
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : "Falha ao gerar a prévia." }); }
    finally { setBusy(null); }
  }

  async function remove() {
    if (!selected || !window.confirm(`Excluir o template “${selected.name}”?`)) return;
    setBusy("delete"); setMessage(null);
    try {
      const response = await fetch(`/api/templates/${selected.id}`, { method: "DELETE" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Não foi possível excluir.");
      replacePreview(null); await load(); setMessage({ ok: true, text: "Template excluído." });
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : "Falha ao excluir." }); }
    finally { setBusy(null); }
  }

  const selectedAvatar = selected ? identityImage(selected, pages, settings) : null;

  return <div className="mx-auto max-w-6xl space-y-6">
    <Card><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div className="flex gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><ImageSquare size={22} weight="fill" /></div><div><h2 className="font-heading font-bold">Galeria de templates</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Crie visuais para nichos e Páginas diferentes. Na criação do post você poderá escolher um deles ou publicar sem template.</p></div></div><Button size="sm" onClick={create} disabled={busy !== null}><Plus size={15}/> Novo template</Button></div></Card>

    {message && <div className={`flex items-center gap-2 rounded-xl border p-3.5 text-sm ${message.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>{message.ok ? <CheckCircle size={18}/> : <WarningCircle size={18}/>} {message.text}</div>}

    {templates.length > 0 && <section><div className="mb-3 flex items-end justify-between"><div><h3 className="font-heading font-semibold">Seus modelos</h3><p className="text-xs text-muted-foreground">Clique em um card para editar e conferir a arte final.</p></div><span className="text-xs text-muted-foreground">{templates.length} modelo(s)</span></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{templates.map((template) => {
      const avatar = identityImage(template, pages, settings);
      const scope = template.page_id ? pages.find((page) => page.page_id === template.page_id)?.name ?? "Página específica" : "Todas as Páginas";
      return <button key={template.id} onClick={() => { setSelectedId(template.id); replacePreview(null); }} className={`overflow-hidden rounded-2xl border text-left transition ${selectedId === template.id ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/50"}`}><div className="aspect-[2/1] p-5" style={{ backgroundColor: template.background_color, color: template.text_color }}><div className="flex items-center gap-2">{avatar ? <Image src={avatar} alt="" width={34} height={34} unoptimized className="h-9 w-9 rounded-full object-cover"/> : <span className="h-9 w-9 rounded-full bg-white/30"/>}<strong className="truncate text-sm">{template.handle}</strong></div><p className={`mt-5 line-clamp-2 ${template.layout === "bold_statement" ? "text-lg font-bold" : "text-sm"}`}>Sua mensagem aparece aqui com o visual deste modelo.</p></div><div className="bg-card p-3"><div className="flex items-center justify-between gap-2"><strong className="truncate text-sm">{template.name}</strong><span className={`h-2 w-2 rounded-full ${template.enabled ? "bg-success" : "bg-muted-foreground"}`}/></div><p className="mt-1 truncate text-xs text-muted-foreground">{template.niche} · {scope}</p></div></button>;
    })}</div></section>}

    {templates.length === 0 ? <Card className="py-12 text-center"><p className="font-medium">Nenhum template cadastrado</p><p className="mt-1 text-sm text-muted-foreground">Crie modelos separados para cada nicho ou Página.</p><Button className="mt-4" size="sm" onClick={create}><Plus size={15}/> Criar template</Button></Card> : selected && <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,.85fr)]">
      <Card className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><Field label="Nome do modelo" value={selected.name} onChange={(name) => updateLocal({ name })}/><Field label="Nicho" value={selected.niche} placeholder="Ex.: Oração, Finanças" onChange={(niche) => updateLocal({ niche })}/></div>
        <div className="grid gap-4 sm:grid-cols-2"><Select label="Layout" value={selected.layout} onChange={(layout) => updateLocal({ layout: layout as ContentTemplate["layout"] })} options={[["viral_quote","Citação viral"],["centered_quote","Citação centralizada"],["bold_statement","Frase forte"]]}/><Select label="Usar este modelo em" value={selected.page_id ?? ""} onChange={(page_id) => updateLocal({ page_id: page_id || null })} options={[["","Todas as Páginas"], ...pages.map((page) => [page.page_id, page.name])]}/></div>
        <Field label="Descrição interna (opcional)" value={selected.description} placeholder="Quando este modelo deve ser usado" onChange={(description) => updateLocal({ description })}/>
        <div className="grid gap-4 sm:grid-cols-2"><Select label="Foto e identidade" value={selected.identity_source} onChange={(identity_source) => updateLocal({ identity_source: identity_source as ContentTemplate["identity_source"] })} options={[["profile","Perfil do administrador"],["page","Página selecionada"],["custom","Foto própria do template"]]}/><Field label="@perfil exibido" value={selected.handle} onChange={(handle) => updateLocal({ handle })}/></div>
        {selected.identity_source === "custom" && <div><label className="text-xs font-semibold text-muted-foreground">Foto própria</label><div className="mt-2 flex items-center gap-3">{selectedAvatar ? <Image src={selectedAvatar} alt="Foto" width={64} height={64} unoptimized className="h-16 w-16 rounded-full object-cover"/> : <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-2 text-xs text-muted-foreground">Sem foto</div>}<input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => event.target.files?.[0] && uploadAvatar(event.target.files[0])}/><Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={busy !== null}><UploadSimple size={15}/> Escolher foto</Button></div></div>}
        <div className="grid gap-4 sm:grid-cols-2"><Color label="Cor do fundo" value={selected.background_color} onChange={(background_color) => updateLocal({ background_color })}/><Color label="Cor do texto" value={selected.text_color} onChange={(text_color) => updateLocal({ text_color })}/></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.enabled} onChange={(event) => updateLocal({ enabled: event.target.checked })} className="h-4 w-4 accent-primary"/> Disponível na tela Criar post</label>
        <div><label className="text-xs font-semibold text-muted-foreground">Texto para testar</label><textarea value={sampleText} maxLength={700} rows={7} onChange={(event) => { setSampleText(event.target.value); replacePreview(null); }} className="mt-1 w-full resize-y rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary"/></div>
        <div className="flex flex-wrap gap-2"><Button onClick={save} disabled={busy !== null}><FloppyDisk size={16}/> {busy === "save" ? "Salvando…" : "Salvar e visualizar"}</Button><Button variant="secondary" onClick={renderPreview} disabled={busy !== null || !sampleText.trim()}>{busy === "render" ? <SpinnerGap size={16} className="animate-spin"/> : <ImageSquare size={16}/>} Gerar prévia exata</Button><Button variant="danger" onClick={remove} disabled={busy !== null}><Trash size={16}/> Excluir</Button></div>
      </Card>
      <Card><h3 className="mb-3 text-sm font-semibold">Como o post ficará</h3><div className="relative aspect-square overflow-hidden rounded-xl border border-border" style={{ backgroundColor: selected.background_color, color: selected.text_color }}>{previewUrl ? <Image src={previewUrl} alt="Prévia final" fill unoptimized className="object-cover"/> : <div className="absolute inset-0 p-[11%]"><div className={`flex items-center gap-4 ${selected.layout === "centered_quote" ? "flex-col" : ""}`}>{selectedAvatar ? <Image src={selectedAvatar} alt="" width={74} height={74} unoptimized className="h-[16%] min-h-14 w-[16%] min-w-14 rounded-full object-cover"/> : <span className="h-16 w-16 rounded-full bg-white/30"/>}<strong>{selected.handle}</strong></div><p className={`mt-[9%] whitespace-pre-line leading-[1.38] ${selected.layout === "centered_quote" ? "text-center" : ""} ${selected.layout === "bold_statement" ? "font-bold" : ""}`}>{sampleText}</p></div>}</div><p className="mt-3 text-xs text-muted-foreground">A prévia exata usa a mesma fonte, foto, medidas e quebra de linhas da publicação.</p></Card>
    </div>}
  </div>;
}

function Field({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (value: string) => void }) { return <div><label className="text-xs font-semibold text-muted-foreground">{label}</label><input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary"/></div>; }
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) { return <div><label className="text-xs font-semibold text-muted-foreground">{label}</label><select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary">{options.map(([key,name]) => <option key={key} value={key}>{name}</option>)}</select></div>; }
function Color({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="text-xs font-semibold text-muted-foreground">{label}<span className="mt-1 flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2"><input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-7 w-9 cursor-pointer bg-transparent"/><span className="font-mono font-normal">{value}</span></span></label>; }
