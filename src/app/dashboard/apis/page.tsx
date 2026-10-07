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

type Provider = "kie" | "groq" | "gemini" | "pollinations" | "pexels";
type Source = "panel" | "environment" | "none";

type ModelOption = {
  value: string;
  label: string;
  description: string;
};

const KIE_TEXT_MODELS: ModelOption[] = [
  {
    value: "gemini-3-5-flash-openai",
    label: "Gemini 3.5 Flash — econômico (recomendado)",
    description: "Melhor escolha para grande volume de posts e baixo consumo.",
  },
  {
    value: "gemini-3-6-flash-openai",
    label: "Gemini 3.6 Flash — rápido",
    description: "Opção Flash intermediária para respostas rápidas.",
  },
  {
    value: "gemini-3-8-flash-openai",
    label: "Gemini 3.8 Flash — qualidade e velocidade",
    description: "Opção Flash mais avançada para textos que precisam de mais qualidade.",
  },
  {
    value: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro — qualidade",
    description: "Mais capacidade para conteúdos complexos, com custo maior que Flash.",
  },
  {
    value: "gemini-3.1-pro",
    label: "Gemini 3.1 Pro — raciocínio avançado",
    description: "Para tarefas difíceis; não é a melhor opção para alto volume.",
  },
  {
    value: "gpt-5-2",
    label: "GPT-5.2 — reserva de alta qualidade",
    description: "Boa escolha como fallback quando o modelo econômico falhar.",
  },
];

const KIE_IMAGE_MODELS: ModelOption[] = [
  {
    value: "gpt-image-2-text-to-image",
    label: "GPT Image 2 — qualidade (recomendado)",
    description: "Boa composição e reprodução de textos em imagens.",
  },
  {
    value: "nano-banana-2",
    label: "Nano Banana 2 — econômico",
    description: "Alternativa econômica para imagens ocasionais.",
  },
  {
    value: "nano-banana-2-1",
    label: "Nano Banana 2.1 — atualizado",
    description: "Versão mais recente do Nano Banana para geração de imagens.",
  },
  {
    value: "flux-2/flex-text-to-image",
    label: "Flux 2 Flex — equilibrado",
    description: "Equilíbrio entre qualidade, flexibilidade e consumo.",
  },
  {
    value: "flux-2/pro-text-to-image",
    label: "Flux 2 Pro — alta qualidade",
    description: "Modelo fotorealista para imagens em que a qualidade é prioridade.",
  },
  {
    value: "gpt-image-2-5-flare-text-to-image",
    label: "GPT Image 2.5 Flare — avançado",
    description: "Opção avançada para peças especiais, com consumo potencialmente maior.",
  },
];

