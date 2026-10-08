-- Facebook Auto Post — Supabase schema
-- Run this in the Supabase SQL editor (Dashboard > SQL Editor > New query).
--
-- Safe to run again at any time. Every statement only creates what is missing,
-- so re-running this file is also how an existing install is upgraded after
-- pulling a newer version of the app — see the "Upgrades" section at the end.

create extension if not exists "pgcrypto";

-- Singleton settings row (id is always 1). Holds the Facebook tokens, the
-- selected Page, and generation preferences. Single-user app, so one row.
create table if not exists app_settings (
  id smallint primary key default 1,
  -- Editable profile for the single administrator. The email and password
  -- environment variables remain bootstrap fallbacks until these are set.
  admin_full_name text,
  admin_email text,
  admin_avatar_url text,
  admin_password_hash text,
  -- Content provider credentials. These never leave authenticated server APIs.
  groq_api_key text,
  groq_model text default 'llama-3.3-70b-versatile',
  gemini_api_key text,
  gemini_model text default 'gemini-3.5-flash-lite',
  pollinations_api_key text,
  pollinations_text_model text default 'openai',
  pollinations_image_model text default 'flux',
  pexels_api_key text,
  kie_api_key text,
  kie_enabled boolean not null default false,
  kie_image_enabled boolean not null default false,
  kie_text_model text not null default 'deepseek-v4-1-flash',
  kie_text_fallback_model text not null default 'claude-sonnet-5',
  kie_image_model text not null default 'gpt-image-2-text-to-image',
  kie_image_fallback_model text not null default 'nano-banana-2',
  kie_daily_credit_limit numeric default 100,
  kie_low_balance_threshold numeric not null default 100,
  kie_webhook_hmac_key text,
  -- Meta app credentials. Kept here rather than in env vars so that installing
  -- this app is a paste into Settings, not a redeploy. Never leaves the server.
  facebook_app_id text,
  facebook_app_secret text,
  -- Facebook Login for Business configuration id, when the Meta app uses it.
  facebook_config_id text,
  -- Long-lived user token (~60 days), used only to list Pages and to mint
  -- Page tokens. Posting never uses it directly.
  facebook_user_token text,
  facebook_token_expires_at timestamptz,
  facebook_user_name text,
  -- Page tokens derived from a long-lived user token do not expire, so this is
  -- what the app actually posts with.
  default_page_id text,
  default_page_name text,
  default_page_token text,
  default_template_id uuid,
  image_source text not null default 'ai',        -- 'ai' | 'stock' | 'mixed'
  utm_suffix text default '',
  auto_post_enabled boolean not null default false,
  posts_per_day smallint not null default 3,
  posting_hours int[] not null default '{9,13,18}', -- local hours (0-23) the queue is allowed to fire
  timezone text not null default 'America/Sao_Paulo',
  last_auto_post_at timestamptz, -- prevents the autopilot firing twice in one posting-hour slot
  topic_source text not null default 'mine',       -- 'mine' | 'trending' | 'mixed'
  strategy_optimization_enabled boolean not null default true,
  strategy_min_samples smallint not null default 3,
  strategy_exploration_rate numeric not null default 0.15,
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);

insert into app_settings (id) values (1) on conflict (id) do nothing;

