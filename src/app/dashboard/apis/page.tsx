"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle,
  Flask,
  ImageSquare,
  Key,
  Robot,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Provider = "groq" | "gemini" | "pollinations" | "pexels";
type Source = "panel" | "environment" | "none";

interface Integrations {
  providers: {
    groq: { configured: boolean; source: Source; model: string };
    gemini: { configured: boolean; source: Source; model: string };
    pollinations: {
      configured: boolean;
      source: Source;
      textModel: string;
      imageModel: string;
    };
    pexels: { configured: boolean; source: Source };
  };
}

const PROVIDERS: Array<{
  id: Provider;
  name: string;
  role: string;
  description: string;
  href: string;
  keyPlaceholder: string;
  icon: typeof Robot;
}> = [
  {
    id: "groq",
    name: "Groq",
    role: "LLM · prioridade 1",
    description: "Gera os textos dos posts. É a primeira opção da cadeia de fallback.",
    href: "https://console.groq.com/keys",
    keyPlaceholder: "gsk_…",
    icon: Robot,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    role: "LLM · prioridade 2",
    description: "Gera textos quando a Groq não está configurada ou não responde.",
    href: "https://aistudio.google.com/app/apikey",
    keyPlaceholder: "AIza…",
    icon: Robot,
  },
  {
    id: "pollinations",
    name: "Pollinations",
    role: "LLM e imagens · prioridade 3",
    description: "Último fallback de texto e provedor das imagens geradas por IA.",
    href: "https://enter.pollinations.ai/",
    keyPlaceholder: "sk_…",
    icon: ImageSquare,
  },
  {
    id: "pexels",
    name: "Pexels",
    role: "Banco de imagens",
    description: "Pesquisa fotos gratuitas quando a fonte de imagem é Pexels ou mista.",
    href: "https://www.pexels.com/api/new/",
    keyPlaceholder: "Cole a chave do Pexels",
    icon: ImageSquare,
  },
];

