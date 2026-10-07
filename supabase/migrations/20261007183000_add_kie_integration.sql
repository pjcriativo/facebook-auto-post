alter table app_settings add column if not exists kie_api_key text;
alter table app_settings add column if not exists kie_enabled boolean not null default false;
alter table app_settings add column if not exists kie_image_enabled boolean not null default false;
alter table app_settings add column if not exists kie_text_model text not null default 'gemini-3-5-flash-openai';
alter table app_settings add column if not exists kie_text_fallback_model text not null default 'gpt-5-2';
alter table app_settings add column if not exists kie_image_model text not null default 'gpt-image-2-text-to-image';
alter table app_settings add column if not exists kie_image_fallback_model text not null default 'nano-banana-2';
alter table app_settings add column if not exists kie_daily_credit_limit numeric;
alter table app_settings add column if not exists kie_low_balance_threshold numeric not null default 100;
alter table app_settings add column if not exists kie_webhook_hmac_key text;

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
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_provider_created_idx on ai_usage (provider, created_at desc);
create index if not exists ai_generation_jobs_status_idx on ai_generation_jobs (status, created_at);
alter table ai_generation_jobs enable row level security;
alter table ai_usage enable row level security;