-- Configurable content specialists. Agents can own several Facebook Pages;
-- each Page has at most one primary agent and one default language.
create table if not exists content_agents (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  role text not null,
  description text not null default '',
  category text not null default 'Cristão',
  mission text not null default '',
  avatar_url text,
  enabled boolean not null default true,
  tone text not null default '',
  audience text not null default '',
  specialties text[] not null default '{}',
  content_pillars text[] not null default '{}',
  forbidden_topics text[] not null default '{}',
  preferred_ctas text[] not null default '{}',
  theological_line text not null default '',
  bible_translation text not null default '',
  system_prompt text not null default '',
  primary_model text,
  fallback_model text,
  creativity numeric not null default 0.8,
  prompt_version integer not null default 1,
  visual_strategy jsonb not null default '{}'::jsonb,
  avatar_config jsonb not null default '{}'::jsonb,
  voice_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_languages (
  agent_id uuid not null references content_agents(id) on delete cascade,
  locale text not null,
  label text not null,
  instructions text not null default '',
  enabled boolean not null default true,
  voice_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (agent_id, locale)
);

create table if not exists page_agent_assignments (
  page_id text primary key,
  agent_id uuid not null references content_agents(id) on delete cascade,
  language text not null default 'pt-BR',
  specialty_weights jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per generated/queued/published post. Facebook takes a single
-- `message`, but title/description/hashtags stay separate here so the editor
-- can keep them apart; they are composed at publish time.
create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  title text not null,
  description text not null,
  hashtags text[] not null default '{}',
  image_url text not null,          -- final image used (Supabase Storage URL)
  image_source text not null,       -- 'ai' | 'stock'
  base_image_url text,              -- raw AI/stock photo before the text overlay
  image_hook text,
  image_prompt text,
  overlay_style text,
  link_url text,                    -- optional link included in the post
  page_id text,
  page_name text,
  status text not null default 'draft', -- 'draft' | 'scheduled' | 'posted' | 'failed'
  scheduled_at timestamptz,
  posted_at timestamptz,
  facebook_post_id text,
  error_message text,
  generation_id uuid,
  agent_id uuid references content_agents(id) on delete set null,
  content_language text,
  agent_prompt_version integer,
  created_at timestamptz not null default now()
);

create index if not exists posts_status_scheduled_idx on posts (status, scheduled_at);
create index if not exists posts_created_idx on posts (created_at desc);

-- Historical engagement snapshots from Meta. Keeping snapshots instead of
-- overwriting counters lets the reports show how each post grows over time.
create table if not exists post_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  page_id text,
  facebook_post_id text not null,
  reactions integer not null default 0,
  comments integer not null default 0,
  shares integer not null default 0,
  clicks integer not null default 0,
  views integer not null default 0,
  metric_source text not null default 'graph_fields',
  viral_score numeric not null default 0,
  permalink_url text,
  raw_data jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists post_metric_snapshots_post_fetched_idx on post_metric_snapshots (post_id, fetched_at desc);
create index if not exists post_metric_snapshots_fetched_idx on post_metric_snapshots (fetched_at desc);

-- Cached list of the Pages this account can post to (refreshed on demand).
create table if not exists pages_cache (
  page_id text primary key,
  name text not null,
  category text,
  username text,
  picture_url text,
  fetched_at timestamptz not null default now()
);

-- The owner's own topics and keywords. Autopilot writes about these, taking
-- the least recently used enabled one each time, so the whole list is covered
-- before anything repeats.
create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  enabled boolean not null default true,
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Reusable deterministic image layouts. Only the copy changes per post, so a
-- template costs no image-generation tokens and keeps brand geometry exact.
create table if not exists content_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  layout text not null default 'viral_quote',
  niche text not null default 'Geral',
  description text not null default '',
  page_id text,
  identity_source text not null default 'profile',
  avatar_url text,
  handle text not null default '@seuperfil',
  background_color text not null default '#000000',
  text_color text not null default '#ffffff',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into content_templates (id, name, handle)
values ('00000000-0000-4000-8000-000000000001', 'Frase viral minimalista', 'pr.marcosgp')
on conflict (id) do nothing;

-- Case-insensitive uniqueness, so pasting the same list twice adds nothing.
create unique index if not exists topics_text_lower_idx on topics (lower(text));
create index if not exists topics_rotation_idx on topics (enabled, last_used_at nulls first);
create index if not exists content_templates_page_niche_idx on content_templates (page_id, niche, enabled);

create table if not exists ai_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'kie',
  provider_task_id text not null unique,
  kind text not null default 'image',
  model text not null,
  fallback_model text,
  fallback_attempted boolean not null default false,
  status text not null default 'pending',
  prompt text not null,
  result_url text,
  error_message text,
  credits_used numeric,
  generation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  operation text not null,
  model text not null,
  credits_used numeric not null default 0,
  status text not null,
  latency_ms integer,
  error_message text,
  generation_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_provider_created_idx on ai_usage (provider, created_at desc);
create index if not exists ai_usage_generation_idx on ai_usage (generation_id, created_at);
create index if not exists ai_generation_jobs_status_idx on ai_generation_jobs (status, created_at);

create table if not exists autopilot_runs (
  slot_key text primary key,
  status text not null default 'running',
  post_id uuid,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The app accesses these tables exclusively from server code with the service
-- role. Enabling RLS without public policies prevents the automatically
-- granted anon/authenticated roles from reading tokens or changing app data.
alter table app_settings enable row level security;
alter table content_agents enable row level security;
alter table agent_languages enable row level security;
alter table page_agent_assignments enable row level security;
alter table autopilot_runs enable row level security;
alter table posts enable row level security;
alter table post_metric_snapshots enable row level security;
alter table pages_cache enable row level security;
alter table topics enable row level security;
alter table content_templates enable row level security;
alter table ai_generation_jobs enable row level security;
alter table ai_usage enable row level security;

-- Public bucket every generated/sourced image is re-hosted into, so a post's
-- image keeps working even if the free provider it came from goes down later.
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Upgrades
--
-- `create table if not exists` leaves an existing table exactly as it was, so
-- columns added to app_settings after the first public release have to be
-- added explicitly for installs that already have the table. Each line is a
-- no-op when the column is already there.
-- ---------------------------------------------------------------------------

alter table app_settings add column if not exists facebook_app_id text;
alter table app_settings add column if not exists facebook_app_secret text;
alter table app_settings add column if not exists facebook_config_id text;
alter table app_settings add column if not exists topic_source text not null default 'mine';
alter table app_settings add column if not exists admin_full_name text;
alter table app_settings add column if not exists admin_email text;
alter table app_settings add column if not exists admin_avatar_url text;
alter table app_settings add column if not exists admin_password_hash text;
alter table app_settings add column if not exists groq_api_key text;
alter table app_settings add column if not exists groq_model text default 'llama-3.3-70b-versatile';
alter table app_settings add column if not exists gemini_api_key text;
alter table app_settings add column if not exists gemini_model text default 'gemini-3.5-flash-lite';
alter table app_settings add column if not exists pollinations_api_key text;
alter table app_settings add column if not exists pollinations_text_model text default 'openai';
alter table app_settings add column if not exists pollinations_image_model text default 'flux';
alter table app_settings add column if not exists pexels_api_key text;
alter table app_settings add column if not exists kie_api_key text;
alter table app_settings add column if not exists kie_enabled boolean not null default false;
alter table app_settings add column if not exists kie_image_enabled boolean not null default false;
alter table app_settings add column if not exists kie_text_model text not null default 'deepseek-v4-1-flash';
alter table app_settings add column if not exists kie_text_fallback_model text not null default 'claude-sonnet-5';
alter table app_settings add column if not exists kie_image_model text not null default 'gpt-image-2-text-to-image';
alter table app_settings add column if not exists kie_image_fallback_model text not null default 'nano-banana-2';
alter table app_settings add column if not exists kie_daily_credit_limit numeric default 100;
alter table app_settings add column if not exists kie_low_balance_threshold numeric not null default 100;
alter table app_settings add column if not exists kie_webhook_hmac_key text;
alter table app_settings add column if not exists default_template_id uuid;
alter table pages_cache add column if not exists username text;
alter table pages_cache add column if not exists picture_url text;
alter table content_templates add column if not exists niche text not null default 'Geral';
alter table content_templates add column if not exists description text not null default '';
alter table content_templates add column if not exists page_id text;
alter table content_templates add column if not exists identity_source text not null default 'profile';
alter table ai_generation_jobs add column if not exists generation_id uuid;
alter table ai_usage add column if not exists generation_id uuid;
alter table ai_usage add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table posts add column if not exists generation_id uuid;
alter table posts add column if not exists template_id uuid references content_templates(id) on delete set null;
create index if not exists posts_template_idx on posts (template_id) where template_id is not null;
alter table app_settings add column if not exists strategy_optimization_enabled boolean not null default true;
alter table app_settings add column if not exists strategy_min_samples smallint not null default 3;
alter table app_settings add column if not exists strategy_exploration_rate numeric not null default 0.15;
alter table app_settings drop constraint if exists app_settings_strategy_min_samples_check;
alter table app_settings add constraint app_settings_strategy_min_samples_check check (strategy_min_samples between 1 and 50);
alter table app_settings drop constraint if exists app_settings_strategy_exploration_rate_check;
alter table app_settings add constraint app_settings_strategy_exploration_rate_check check (strategy_exploration_rate between 0 and 0.5);
alter table post_metric_snapshots add column if not exists clicks integer not null default 0;
alter table post_metric_snapshots add column if not exists views integer not null default 0;
alter table post_metric_snapshots add column if not exists metric_source text not null default 'graph_fields';
