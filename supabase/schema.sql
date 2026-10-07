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
  image_source text not null default 'ai',        -- 'ai' | 'stock' | 'mixed'
  utm_suffix text default '',
  auto_post_enabled boolean not null default false,
  posts_per_day smallint not null default 3,
  posting_hours int[] not null default '{9,13,18}', -- local hours (0-23) the queue is allowed to fire
  timezone text not null default 'America/Sao_Paulo',
  last_auto_post_at timestamptz, -- prevents the autopilot firing twice in one posting-hour slot
  topic_source text not null default 'mine',       -- 'mine' | 'trending' | 'mixed'
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);

insert into app_settings (id) values (1) on conflict (id) do nothing;

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
  link_url text,                    -- optional link included in the post
  page_id text,
  page_name text,
  status text not null default 'draft', -- 'draft' | 'scheduled' | 'posted' | 'failed'
  scheduled_at timestamptz,
  posted_at timestamptz,
  facebook_post_id text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists posts_status_scheduled_idx on posts (status, scheduled_at);
create index if not exists posts_created_idx on posts (created_at desc);

-- Cached list of the Pages this account can post to (refreshed on demand).
create table if not exists pages_cache (
  page_id text primary key,
  name text not null,
  category text,
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

-- Case-insensitive uniqueness, so pasting the same list twice adds nothing.
create unique index if not exists topics_text_lower_idx on topics (lower(text));
create index if not exists topics_rotation_idx on topics (enabled, last_used_at nulls first);

-- The app accesses these tables exclusively from server code with the service
-- role. Enabling RLS without public policies prevents the automatically
-- granted anon/authenticated roles from reading tokens or changing app data.
alter table app_settings enable row level security;
alter table posts enable row level security;
alter table pages_cache enable row level security;
alter table topics enable row level security;

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
