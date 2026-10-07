-- Facebook Auto Post — initial database schema.
--
-- This migration is intentionally idempotent so it can baseline an existing
-- installation created from supabase/schema.sql as well as provision a fresh
-- Supabase project.

create extension if not exists "pgcrypto";

create table if not exists app_settings (
  id smallint primary key default 1,
  facebook_app_id text,
  facebook_app_secret text,
  facebook_config_id text,
  facebook_user_token text,
  facebook_token_expires_at timestamptz,
  facebook_user_name text,
  default_page_id text,
  default_page_name text,
  default_page_token text,
  image_source text not null default 'ai',
  utm_suffix text default '',
  auto_post_enabled boolean not null default false,
  posts_per_day smallint not null default 3,
  posting_hours int[] not null default '{9,13,18}',
  timezone text not null default 'Asia/Karachi',
  last_auto_post_at timestamptz,
  topic_source text not null default 'mine',
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);

insert into app_settings (id) values (1) on conflict (id) do nothing;

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  title text not null,
  description text not null,
  hashtags text[] not null default '{}',
  image_url text not null,
  image_source text not null,
  link_url text,
  page_id text,
  page_name text,
  status text not null default 'draft',
  scheduled_at timestamptz,
  posted_at timestamptz,
  facebook_post_id text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists posts_status_scheduled_idx on posts (status, scheduled_at);
create index if not exists posts_created_idx on posts (created_at desc);

create table if not exists pages_cache (
  page_id text primary key,
  name text not null,
  category text,
  fetched_at timestamptz not null default now()
);

create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  enabled boolean not null default true,
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists topics_text_lower_idx on topics (lower(text));
create index if not exists topics_rotation_idx on topics (enabled, last_used_at nulls first);

-- Upgrade paths for installations created before these settings existed.
alter table app_settings add column if not exists facebook_app_id text;
alter table app_settings add column if not exists facebook_app_secret text;
alter table app_settings add column if not exists facebook_config_id text;
alter table app_settings add column if not exists topic_source text not null default 'mine';

-- Only server-side service-role requests may access application data. No anon
-- or authenticated policies are created intentionally.
alter table app_settings enable row level security;
alter table posts enable row level security;
alter table pages_cache enable row level security;
alter table topics enable row level security;

insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do update set public = excluded.public;