interface Integrations {
  providers: {
    kie: {
      configured: boolean;
      source: Source;
      enabled: boolean;
      imageEnabled: boolean;
      textModel: string;
      textFallbackModel: string;
      imageModel: string;
      imageFallbackModel: string;
      dailyCreditLimit: number | null;
      lowBalanceThreshold: number;
      webhookConfigured: boolean;
    };
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
    id: "kie",
    name: "Kie.ai",
    role: "Principal · texto econômico e imagens sob demanda",
    description: "Uma chave para modelos GPT, Gemini e mídia. Texto tem prioridade; imagens Kie podem ficar desligadas para preservar créditos.",
    href: "https://kie.ai/api-key",
    keyPlaceholder: "Cole a chave da Kie.ai",
    icon: Robot,
  },
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
    kie: "",
    groq: "",
    gemini: "",
    pollinations: "",
    pexels: "",
  });
  const [models, setModels] = useState({
    kieText: "",
    kieTextFallback: "",
    kieImage: "",
    kieImageFallback: "",
    groq: "",
    gemini: "",
    pollinationsText: "",
    pollinationsImage: "",
  });
  const [kieOptions, setKieOptions] = useState({
    enabled: false,
    imageEnabled: false,
    dailyCreditLimit: "",
    lowBalanceThreshold: "100",
    webhookHmacKey: "",
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
      kieText: body.providers.kie.textModel,
      kieTextFallback: body.providers.kie.textFallbackModel,
      kieImage: body.providers.kie.imageModel,
      kieImageFallback: body.providers.kie.imageFallbackModel,
      groq: body.providers.groq.model,
      gemini: body.providers.gemini.model,
      pollinationsText: body.providers.pollinations.textModel,
      pollinationsImage: body.providers.pollinations.imageModel,
    });
    setKieOptions((current) => ({
      ...current,
      enabled: body.providers.kie.enabled,
      imageEnabled: body.providers.kie.imageEnabled,
      dailyCreditLimit: body.providers.kie.dailyCreditLimit?.toString() ?? "",
      lowBalanceThreshold: body.providers.kie.lowBalanceThreshold.toString(),
      webhookHmacKey: "",
    }));
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
      const payload: Record<string, unknown> = { provider };
      if (keys[provider].trim()) payload.apiKey = keys[provider].trim();
      if (provider === "kie") {
        const kiePayload: Record<string, unknown> = {
          provider,
          enabled: kieOptions.enabled,
          imageEnabled: kieOptions.imageEnabled,
          textModel: models.kieText.trim(),
          textFallbackModel: models.kieTextFallback.trim(),
          imageModel: models.kieImage.trim(),
          imageFallbackModel: models.kieImageFallback.trim(),
          dailyCreditLimit: kieOptions.dailyCreditLimit.trim()
            ? Number(kieOptions.dailyCreditLimit)
            : null,
          lowBalanceThreshold: Number(kieOptions.lowBalanceThreshold || 0),
        };
        if (keys.kie.trim()) kiePayload.apiKey = keys.kie.trim();
        if (kieOptions.webhookHmacKey.trim()) {
          kiePayload.webhookHmacKey = kieOptions.webhookHmacKey.trim();
        }
        Object.assign(payload, kiePayload);
      } else if (provider === "groq") payload.model = models.groq.trim();
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
              A Kie.ai pode ser o provedor principal de texto econômico e de imagens sob demanda. Groq,
              Gemini e Pollinations continuam como fallbacks; Pexels fornece fotos. Templates locais não
              consomem créditos. Todas as chaves ficam somente no servidor.
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
            <Card key={provider.id} className={`flex flex-col ${provider.id === "kie" ? "lg:col-span-2" : ""}`}>
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

              {provider.id === "kie" && (
                <div className="mt-3 space-y-3 rounded-xl border border-border bg-surface-2/50 p-3">
                  <label className="flex items-center justify-between gap-3 text-sm text-foreground">
                    <span>
                      <span className="block font-semibold">Priorizar Kie nos textos</span>
                      <span className="block text-xs text-muted-foreground">Usa os provedores atuais se a Kie falhar.</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={kieOptions.enabled}
                      onChange={(event) => setKieOptions((currentOptions) => ({ ...currentOptions, enabled: event.target.checked }))}
                      className="h-4 w-4 accent-primary"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-sm text-foreground">
                    <span>
                      <span className="block font-semibold">Permitir imagens pela Kie</span>
                      <span className="block text-xs text-muted-foreground">Deixe desligado para priorizar templates sem custo.</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={kieOptions.imageEnabled}
                      onChange={(event) => setKieOptions((currentOptions) => ({ ...currentOptions, imageEnabled: event.target.checked }))}
                      className="h-4 w-4 accent-primary"
                    />
                  </label>
                  <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
                    O modelo principal é usado em todos os posts. O modelo reserva entra automaticamente
                    somente se o principal falhar.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ModelSelectField id="kie-text-model" label="Modelo de texto principal" value={models.kieText} options={KIE_TEXT_MODELS} onChange={(value) => setModels((currentModels) => ({ ...currentModels, kieText: value }))} />
                    <ModelSelectField id="kie-text-fallback" label="Modelo de texto reserva" value={models.kieTextFallback} options={KIE_TEXT_MODELS} onChange={(value) => setModels((currentModels) => ({ ...currentModels, kieTextFallback: value }))} />
                    <ModelSelectField id="kie-image-model" label="Modelo de imagem principal" value={models.kieImage} options={KIE_IMAGE_MODELS} disabled={!kieOptions.imageEnabled} onChange={(value) => setModels((currentModels) => ({ ...currentModels, kieImage: value }))} />
                    <ModelSelectField id="kie-image-fallback" label="Modelo de imagem reserva" value={models.kieImageFallback} options={KIE_IMAGE_MODELS} disabled={!kieOptions.imageEnabled} onChange={(value) => setModels((currentModels) => ({ ...currentModels, kieImageFallback: value }))} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <NumberField
                      id="kie-daily-limit"
                      label="Limite diário (créditos, vazio = sem limite)"
                      value={kieOptions.dailyCreditLimit}
                      onChange={(value) => setKieOptions((currentOptions) => ({ ...currentOptions, dailyCreditLimit: value }))}
                    />
                    <NumberField
                      id="kie-low-balance"
                      label="Avisar saldo baixo em"
                      value={kieOptions.lowBalanceThreshold}
                      onChange={(value) => setKieOptions((currentOptions) => ({ ...currentOptions, lowBalanceThreshold: value }))}
                    />
                  </div>
                  <div>
                    <label htmlFor="kie-webhook-key" className="text-xs font-semibold text-muted-foreground">Chave HMAC do webhook (opcional)</label>
                    <input
                      id="kie-webhook-key"
                      type="password"
                      autoComplete="new-password"
                      value={kieOptions.webhookHmacKey}
                      onChange={(event) => setKieOptions((currentOptions) => ({ ...currentOptions, webhookHmacKey: event.target.value }))}
                      placeholder={data.providers.kie.webhookConfigured ? "•••• configurada — digite para substituir" : "Gerada em Settings na Kie.ai"}
                      className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary"
                    />
                  </div>
                </div>
              )}

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

function ModelSelectField({
  id,
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: ModelOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value);
  const knownValue = Boolean(selected);

  return (
    <div className="mt-3">
      <label htmlFor={id} className="text-xs font-semibold text-muted-foreground">{label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {!knownValue && value && <option value={value}>{value} — configuração salva</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <p className="mt-1 text-xs text-muted-foreground">
        {selected?.description ?? (value ? `Modelo personalizado salvo: ${value}` : "Selecione um modelo.")}
      </p>
    </div>
  );
}

function NumberField({
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
    <div>
      <label htmlFor={id} className="text-xs font-semibold text-muted-foreground">{label}</label>
      <input
        id={id}
        type="number"
        min="0"
        step="1"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary"
      />
    </div>
  );
}
