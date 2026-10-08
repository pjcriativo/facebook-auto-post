"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  FacebookLogo,
  CheckCircle,
  WarningCircle,
  LinkSimple,
  LinkBreak,
  Key,
  Copy,
  Check,
  Camera,
  UserCircle,
  LockKey,
} from "@phosphor-icons/react/dist/ssr";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { ContentTemplate, ImageSourcePref } from "@/lib/types";

const TIMEZONES = [
  "America/Sao_Paulo",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Dhaka",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

interface SettingsState {
  admin_full_name?: string | null;
  admin_email?: string | null;
  admin_avatar_url?: string | null;
  facebook_connected: boolean;
  /** False when the deployment has no real Meta app credentials. */
  facebook_configured?: boolean;
  facebook_app_id: string | null;
  facebook_config_id: string | null;
  /** The secret itself never reaches the browser — only whether one is stored. */
  facebook_app_secret_set?: boolean;
  facebook_user_name: string | null;
  default_page_id?: string | null;
  default_page_name: string | null;
  default_template_id?: string | null;
  facebook_page_ready?: boolean;
  image_source: ImageSourcePref;
  utm_suffix: string;
  auto_post_enabled: boolean;
  posts_per_day: number;
  posting_hours: number[];
  timezone: string;
  topic_source?: "mine" | "trending" | "mixed";
}

function Ready({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 ${ok ? "text-success" : "text-muted-foreground"}`}>
      {ok ? <CheckCircle size={16} weight="fill" /> : <WarningCircle size={16} />}
      <span>{label}</span>
    </div>
  );
}

interface AutomationStatus {
  connected: boolean;
  defaultPage: string | null;
  pageAccess: boolean;
  pageError: string | null;
  missingPermissions: string[];
  aiTextReady: boolean;
  templateRequired: boolean;
  templateReady: boolean;
  preferredTemplate: { id: string; name: string } | null;
  cronConfigured: boolean;
  autopilotEnabled: boolean;
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando…</p>}>
      <SettingsForm />
    </Suspense>
  );
}

function SettingsForm() {
  const params = useSearchParams();
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [automation, setAutomation] = useState<AutomationStatus | null>(null);

  const [fullName, setFullName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [configId, setConfigId] = useState("");
  const [savingCreds, setSavingCreds] = useState(false);
  const [credsError, setCredsError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"uri" | "domain" | null>(null);
  // Read from the browser rather than configured, so they always match the
  // hostname the user is actually on — the values Facebook compares against.
  const [redirectUri, setRedirectUri] = useState("");
  const [appDomain, setAppDomain] = useState("");

  useEffect(() => {
    setRedirectUri(`${window.location.origin}/api/facebook/oauth/callback`);
    setAppDomain(window.location.hostname);
  }, []);

  const oauthStatus = params.get("facebook");
  const oauthMessage = params.get("message");

  useEffect(() => {
    Promise.all([fetch("/api/settings"), fetch("/api/templates"), fetch("/api/automation/status")])
      .then(async ([r, templatesResponse, automationResponse]) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Não foi possível carregar as configurações.");
        setSettings(data);
        if (templatesResponse.ok) setTemplates((await templatesResponse.json()).templates ?? []);
        if (automationResponse.ok) setAutomation(await automationResponse.json());
        setFullName(data.admin_full_name ?? "");
        setProfileEmail(data.admin_email ?? "");
        setAppId(data.facebook_app_id ?? "");
        setConfigId(data.facebook_config_id ?? "");
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Não foi possível carregar as configurações."));
  }, []);

  async function saveCredentials() {
    setCredsError(null);
    if (!appId.trim()) {
      setCredsError("Informe o ID do Aplicativo da Meta.");
      return;
    }
    // An already-stored secret is left alone unless a new one is typed, so the
    // masked field does not have to round-trip the real value.
    if (!appSecret.trim() && !settings?.facebook_app_secret_set) {
      setCredsError("Informe a Chave Secreta em Configurações do aplicativo > Básico.");
      return;
    }

    setSavingCreds(true);
    try {
      const res = await fetch("/api/facebook/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId: appId.trim(),
          appSecret: appSecret.trim() || undefined,
          configId: configId.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Não foi possível salvar essas credenciais.");

      setAppSecret("");
      setSettings((s) =>
        s
          ? {
              ...s,
              facebook_app_id: appId.trim(),
              facebook_config_id: configId.trim() || null,
              facebook_app_secret_set: true,
              facebook_configured: true,
            }
          : s
      );
    } catch (err) {
      setCredsError(err instanceof Error ? err.message : "Não foi possível salvar essas credenciais.");
    } finally {
      setSavingCreds(false);
    }
  }

  async function saveProfile() {
    setProfileError(null);
    setProfileMessage(null);
    setProfileSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email: profileEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Não foi possível salvar o perfil.");
      setSettings((s) =>
        s
          ? { ...s, admin_full_name: data.fullName, admin_email: data.email }
          : s
      );
      setFullName(data.fullName ?? "");
      setProfileEmail(data.email ?? "");
      setProfileMessage("Perfil atualizado.");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Não foi possível salvar o perfil.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function uploadAvatar(file: File | undefined) {
    if (!file) return;
    setProfileError(null);
    setProfileMessage(null);
    setAvatarUploading(true);
    try {
      const form = new FormData();
      form.set("avatar", file);
      const res = await fetch("/api/profile/avatar", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Não foi possível enviar a foto.");
      setSettings((s) => (s ? { ...s, admin_avatar_url: data.avatarUrl } : s));
      setProfileMessage("Foto atualizada.");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Não foi possível enviar a foto.");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function changePassword() {
    setPasswordError(null);
    setPasswordMessage(null);
    if (newPassword !== confirmPassword) {
      setPasswordError("A confirmação não corresponde à nova senha.");
      return;
    }
    setPasswordSaving(true);
    try {
      const res = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Não foi possível alterar a senha.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("Senha alterada com sucesso.");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Não foi possível alterar a senha.");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function copyValue(value: string, which: "uri" | "domain") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCredsError("Não foi possível copiar — selecione o campo e copie manualmente.");
    }
  }

  async function save(patch: Partial<SettingsState>) {
    setSaving(true);
    setSaved(false);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = await res.json();
      setSettings((s) => (s ? { ...s, ...data } : s));
      fetch("/api/automation/status").then((response) => response.ok ? response.json() : null).then((status) => status && setAutomation(status)).catch(() => {});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  }

  async function disconnect() {
    setDisconnecting(true);
    await fetch("/api/facebook/disconnect", { method: "POST" });
    setSettings((s) =>
      s ? { ...s, facebook_connected: false, facebook_user_name: null, default_page_name: null } : s
    );
    setDisconnecting(false);
  }

  function toggleHour(hour: number) {
    if (!settings) return;
    const has = settings.posting_hours.includes(hour);
    const next = has ? settings.posting_hours.filter((h) => h !== hour) : [...settings.posting_hours, hour].sort((a, b) => a - b);
    setSettings({ ...settings, posting_hours: next });
    save({ posting_hours: next });
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive">
        {loadError}
      </div>
    );
  }

  if (!settings) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {oauthStatus === "connected" && (
        <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 p-3.5 text-sm text-success">
          <CheckCircle size={18} /> Conta do Facebook conectada.
        </div>
      )}
      {oauthStatus === "error" && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive">
          <WarningCircle size={18} /> {oauthMessage ?? "Não foi possível conectar o Facebook."}
        </div>
      )}

      {/* Administrator profile */}
      <Card>
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UserCircle size={23} weight="fill" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-heading font-bold text-foreground">Perfil do usuário</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Dados da conta administrativa que acessa este painel.
            </p>

            <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
              <div
                className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 bg-cover bg-center text-2xl font-bold text-muted-foreground"
                style={settings.admin_avatar_url ? { backgroundImage: `url(${settings.admin_avatar_url})` } : undefined}
                role="img"
                aria-label="Foto do perfil"
              >
                {!settings.admin_avatar_url && (fullName.trim().charAt(0).toUpperCase() || <UserCircle size={42} />)}
              </div>
              <div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-foreground transition hover:bg-surface-2">
                  <Camera size={16} />
                  {avatarUploading ? "Enviando…" : "Alterar foto"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    disabled={avatarUploading}
                    onChange={(e) => {
                      void uploadAvatar(e.target.files?.[0]);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                <p className="mt-1.5 text-xs text-muted-foreground">JPG, PNG ou WebP de até 5 MB.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="profile-name" className="text-xs font-semibold text-muted-foreground">
                  Nome completo
                </label>
                <input
                  id="profile-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                  placeholder="Seu nome completo"
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label htmlFor="profile-email" className="text-xs font-semibold text-muted-foreground">
                  E-mail administrativo
                </label>
                <input
                  id="profile-email"
                  type="email"
                  value={profileEmail}
                  onChange={(e) => setProfileEmail(e.target.value)}
                  autoComplete="email"
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Somente o administrador autenticado pode alterar este e-mail.
                </p>
              </div>
            </div>

            {profileError && <p className="mt-3 text-xs text-destructive">{profileError}</p>}
            {profileMessage && <p className="mt-3 text-xs font-medium text-success">{profileMessage}</p>}
            <Button className="mt-4" size="sm" onClick={saveProfile} disabled={profileSaving || avatarUploading}>
              {profileSaving ? "Salvando…" : "Salvar perfil"}
            </Button>

            <div className="mt-6 border-t border-border pt-5">
              <div className="flex items-center gap-2">
                <LockKey size={18} className="text-muted-foreground" />
                <h3 className="font-heading text-sm font-bold text-foreground">Alterar senha</h3>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="current-password" className="text-xs font-semibold text-muted-foreground">Senha atual</label>
                  <input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label htmlFor="new-password" className="text-xs font-semibold text-muted-foreground">Nova senha</label>
                  <input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label htmlFor="confirm-password" className="text-xs font-semibold text-muted-foreground">Confirmar nova senha</label>
                  <input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Use pelo menos 8 caracteres, com letras e números.</p>
              {passwordError && <p className="mt-2 text-xs text-destructive">{passwordError}</p>}
              {passwordMessage && <p className="mt-2 text-xs font-medium text-success">{passwordMessage}</p>}
              <Button
                className="mt-3"
                size="sm"
                variant="secondary"
                onClick={changePassword}
                disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}
              >
                <LockKey size={15} /> {passwordSaving ? "Alterando…" : "Alterar senha"}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Facebook connection */}
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FacebookLogo size={22} weight="fill" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-foreground">Conta do Facebook</h2>
              {settings.facebook_connected ? (
                <p className="mt-0.5 text-sm text-success">
                  Conectado como {settings.facebook_user_name ?? "sua conta"}
                </p>
              ) : settings.facebook_configured === false ? (
                <p className="mt-0.5 max-w-md text-sm text-muted-foreground">
                  Adicione abaixo o ID e a chave secreta do aplicativo Meta para ativar a conexão.
                  Os demais recursos funcionam sem essas credenciais.
                </p>
              ) : (
                <p className="mt-0.5 text-sm text-muted-foreground">Ainda não conectado</p>
              )}
            </div>
          </div>
          {settings.facebook_connected ? (
            <Button size="sm" variant="secondary" onClick={disconnect} disabled={disconnecting}>
              <LinkBreak size={14} /> Desconectar
            </Button>
          ) : (
            // A plain anchor on purpose: this route answers with a redirect to
            // Facebook, which needs a full page navigation. <Link> would try to
            // route it client-side.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a
              href="/api/facebook/oauth/start"
              aria-disabled={settings.facebook_configured === false}
              className={settings.facebook_configured === false ? "pointer-events-none" : undefined}
            >
              <Button size="sm" disabled={settings.facebook_configured === false}>
                <LinkSimple size={14} /> Conectar
              </Button>
            </a>
          )}
        </div>
      </Card>

      {/* Meta app credentials */}
      <Card>
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-muted-foreground">
            <Key size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-heading font-bold text-foreground">Meta app</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Crie um em{" "}
              <a
                href="https://developers.facebook.com/apps"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                developers.facebook.com/apps
              </a>{" "}
              usando o caso de uso <strong>&quot;Gerenciar tudo na sua Página&quot;</strong> — não
              o Facebook Login comum, que a Meta considera incompatível com o gerenciamento de
              Páginas. Publicar em uma Página administrada por você não exige análise do aplicativo.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">ID do Aplicativo</label>
                <input
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  placeholder="1234567890123456"
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Chave Secreta do Aplicativo</label>
                <input
                  type="password"
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  placeholder={
                    settings.facebook_app_secret_set ? "•••• salva — digite para substituir" : "em Configurações do aplicativo > Básico"
                  }
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="text-xs font-semibold text-muted-foreground">
                ID da configuração de login
              </label>
              <input
                value={configId}
                onChange={(e) => setConfigId(e.target.value)}
                placeholder="obrigatório se o aplicativo usa o Facebook Login for Business"
                className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Aplicativos criados com o caso de uso &quot;Gerenciar tudo na sua Página&quot; usam o
                Facebook Login for Business, no qual este ID substitui a lista de permissões.
                Encontre-o em <strong>Facebook Login for Business → Configurações</strong>.
                Deixe em branco para o Facebook Login clássico.
              </p>
            </div>

            <div className="mt-3">
              <label className="text-xs font-semibold text-muted-foreground">
                URI de redirecionamento — cole nas configurações de login da Meta, em URIs de redirecionamento OAuth válidos
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  readOnly
                  value={redirectUri}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 font-mono text-xs text-muted-foreground outline-none"
                />
                <Button size="sm" variant="secondary" onClick={() => copyValue(redirectUri, "uri")}>
                  {copied === "uri" ? <Check size={14} /> : <Copy size={14} />}
                  {copied === "uri" ? "Copiado" : "Copiar"}
                </Button>
              </div>
            </div>

            <div className="mt-3">
              <label className="text-xs font-semibold text-muted-foreground">
                Domínio do aplicativo — cole em Configurações do aplicativo &gt; Básico &gt; Domínios do aplicativo
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  readOnly
                  value={appDomain}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 font-mono text-xs text-muted-foreground outline-none"
                />
                <Button size="sm" variant="secondary" onClick={() => copyValue(appDomain, "domain")}>
                  {copied === "domain" ? <Check size={14} /> : <Copy size={14} />}
                  {copied === "domain" ? "Copiado" : "Copiar"}
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Sem isso, o Facebook recusará o login porque o domínio da URL não está incluído
                nos domínios do aplicativo. Não use <code className="rounded bg-surface-2 px-1 text-[11px]">https://</code>{" "}
                nem barra no final.
              </p>
            </div>

            {credsError && <p className="mt-2 text-xs text-destructive">{credsError}</p>}

            <div className="mt-4 flex items-center gap-2">
              <Button size="sm" onClick={saveCredentials} disabled={savingCreds}>
                {savingCreds ? "Salvando…" : "Salvar credenciais"}
              </Button>
              {settings.facebook_configured && (
                <span className="text-xs font-medium text-success">Credenciais salvas</span>
              )}
            </div>

            {/* Once the App ID is known these can be built for this exact app,
                which saves hunting through the Meta dashboard for the three
                screens this setup touches. */}
            {settings.facebook_app_id && (
              <div className="mt-4 border-t border-border pt-3">
                <p className="text-xs font-semibold text-muted-foreground">
                  Abrir no aplicativo Meta
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                  {[
                    {
                      label: "Configurações básicas — Domínios",
                      href: `https://developers.facebook.com/apps/${settings.facebook_app_id}/settings/basic/`,
                    },
                    {
                      label: "Casos de uso — adicionar permissões",
                      href: `https://developers.facebook.com/apps/${settings.facebook_app_id}/use_cases/`,
                    },
                    {
                      label: "Configurações de login — URIs de redirecionamento",
                      href: `https://developers.facebook.com/apps/${settings.facebook_app_id}/fb-login/settings/`,
                    },
                    {
                      label: "Configurações de login",
                      href: `https://developers.facebook.com/apps/${settings.facebook_app_id}/fb-login/configurations/`,
                    },
                    {
                      label: "Painel do aplicativo",
                      href: `https://developers.facebook.com/apps/${settings.facebook_app_id}/`,
                    },
                  ].map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {link.label} ↗
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Generation preferences */}
      <Card>
        <h2 className="font-heading font-bold text-foreground">Preferências de geração</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Escolha a fonte padrão aqui e gerencie chaves e modelos na aba{" "}
          <Link href="/dashboard/apis" className="font-medium text-primary hover:underline">APIs</Link>.
        </p>

        <div className="mt-4">
          <label className="text-xs font-semibold text-muted-foreground">Fonte de imagem padrão</label>
          <select
            value={settings.image_source}
            onChange={(e) => {
              const v = e.target.value as ImageSourcePref;
              setSettings({ ...settings, image_source: v });
              save({ image_source: v });
            }}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary sm:w-64"
          >
            <option value="ai">Imagem gerada por IA</option>
            <option value="stock">Foto gratuita de banco de imagens</option>
            <option value="mixed">Combinar as duas opções</option>
            <option value="template">Template viral local (mais econômico)</option>
          </select>
        </div>

        <div className="mt-4">
          <label className="text-xs font-semibold text-muted-foreground">
            Texto adicionado ao final de cada post (opcional, como um link UTM ou assinatura)
          </label>
          <input
            value={settings.utm_suffix}
            onChange={(e) => setSettings({ ...settings, utm_suffix: e.target.value })}
            onBlur={(e) => save({ utm_suffix: e.target.value })}
            placeholder="Acesse meusite.com.br"
            className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary"
          />
        </div>
      </Card>

      {/* Autopilot */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-heading font-bold text-foreground">Piloto automático</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Deixe o Facebook Auto Post escolher um tema e publicar sozinho, sem intervenção manual.
            </p>
            <p className="mt-1.5 text-sm text-foreground">
              Conteúdo sobre:{" "}
              <span className="font-semibold">
                {settings.topic_source === "trending"
                  ? "ideias em alta"
                  : settings.topic_source === "mixed"
                    ? "uma combinação dos seus temas e ideias em alta"
                    : "seus temas"}
              </span>{" "}
              ·{" "}
              <Link href="/dashboard/topics" className="font-medium text-primary hover:underline">
                Gerenciar temas
              </Link>
            </p>
          </div>
          <button
            onClick={() => {
              const next = !settings.auto_post_enabled;
              setSettings({ ...settings, auto_post_enabled: next });
              save({ auto_post_enabled: next });
            }}
            aria-label="Ativar ou desativar o piloto automático"
            className={cn(
              "relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition",
              settings.auto_post_enabled ? "bg-primary" : "bg-surface-2"
            )}
          >
            <span
              className={cn(
                "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition",
                settings.auto_post_enabled ? "left-6" : "left-1"
              )}
            />
          </button>
        </div>

        {!settings.default_page_name && (
          <p className="mt-3 text-xs text-warning">
            Defina uma Página padrão na tela Páginas — o piloto automático precisa dela para publicar.
          </p>
        )}

        <div className="mt-4 rounded-xl border border-border bg-background p-4">
          <p className="text-sm font-semibold text-foreground">Pronto para funcionar sozinho?</p>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <Ready ok={Boolean(automation?.connected)} label="Facebook conectado" />
            <Ready ok={Boolean(automation?.defaultPage && automation?.pageAccess)} label={automation?.defaultPage ? `Página padrão: ${automation.defaultPage}` : "Página padrão definida"} />
            <Ready ok={Boolean(automation?.aiTextReady)} label="API de texto configurada" />
            <Ready ok={Boolean(automation?.templateReady)} label={automation?.templateRequired ? "Template automático disponível" : "Fonte de imagem disponível"} />
            <Ready ok={Boolean(automation?.cronConfigured)} label="Agendador protegido na Vercel" />
            <Ready ok={settings.auto_post_enabled} label="Piloto automático ativado" />
          </div>
          {automation?.missingPermissions?.length ? <p className="mt-3 text-xs text-destructive">Permissões ausentes na Meta: {automation.missingPermissions.join(", ")}.</p> : null}
          {automation?.pageError ? <p className="mt-2 text-xs text-destructive">{automation.pageError}</p> : null}
          <p className="mt-3 text-xs text-muted-foreground">A Vercel executa o horário das 9h mesmo com seu computador desligado. Para 13h e 18h no plano gratuito, será necessário adicionar um agendador externo.</p>
        </div>

        {settings.image_source === "template" && (
          <div className="mt-4">
            <label className="text-xs font-semibold text-muted-foreground">Template usado pelo piloto automático</label>
            <select
              value={settings.default_template_id ?? ""}
              onChange={(event) => {
                const value = event.target.value || null;
                setSettings({ ...settings, default_template_id: value });
                save({ default_template_id: value });
              }}
              className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary"
            >
              <option value="">Selecionar automaticamente o primeiro compatível</option>
              {templates.filter((template) => template.enabled && (!template.page_id || template.page_id === settings.default_page_id)).map((template) => (
                <option key={template.id} value={template.id}>{template.name} · {template.niche}</option>
              ))}
            </select>
          </div>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Posts por dia</label>
            <input
              type="number"
              min={1}
              max={20}
              value={settings.posts_per_day}
              onChange={(e) => setSettings({ ...settings, posts_per_day: Number(e.target.value) })}
              onBlur={(e) => save({ posts_per_day: Number(e.target.value) })}
              className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Fuso horário</label>
            <select
              value={settings.timezone}
              onChange={(e) => {
                setSettings({ ...settings, timezone: e.target.value });
                save({ timezone: e.target.value });
              }}
              className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="text-xs font-semibold text-muted-foreground">
            Horários permitidos para publicação (hora local)
          </label>
          <div className="mt-1.5 grid grid-cols-6 gap-1.5 sm:grid-cols-12">
            {Array.from({ length: 24 }, (_, h) => h).map((h) => (
              <button
                key={h}
                onClick={() => toggleHour(h)}
                className={cn(
                  "cursor-pointer rounded-lg py-1.5 text-xs font-medium transition",
                  settings.posting_hours.includes(h)
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-2 text-muted-foreground hover:bg-border"
                )}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div className="h-4 text-right text-xs text-muted-foreground">
        {saving ? "Salvando…" : saved ? "Salvo ✓" : ""}
      </div>
    </div>
  );
}
