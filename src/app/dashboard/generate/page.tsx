"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowClockwise, ArrowSquareOut, CalendarPlus, CheckCircle, FloppyDisk, GlobeHemisphereWest, Robot, Rocket, Sparkle, WarningCircle, X } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { composeMessage, facebookPostUrl } from "@/lib/types";
import type { ContentAgent, ContentTemplate, GeneratedContent, ImageOverlayStyle, ImageSource, ImageSourcePref, PageCache } from "@/lib/types";

type Step = "idle" | "generating" | "ready";
type Usage = { credits: number; estimatedUsd: number; items: Array<{ provider: string; operation: string; model: string; credits: number }> };
type VisualImage = { url: string; source: ImageSource; baseUrl?: string; prompt?: string };

export default function GeneratePage() {
  const [topic, setTopic] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [ownTopics, setOwnTopics] = useState<string[]>([]);
  const [imagePref, setImagePref] = useState<ImageSourcePref>("template");
  const [pexelsReady, setPexelsReady] = useState(true);
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [niche, setNiche] = useState("Todos");
  const [renderingTemplate, setRenderingTemplate] = useState(false);
  const [overlayStyle, setOverlayStyle] = useState<ImageOverlayStyle>("gradient");
  const previewBlob = useRef<string | null>(null);
  const overlayPreviewRequest = useRef(0);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<GeneratedContent | null>(null);
  const [image, setImage] = useState<VisualImage | null>(null);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [hashtagInput, setHashtagInput] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [pages, setPages] = useState<PageCache[]>([]);
  const [agents, setAgents] = useState<ContentAgent[]>([]);
  const [pageId, setPageId] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState<"draft" | "schedule" | "post_now" | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get("topic");
    if (fromLink) void Promise.resolve(fromLink).then(setTopic);
    void Promise.all([
      fetch("/api/topics").then((r) => r.json()).then((d) => setOwnTopics((d.topics ?? []).filter((t: { enabled: boolean }) => t.enabled).map((t: { text: string }) => t.text))),
      fetch("/api/trends").then((r) => r.json()).then((d) => setSuggestions(d.topics ?? [])),
      fetch("/api/settings").then((r) => r.json()).then((d) => setImagePref(d.image_source ?? "template")),
      fetch("/api/integrations").then((r) => r.json()).then((d) => setPexelsReady(Boolean(d.providers?.pexels?.configured))),
      fetch("/api/facebook/pages").then((r) => r.json()).then((d) => { setPages(d.pages ?? []); if (d.defaultPageId) setPageId(d.defaultPageId); }),
      fetch("/api/agents").then((r) => r.json()).then((d) => setAgents(d.agents ?? [])),
      fetch("/api/templates").then((r) => r.json()).then((d) => { const enabled = (d.templates ?? []).filter((item: ContentTemplate) => item.enabled); setTemplates(enabled); setTemplateId(enabled[0]?.id ?? ""); }),
    ]).catch(() => {});
    return () => { if (previewBlob.current) URL.revokeObjectURL(previewBlob.current); };
  }, []);

  const selectedPage = useMemo(() => pages.find((page) => page.page_id === pageId), [pages, pageId]);
  const responsibleAgent = agents.find((agent) => agent.page_assignments?.some((item) => item.page_id === pageId));
  const responsibleAssignment = responsibleAgent?.page_assignments?.find((item) => item.page_id === pageId);
  const responsible = responsibleAgent && responsibleAssignment
    ? { agent: responsibleAgent, assignment: responsibleAssignment }
    : null;
  const responsibleLanguage = responsible?.agent.languages?.find((item) => item.locale === responsible.assignment.language);
  const preferredAgentOverlay = responsible?.agent.visual_strategy?.preferred_overlay;
  const agentPhotoThemes = Array.isArray(responsible?.agent.visual_strategy?.photo_themes)
    ? responsible.agent.visual_strategy.photo_themes.filter((item): item is string => typeof item === "string")
    : [];
  const compatibleTemplates = useMemo(() => templates.filter((item) => (!item.page_id || item.page_id === pageId) && (niche === "Todos" || item.niche === niche)), [templates, pageId, niche]);
  const niches = useMemo(() => ["Todos", ...new Set(templates.filter((item) => !item.page_id || item.page_id === pageId).map((item) => item.niche))], [templates, pageId]);
  const selectedTemplate = templates.find((item) => item.id === templateId);
  const postMessage = content ? composeMessage({ title: content.title, description: content.description, hashtags: content.hashtags, link_url: linkUrl || null }) : "";

  useEffect(() => {
    if (preferredAgentOverlay === "gradient" || preferredAgentOverlay === "card" || preferredAgentOverlay === "center") {
      // Synchronize the editor with the newly selected specialist's saved visual profile.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOverlayStyle(preferredAgentOverlay);
    }
  }, [preferredAgentOverlay]);

  function setPreviewImage(url: string, source: ImageSource = "template", baseUrl?: string) {
    if (previewBlob.current) URL.revokeObjectURL(previewBlob.current);
    previewBlob.current = url;
    setImage((current) => ({
      url,
      source,
      baseUrl,
      ...(source !== "template" && current?.prompt ? { prompt: current.prompt } : {}),
    }));
  }

  async function waitForImage(jobId: string) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, attempt < 5 ? 2500 : 4000));
      const response = await fetch(`/api/generate/image/${jobId}`); const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível acompanhar a imagem.");
      if (body.status === "success" && body.image) return body.image as { url: string; source: ImageSource };
      if (body.status === "failed") throw new Error(body.error ?? "A geração da imagem falhou.");
    }
    throw new Error("A imagem ainda está sendo gerada. Tente novamente em alguns instantes.");
  }

  async function renderPreview(text: string) {
    if (!templateId || !text.trim()) return;
    setRenderingTemplate(true);
    try {
      const response = await fetch("/api/templates/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId, text }) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? "Não foi possível montar a prévia."); }
      setPreviewImage(URL.createObjectURL(await response.blob()));
    } finally { setRenderingTemplate(false); }
  }

  async function renderOverlayPreview(baseImage: { url: string; source: Exclude<ImageSource, "template"> }, hook: string) {
    const request = ++overlayPreviewRequest.current;
    setRenderingTemplate(true);
    try {
      const response = await fetch("/api/images/overlay/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: baseImage.url, hook, style: overlayStyle, pageId: pageId || null, source: baseImage.source }),
      });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? "Não foi possível aplicar o gancho."); }
      const url = URL.createObjectURL(await response.blob());
      if (request !== overlayPreviewRequest.current) return URL.revokeObjectURL(url);
      setPreviewImage(url, baseImage.source, baseImage.url);
    } finally {
      if (request === overlayPreviewRequest.current) setRenderingTemplate(false);
    }
  }

  useEffect(() => {
    if (step !== "ready" || imagePref !== "template" || !content?.artText || !templateId) return;
    const timer = window.setTimeout(() => void renderPreview(content.artText!).catch((err) => setError(err instanceof Error ? err.message : "Falha na prévia.")), 500);
    return () => window.clearTimeout(timer);
    // Render only when the artwork inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content?.artText, templateId]);

  useEffect(() => {
    if (step !== "ready" || imagePref === "template" || !content?.imageHook || !image?.baseUrl || image.source === "template") return;
    const baseImage = { url: image.baseUrl, source: image.source };
    const timer = window.setTimeout(() => void renderOverlayPreview(baseImage, content.imageHook!).catch((err) => setError(err instanceof Error ? err.message : "Falha na prévia.")), 500);
    return () => window.clearTimeout(timer);
    // Regenerate only when the deterministic artwork inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content?.imageHook, overlayStyle, pageId]);

  async function loadUsage(id: string) {
    const response = await fetch(`/api/usage/generation/${id}`);
    if (response.ok) setUsage(await response.json());
  }

  async function generate() {
    if (topic.trim().length < 2) return setError("Informe primeiro um tema com pelo menos algumas palavras.");
    if (imagePref === "template" && !templateId) return setError("Escolha um template da galeria ou selecione a opção sem template.");
    if (imagePref === "stock" && !pexelsReady) return setError("Configure a chave do Pexels na aba APIs antes de usar fotos gratuitas.");
    const id = crypto.randomUUID();
    setGenerationId(id); setUsage(null); setError(null); setSuccess(null); setPublishedUrl(null); setStep("generating"); setContent(null); setImage(null);
    try {
      const contentRes = await fetch("/api/generate/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic, generationId: id, pageId: pageId || null }) });
      if (!contentRes.ok) throw new Error((await contentRes.json()).error ?? "Não foi possível gerar o conteúdo.");
      const contentData: GeneratedContent = await contentRes.json();
      let imageData: VisualImage;
      if (imagePref === "template") {
        const response = await fetch("/api/templates/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId, text: contentData.artText || `${contentData.title}\n\n${contentData.description}` }) });
        if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? "Não foi possível montar o template."); }
        const url = URL.createObjectURL(await response.blob()); previewBlob.current = url; imageData = { url, source: "template" };
      } else {
        const baseVisualPrompt = imagePref === "stock"
          ? contentData.stockQuery || contentData.imagePrompt || topic
          : contentData.imagePrompt || topic;
        const visualPrompt = (agentPhotoThemes.length > 0
          ? `${baseVisualPrompt}. Preferred visual themes: ${agentPhotoThemes.join(", ")}`
          : baseVisualPrompt).slice(0, 700);
        const imageRes = await fetch("/api/generate/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: visualPrompt, source: imagePref, generationId: id }) });
        if (!imageRes.ok) throw new Error((await imageRes.json()).error ?? "Não foi possível gerar a imagem.");
        const data = await imageRes.json();
        const rawImage = (imageRes.status === 202 ? await waitForImage(data.jobId) : data) as { url: string; source: Exclude<ImageSource, "template"> };
        const hook = contentData.imageHook || contentData.title;
        const overlayRes = await fetch("/api/images/overlay/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageUrl: rawImage.url, hook, style: overlayStyle, pageId: pageId || null, source: rawImage.source }) });
        if (!overlayRes.ok) throw new Error((await overlayRes.json()).error ?? "Não foi possível aplicar o gancho.");
        const url = URL.createObjectURL(await overlayRes.blob()); previewBlob.current = url;
        imageData = { url, source: rawImage.source, baseUrl: rawImage.url, prompt: visualPrompt };
      }
      setContent(contentData); setImage(imageData); setStep("ready"); await loadUsage(id);
    } catch (err) { setError(err instanceof Error ? err.message : "Algo deu errado."); setStep("idle"); }
  }

  function removeHashtag(tag: string) { if (content) setContent({ ...content, hashtags: content.hashtags.filter((item) => item !== tag) }); }
  function addHashtag() { const tag = hashtagInput.trim().replace(/^#/, "").toLowerCase(); if (tag && content && !content.hashtags.includes(tag)) { setContent({ ...content, hashtags: [...content.hashtags, tag] }); setHashtagInput(""); } }

  async function save(action: "draft" | "schedule" | "post_now") {
    if (!content || !image) return;
    if (action !== "draft" && !pageId) return setError("Escolha uma Página antes de agendar ou publicar.");
    if (action === "schedule" && !scheduledAt) return setError("Escolha uma data e um horário.");
    setError(null); setSaving(action);
    try {
      let finalImage = image;
      if (image.source === "template") {
        const response = await fetch("/api/templates/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId, text: content.artText || `${content.title}\n\n${content.description}` }) });
        const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar a arte final."); finalImage = body;
      } else if (image.baseUrl) {
        const response = await fetch("/api/images/overlay/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageUrl: image.baseUrl, hook: content.imageHook || content.title, style: overlayStyle, pageId: pageId || null, source: image.source }) });
        const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar a arte com o gancho."); finalImage = body;
      }
      const response = await fetch("/api/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic, title: content.title, description: content.description, hashtags: content.hashtags, imageUrl: finalImage.url, imageSource: finalImage.source, baseImageUrl: image.baseUrl, imageHook: image.source === "template" ? undefined : content.imageHook || content.title, imagePrompt: image.source === "template" ? undefined : image.prompt || content.imagePrompt || topic, overlayStyle: image.source === "template" ? undefined : overlayStyle, linkUrl: linkUrl || undefined, pageId: pageId || null, pageName: selectedPage?.name ?? null, generationId, templateId: image.source === "template" ? templateId : null, agentId: content.agentContext?.agentId ?? null, contentLanguage: content.agentContext?.language ?? null, agentPromptVersion: content.agentContext?.promptVersion ?? null, action, scheduledAt: action === "schedule" ? new Date(scheduledAt).toISOString() : undefined }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar o post.");
      if (action === "post_now" && data.post.status === "failed") throw new Error(data.post.error_message ?? "O Facebook rejeitou este post.");
      setSuccess(action === "draft" ? "Salvo como rascunho." : action === "schedule" ? "Post agendado." : "Publicado no Facebook 🎉");
      setPublishedUrl(action === "post_now" && data.post.facebook_post_id ? facebookPostUrl(data.post.facebook_post_id) : null);
      setStep("idle"); setContent(null); setImage(null); setTopic(""); setScheduleOpen(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar o post."); }
    finally { setSaving(null); }
  }

  return <div className="mx-auto max-w-6xl space-y-6">
    <Card><label className="text-sm font-semibold">1. Página e assunto</label><p className="mt-1 text-sm text-muted-foreground">Escolha primeiro a Página para ver somente os templates compatíveis com ela.</p><div className="mt-3 grid gap-3 md:grid-cols-[260px_1fr_auto]">
      <select value={pageId} onChange={(event) => { setPageId(event.target.value); setTemplateId(""); setError(null); setStep("idle"); setContent(null); setImage(null); }} className="rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary"><option value="">Selecione uma Página…</option>{pages.map((page) => <option key={page.page_id} value={page.page_id}>{page.name}</option>)}</select>
      <input value={topic} onChange={(event) => setTopic(event.target.value)} onKeyDown={(event) => event.key === "Enter" && generate()} placeholder="Ex.: uma oração para começar bem o dia" className="rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary"/>
      <Button onClick={generate} disabled={step === "generating"}><Sparkle size={16} weight="fill"/> {step === "generating" ? "Gerando…" : "Gerar post"}</Button>
    </div>
    {pageId && responsible ? <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3.5 py-3 text-sm"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary"><Robot size={19} weight="fill"/></span><div className="min-w-0 flex-1"><strong className="block">{responsible.agent.name}</strong><span className="text-xs text-muted-foreground">{responsible.agent.role} · instruções v{responsible.agent.prompt_version}</span></div><span className="inline-flex items-center gap-1 rounded-full border border-primary/20 px-2.5 py-1 text-xs text-primary"><GlobeHemisphereWest size={14}/>{responsibleLanguage?.label ?? responsible.assignment.language}</span><Link href={`/dashboard/agents/${responsible.agent.id}`} className="text-xs text-primary underline">Ver perfil</Link></div> : pageId ? <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm"><span>Esta Página ainda usa o redator global porque não possui agente responsável.</span><Link href="/dashboard/pages" className="shrink-0 font-medium text-primary underline">Vincular agente</Link></div> : null}
    {ownTopics.length > 0 && <div className="mt-4 flex flex-wrap gap-2"><span className="mt-1 text-xs text-muted-foreground">Seus temas:</span>{ownTopics.slice(0,8).map((item) => <button key={item} onClick={() => setTopic(item)} className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs text-primary">{item}</button>)}<Link href="/dashboard/topics" className="mt-1 text-xs text-muted-foreground underline">Gerenciar</Link></div>}
    {suggestions.length > 0 && <div className="mt-3 flex flex-wrap gap-2"><span className="mt-1 text-xs text-muted-foreground">Ideias:</span>{suggestions.slice(0,6).map((item) => <button key={item} onClick={() => setTopic(item)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">{item}</button>)}</div>}
    </Card>

    <Card><label className="text-sm font-semibold">2. Visual do post</label><div className="mt-3 flex flex-wrap gap-2">{([["template","Usar template da galeria"],["stock","Foto gratuita + gancho"],["ai","Imagem por IA + gancho"],["mixed","Automático + gancho"]] as [ImageSourcePref,string][]).map(([value,label]) => { const disabled = value === "stock" && !pexelsReady; return <button key={value} disabled={disabled} title={disabled ? "Configure o Pexels na aba APIs" : undefined} onClick={() => setImagePref(value)} className={`rounded-xl border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-45 ${imagePref === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{label}</button>; })}</div>
      {!pexelsReady && <p className="mt-2 text-xs text-muted-foreground">Fotos gratuitas estão desativadas porque o Pexels ainda não possui uma chave. <Link href="/dashboard/apis" className="text-primary underline">Configurar em APIs</Link>.</p>}
      {imagePref !== "template" && <div className="mt-4 rounded-xl border border-border bg-background p-3"><p className="text-xs font-semibold text-muted-foreground">Estilo do gancho sobre a fotografia</p><div className="mt-2 flex flex-wrap gap-2">{([["gradient","Degradê inferior"],["card","Faixa destacada"],["center","Texto central"]] as [ImageOverlayStyle,string][]).map(([value,label]) => <button key={value} onClick={() => setOverlayStyle(value)} className={`rounded-lg border px-3 py-1.5 text-xs ${overlayStyle === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{label}</button>)}</div><p className="mt-2 text-xs text-muted-foreground">A IA cria o fundo sem letras; o app aplica o texto corretamente e mostra o arquivo exato que será publicado.</p></div>}
      {imagePref === "template" && <div className="mt-4"><div className="flex flex-wrap gap-2">{niches.map((item) => <button key={item} onClick={() => setNiche(item)} className={`rounded-full px-3 py-1 text-xs ${niche === item ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground"}`}>{item}</button>)}</div><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{compatibleTemplates.map((template) => <button key={template.id} onClick={() => setTemplateId(template.id)} className={`overflow-hidden rounded-xl border text-left ${templateId === template.id ? "border-primary ring-2 ring-primary/20" : "border-border"}`}><div className="aspect-[2/1] p-4" style={{ backgroundColor: template.background_color, color: template.text_color }}><strong className="text-sm">{template.handle}</strong><p className={`mt-4 line-clamp-2 text-sm ${template.layout === "bold_statement" ? "font-bold" : ""}`}>Prévia do estilo desta arte.</p></div><div className="p-3"><strong className="text-sm">{template.name}</strong><p className="text-xs text-muted-foreground">{template.niche}</p></div></button>)}</div>{compatibleTemplates.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Nenhum template disponível para este filtro. <Link href="/dashboard/templates" className="text-primary underline">Abra a galeria</Link> para criar um.</p>}</div>}
    </Card>

    {error && <div className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive"><WarningCircle size={18}/>{error}</div>}
    {success && <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 p-3.5 text-sm text-success"><CheckCircle size={18}/>{success}{publishedUrl && <a href={publishedUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline">Ver post <ArrowSquareOut size={13}/></a>}</div>}
    {step === "generating" && <Card className="animate-pulse"><div className="grid gap-6 md:grid-cols-2"><div className="aspect-square rounded-xl bg-surface-2"/><div className="space-y-3"><div className="h-6 w-3/4 rounded bg-surface-2"/><div className="h-4 w-full rounded bg-surface-2"/><div className="h-4 w-5/6 rounded bg-surface-2"/></div></div></Card>}

    {step === "ready" && content && image && <div className="grid gap-6 lg:grid-cols-[minmax(360px,.9fr)_minmax(0,1fr)]">
      <div className="space-y-3"><h2 className="font-heading font-semibold">Prévia exata do post</h2><div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm"><div className="flex items-center gap-3 p-4">{selectedPage?.picture_url ? <Image src={selectedPage.picture_url} alt="" width={42} height={42} unoptimized className="h-11 w-11 rounded-full object-cover"/> : <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 font-bold">{selectedPage?.name?.[0] ?? "P"}</div>}<div><strong className="block text-sm">{selectedPage?.name ?? "Página selecionada"}</strong><span className="text-xs text-muted-foreground">Agora · Público</span></div></div><p className="whitespace-pre-line px-4 pb-4 text-sm leading-relaxed">{postMessage}</p><div className="relative aspect-square bg-surface-2"><Image src={image.url} alt={content.title} fill unoptimized className="object-cover"/></div></div><div className="flex items-center justify-between"><Badge>{image.source === "template" ? `${selectedTemplate?.name ?? "Template"} · sem IA de imagem` : image.source === "ai" ? "Imagem gerada por IA" : "Banco de imagens"}</Badge><button onClick={generate} className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowClockwise size={13}/> Gerar novamente</button></div>{usage && <div className="rounded-xl border border-border bg-card p-3 text-sm"><div className="flex items-center justify-between"><strong>Custo desta geração</strong><span className="font-semibold text-primary">{usage.credits.toFixed(3)} créditos · US$ {usage.estimatedUsd.toFixed(4)}</span></div><p className="mt-1 text-xs text-muted-foreground">{image.source === "template" ? "A arte reutilizável custou 0 crédito; o valor acima é somente do texto." : "Texto e imagem rastreados nesta geração."}</p>{usage.items.map((item, index) => <p key={`${item.operation}-${index}`} className="mt-1 text-xs text-muted-foreground">{item.operation === "text" ? "Texto" : "Imagem"}: {item.model} · {item.credits} crédito(s)</p>)}</div>}</div>
      <Card className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">Texto criado por <span className="font-medium capitalize">{content.provider}</span>{renderingTemplate ? " · atualizando a arte…" : ""}</p>{content.agentContext && <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary"><Robot size={13}/>{content.agentContext.agentName} · {content.agentContext.languageLabel}</span>}</div><Editor label="Chamada inicial" value={content.title} maxLength={120} onChange={(title) => setContent({ ...content, title })}/><TextEditor label="Descrição" value={content.description} rows={4} maxLength={500} onChange={(description) => setContent({ ...content, description })}/>{image.source === "template" ? <TextEditor label="Texto dentro da arte (a prévia atualiza automaticamente)" value={content.artText ?? ""} rows={7} maxLength={700} onChange={(artText) => setContent({ ...content, artText })}/> : <Editor label="Gancho curto na imagem (a prévia atualiza automaticamente)" value={content.imageHook ?? content.title} maxLength={90} onChange={(imageHook) => setContent({ ...content, imageHook })}/>}<div><label className="text-xs font-semibold text-muted-foreground">Hashtags</label><div className="mt-1 flex flex-wrap gap-1.5">{content.hashtags.map((tag) => <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs text-accent">#{tag}<button onClick={() => removeHashtag(tag)}><X size={11}/></button></span>)}<input value={hashtagInput} onChange={(event) => setHashtagInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && (event.preventDefault(), addHashtag())} placeholder="adicionar…" className="w-24 rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 text-xs outline-none"/></div></div><Editor label="Link de produto ou afiliado (opcional)" value={linkUrl} placeholder="https://..." onChange={setLinkUrl}/>{scheduleOpen && <Editor label="Agendar para" type="datetime-local" value={scheduledAt} onChange={setScheduledAt}/>}<div className="flex flex-wrap gap-2 pt-2"><Button variant="secondary" onClick={() => save("draft")} disabled={saving !== null}><FloppyDisk size={16}/> Salvar rascunho</Button>{scheduleOpen ? <Button variant="secondary" onClick={() => save("schedule")} disabled={saving !== null}><CalendarPlus size={16}/> Confirmar agendamento</Button> : <Button variant="secondary" onClick={() => setScheduleOpen(true)}><CalendarPlus size={16}/> Agendar</Button>}<Button onClick={() => save("post_now")} disabled={saving !== null}><Rocket size={16} weight="fill"/> {saving === "post_now" ? "Publicando…" : "Publicar agora"}</Button></div></Card>
    </div>}
  </div>;
}

function Editor({ label, value, placeholder, maxLength, type = "text", onChange }: { label: string; value: string; placeholder?: string; maxLength?: number; type?: string; onChange: (value: string) => void }) { return <div><label className="text-xs font-semibold text-muted-foreground">{label}</label><input type={type} value={value} placeholder={placeholder} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary"/></div>; }
function TextEditor({ label, value, rows, maxLength, onChange }: { label: string; value: string; rows: number; maxLength: number; onChange: (value: string) => void }) { return <div><label className="text-xs font-semibold text-muted-foreground">{label}</label><textarea value={value} rows={rows} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full resize-y rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary"/></div>; }
