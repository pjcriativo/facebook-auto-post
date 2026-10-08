export type ImageSource = "ai" | "stock" | "template";
export type ImageSourcePref = "ai" | "stock" | "mixed" | "template";
export type ImageOverlayStyle = "gradient" | "card" | "center";
export type PostStatus = "draft" | "scheduled" | "posted" | "failed";

/**
 * Where autopilot gets its subjects. "mine" rotates through the owner's own
 * topic list and only borrows trending ideas while that list is empty.
 */
export type TopicSource = "mine" | "trending" | "mixed";
export type AgentLanguage = "pt-BR" | "en-US" | "es-419" | "de-DE" | "fr-FR";

export interface AgentLanguageProfile {
  agent_id: string;
  locale: AgentLanguage;
  label: string;
  instructions: string;
  enabled: boolean;
  voice_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PageAgentAssignment {
  page_id: string;
  agent_id: string;
  language: AgentLanguage;
  specialty_weights: Record<string, number>;
  created_at: string;
  updated_at: string;
}

export interface ContentAgent {
  id: string;
  slug: string;
  name: string;
  role: string;
  description: string;
  category: string;
  mission: string;
  avatar_url: string | null;
  enabled: boolean;
  tone: string;
  audience: string;
  specialties: string[];
  content_pillars: string[];
  forbidden_topics: string[];
  preferred_ctas: string[];
  theological_line: string;
  bible_translation: string;
  system_prompt: string;
  primary_model: string | null;
  fallback_model: string | null;
  creativity: number;
  prompt_version: number;
  visual_strategy: Record<string, unknown>;
  avatar_config: Record<string, unknown>;
  voice_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  languages?: AgentLanguageProfile[];
  page_assignments?: PageAgentAssignment[];
}

export interface Topic {
  id: string;
  text: string;
  enabled: boolean;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
}

export interface AppSettings {
  id: 1;
  /** Editable profile for the single administrator. Environment values remain fallbacks. */
  admin_full_name?: string | null;
  admin_email?: string | null;
  admin_avatar_url?: string | null;
  /** Server-only scrypt hash. This field must never be returned to the browser. */
  admin_password_hash?: string | null;
  /** Server-only content-provider credentials and editable model choices. */
  groq_api_key?: string | null;
  groq_model?: string | null;
  gemini_api_key?: string | null;
  gemini_model?: string | null;
  pollinations_api_key?: string | null;
  pollinations_text_model?: string | null;
  pollinations_image_model?: string | null;
  pexels_api_key?: string | null;
  kie_api_key?: string | null;
  kie_enabled?: boolean;
  kie_image_enabled?: boolean;
  kie_text_model?: string | null;
  kie_text_fallback_model?: string | null;
  kie_image_model?: string | null;
  kie_image_fallback_model?: string | null;
  kie_daily_credit_limit?: number | null;
  kie_low_balance_threshold?: number | null;
  /** Optional Kie webhook secret; server-only and never returned to the browser. */
  kie_webhook_hmac_key?: string | null;
  /** Meta app credentials, normally entered in Settings rather than env vars. */
  facebook_app_id: string | null;
  facebook_app_secret: string | null;
  /**
   * Facebook Login for Business "login configuration" id. Apps created with the
   * Page-management use case get Login for Business, where config_id replaces
   * scope — the permissions come from the saved configuration instead of the
   * URL. Null means the app uses classic Facebook Login and scopes.
   */
  facebook_config_id: string | null;
  /** Long-lived user token — lists Pages and mints Page tokens, never posts. */
  facebook_user_token: string | null;
  facebook_token_expires_at: string | null;
  facebook_user_name: string | null;
  default_page_id: string | null;
  default_page_name: string | null;
  /** Page tokens derived from a long-lived user token do not expire. */
  default_page_token: string | null;
  /** Preferred reusable design for unattended posts; falls back to the first compatible template. */
  default_template_id?: string | null;
  image_source: ImageSourcePref;
  utm_suffix: string;
  auto_post_enabled: boolean;
  posts_per_day: number;
  posting_hours: number[];
  timezone: string;
  last_auto_post_at: string | null;
  /** Absent on databases created before topics existed; treat as "mine". */
  topic_source?: TopicSource;
  updated_at: string;
}

export interface Post {
  id: string;
  topic: string;
  title: string;
  description: string;
  hashtags: string[];
  image_url: string;
  image_source: ImageSource;
  /** Original photograph before our deterministic hook/identity overlay. */
  base_image_url?: string | null;
  image_hook?: string | null;
  image_prompt?: string | null;
  overlay_style?: ImageOverlayStyle | null;
  link_url: string | null;
  page_id: string | null;
  page_name: string | null;
  status: PostStatus;
  scheduled_at: string | null;
  posted_at: string | null;
  facebook_post_id: string | null;
  error_message: string | null;
  generation_id?: string | null;
  template_id?: string | null;
  agent_id?: string | null;
  content_language?: AgentLanguage | null;
  agent_prompt_version?: number | null;
  created_at: string;
}

export interface PostMetricSnapshot {
  id: string;
  post_id: string;
  page_id: string | null;
  facebook_post_id: string;
  reactions: number;
  comments: number;
  shares: number;
  viral_score: number;
  permalink_url: string | null;
  raw_data: Record<string, unknown>;
  fetched_at: string;
}

export interface PageCache {
  page_id: string;
  name: string;
  category: string | null;
  username?: string | null;
  picture_url?: string | null;
  fetched_at: string;
}

/** Which free service actually wrote the copy. "template" means every AI
 *  provider was unreachable and the deterministic fallback was used. */
export type ContentProvider = "kie" | "groq" | "gemini" | "pollinations" | "template";

export interface AiGenerationJob {
  id: string;
  provider: "kie";
  provider_task_id: string;
  kind: "image";
  model: string;
  fallback_model: string | null;
  fallback_attempted: boolean;
  status: "pending" | "success" | "failed";
  prompt: string;
  result_url: string | null;
  error_message: string | null;
  credits_used: number | null;
  generation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface GeneratedContent {
  title: string;
  description: string;
  hashtags: string[];
  /** Short, line-break-friendly copy rendered inside a reusable visual template. */
  artText?: string;
  /** Short headline composed over AI/stock photography by our own renderer. */
  imageHook?: string;
  /** Visual direction for image models, written in English for consistency. */
  imagePrompt?: string;
  /** Concise English query used by stock-photo search. */
  stockQuery?: string;
  provider?: ContentProvider;
  /** First provider failure, surfaced so a degraded draft can explain itself. */
  providerError?: string;
  /** Exact specialist configuration used to write this content. */
  agentContext?: {
    agentId: string;
    agentName: string;
    role: string;
    language: AgentLanguage;
    languageLabel: string;
    promptVersion: number;
  } | null;
}

export interface ContentTemplate {
  id: string;
  name: string;
  layout: "viral_quote" | "centered_quote" | "bold_statement";
  niche: string;
  description: string;
  page_id: string | null;
  identity_source: "profile" | "page" | "custom";
  avatar_url: string | null;
  handle: string;
  background_color: string;
  text_color: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Public URL of a published post. Facebook returns `post_id` as
 * `<page-id>_<post-id>`, and that composite is itself addressable.
 */
export const facebookPostUrl = (postId: string) => `https://www.facebook.com/${postId}`;

export const isFacebookConnected = (s: Pick<AppSettings, "facebook_user_token">) =>
  Boolean(s.facebook_user_token);

/**
 * Facebook takes one `message` per post, so the separately-edited parts are
 * composed here — one place, shared by the publisher and the preview.
 */
export function composeMessage(
  post: Pick<Post, "title" | "description" | "hashtags" | "link_url">,
  utmSuffix = ""
): string {
  const tags = post.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ");
  return [post.title, post.description, post.link_url ?? "", tags, utmSuffix]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}