export default function ApisPage() {
  const [data, setData] = useState<Integrations | null>(null);
  const [keys, setKeys] = useState<Record<Provider, string>>({
    groq: "",
    gemini: "",
    pollinations: "",
    pexels: "",
  });
  const [models, setModels] = useState({
    groq: "",
    gemini: "",
    pollinationsText: "",
    pollinationsImage: "",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Partial<Record<Provider, { ok: boolean; text: string }>>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/integrations");
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Não foi possível carregar as APIs.");
    setData(body);
    setModels({
      groq: body.providers.groq.model,
      gemini: body.providers.gemini.model,
      pollinationsText: body.providers.pollinations.textModel,
      pollinationsImage: body.providers.pollinations.imageModel,
    });
  }

  useEffect(() => {
    load().catch((err) =>
      setLoadError(err instanceof Error ? err.message : "Não foi possível carregar as APIs.")
    );
  }, []);

  async function save(provider: Provider) {
    setBusy(`save-${provider}`);
    setMessages((current) => ({ ...current, [provider]: undefined }));
    try {
      const payload: Record<string, string> = { provider };
      if (keys[provider].trim()) payload.apiKey = keys[provider].trim();
      if (provider === "groq") payload.model = models.groq.trim();
      if (provider === "gemini") payload.model = models.gemini.trim();
      if (provider === "pollinations") {
        payload.textModel = models.pollinationsText.trim();
        payload.imageModel = models.pollinationsImage.trim();
      }

      const res = await fetch("/api/integrations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Não foi possível salvar.");
      setKeys((current) => ({ ...current, [provider]: "" }));
      await load();
      setMessages((current) => ({
        ...current,
        [provider]: { ok: true, text: "Configuração salva. Agora use Testar conexão." },
      }));
    } catch (err) {
      setMessages((current) => ({
        ...current,
        [provider]: { ok: false, text: err instanceof Error ? err.message : "Não foi possível salvar." },
      }));
    } finally {
      setBusy(null);
    }
  }

  async function test(provider: Provider) {
    setBusy(`test-${provider}`);
    setMessages((current) => ({ ...current, [provider]: undefined }));
    try {
      const res = await fetch("/api/integrations/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "O teste falhou.");
      setMessages((current) => ({
        ...current,
        [provider]: { ok: true, text: `${body.message} (${body.latencyMs} ms)` },
      }));
    } catch (err) {
      setMessages((current) => ({
        ...current,
        [provider]: { ok: false, text: err instanceof Error ? err.message : "O teste falhou." },
      }));
    } finally {
      setBusy(null);
    }
  }

  async function remove(provider: Provider) {
    if (!window.confirm("Remover a chave salva no painel? A chave do ambiente, se existir, voltará a ser usada.")) {
      return;
    }
    setBusy(`remove-${provider}`);
    try {
      const res = await fetch(`/api/integrations/${provider}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Não foi possível remover a chave.");
      await load();
      setMessages((current) => ({
        ...current,
        [provider]: { ok: true, text: "Chave do painel removida." },
      }));
    } catch (err) {
      setMessages((current) => ({
        ...current,
        [provider]: { ok: false, text: err instanceof Error ? err.message : "Não foi possível remover." },
      }));
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{loadError}</div>;
  }
  if (!data) return <p className="text-sm text-muted-foreground">Carregando APIs…</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Key size={22} weight="fill" />
          </div>
          <div>
            <h2 className="font-heading font-bold text-foreground">Chaves e provedores de conteúdo</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Existem três LLMs para texto: Groq, Gemini e Pollinations, usados nessa ordem. Para imagens,
              o painel usa Pollinations (IA) e Pexels (fotos). As chaves ficam somente no servidor e nunca
              são devolvidas ao navegador.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {PROVIDERS.map((provider) => {
          const current = data.providers[provider.id];
          const message = messages[provider.id];
          const Icon = provider.icon;
          return (
            <Card key={provider.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted-foreground">
                    <Icon size={20} />
                  </div>
                  <div>
                    <h2 className="font-heading font-bold text-foreground">{provider.name}</h2>
                    <p className="text-xs font-medium text-primary">{provider.role}</p>
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${current.configured ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                  {current.configured ? "Configurada" : "Sem chave"}
                </span>
              </div>

              <p className="mt-3 text-sm text-muted-foreground">{provider.description}</p>
              {current.source !== "none" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Chave ativa: {current.source === "panel" ? "salva neste painel" : "variável de ambiente"}
                </p>
              )}

              <div className="mt-4">
                <label htmlFor={`${provider.id}-key`} className="text-xs font-semibold text-muted-foreground">
                  Chave da API
                </label>
                <input
                  id={`${provider.id}-key`}
                  type="password"
                  autoComplete="new-password"
                  value={keys[provider.id]}
                  onChange={(e) => setKeys((currentKeys) => ({ ...currentKeys, [provider.id]: e.target.value }))}
                  placeholder={current.configured ? "•••• chave configurada — digite para substituir" : provider.keyPlaceholder}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                />
              </div>

              {provider.id === "groq" && (
                <ModelField id="groq-model" label="Modelo de texto" value={models.groq} onChange={(value) => setModels((currentModels) => ({ ...currentModels, groq: value }))} />
              )}
              {provider.id === "gemini" && (
                <ModelField id="gemini-model" label="Modelo de texto" value={models.gemini} onChange={(value) => setModels((currentModels) => ({ ...currentModels, gemini: value }))} />
              )}
              {provider.id === "pollinations" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <ModelField id="pollinations-text-model" label="Modelo de texto" value={models.pollinationsText} onChange={(value) => setModels((currentModels) => ({ ...currentModels, pollinationsText: value }))} />
                  <ModelField id="pollinations-image-model" label="Modelo de imagem" value={models.pollinationsImage} onChange={(value) => setModels((currentModels) => ({ ...currentModels, pollinationsImage: value }))} />
                </div>
              )}

              {message && (
                <div className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${message.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                  {message.ok ? <CheckCircle size={16} /> : <WarningCircle size={16} />}
                  <span>{message.text}</span>
                </div>
              )}

              <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                <Button size="sm" onClick={() => save(provider.id)} disabled={busy !== null}>
                  {busy === `save-${provider.id}` ? "Salvando…" : "Salvar"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => test(provider.id)} disabled={busy !== null || !current.configured}>
                  <Flask size={15} /> {busy === `test-${provider.id}` ? "Testando…" : "Testar conexão"}
                </Button>
                {current.source === "panel" && (
                  <button
                    type="button"
                    onClick={() => remove(provider.id)}
                    disabled={busy !== null}
                    className="ml-auto inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-destructive disabled:opacity-50"
                  >
                    <Trash size={14} /> Remover
                  </button>
                )}
              </div>

              <a href={provider.href} target="_blank" rel="noopener noreferrer" className="mt-3 text-xs font-medium text-primary hover:underline">
                Obter ou gerenciar chave ↗
              </a>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ModelField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mt-3">
      <label htmlFor={id} className="text-xs font-semibold text-muted-foreground">{label}</label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 font-mono text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
      />
    </div>
  );
}
