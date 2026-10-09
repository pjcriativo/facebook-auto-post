-- Copiloto V2: independent automation, agent pools and durable jobs per Page.
create table if not exists page_automation_settings (
  page_id text primary key,
  enabled boolean not null default false,
  target_posts_per_day smallint not null default 8 check (target_posts_per_day between 1 and 25),
  timezone text not null default 'America/Sao_Paulo',
  active_start_minute smallint not null default 390 check (active_start_minute between 0 and 1439),
  active_end_minute smallint not null default 1410 check (active_end_minute between 0 and 1439),
  schedule_jitter_minutes smallint not null default 5 check (schedule_jitter_minutes between 0 and 15),
  topic_source text not null default 'mine' check (topic_source in ('mine', 'trending', 'mixed')),
  image_source text not null default 'template' check (image_source in ('ai', 'stock', 'mixed', 'template')),
  default_template_id uuid references content_templates(id) on delete set null,
  daily_credit_limit numeric,
  retention_days smallint not null default 14 check (retention_days between 1 and 90),
  strategy_enabled boolean not null default true,
  strategy_min_samples smallint not null default 20 check (strategy_min_samples between 3 and 100),
  exploration_rate numeric not null default 0.15 check (exploration_rate between 0 and 0.5),
  last_planned_at timestamptz,
  last_published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists facebook_page_credentials (
  page_id text primary key,
  access_token text not null,
  updated_at timestamptz not null default now()
);

create table if not exists page_agent_pool (
  page_id text not null,
  agent_id uuid not null references content_agents(id) on delete cascade,
  weight smallint not null default 100 check (weight between 1 and 100),
  is_primary boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (page_id, agent_id)
);

alter table topics add column if not exists page_id text;
alter table topics add column if not exists agent_id uuid references content_agents(id) on delete set null;
alter table topics add column if not exists pillar text;
alter table topics add column if not exists language text not null default 'pt-BR';
drop index if exists topics_text_lower_idx;
create unique index if not exists topics_scope_text_lower_idx
  on topics (coalesce(page_id, ''), lower(text));

create table if not exists publication_jobs (
  id uuid primary key default gen_random_uuid(),
  page_id text not null,
  agent_id uuid references content_agents(id) on delete set null,
  scheduled_at timestamptz not null,
  status text not null default 'planned' check (status in ('planned', 'generating', 'ready', 'publishing', 'published', 'retry', 'blocked', 'failed', 'cancelled')),
  post_id uuid references posts(id) on delete set null,
  idempotency_key text not null unique,
  attempts smallint not null default 0,
  max_attempts smallint not null default 3,
  next_retry_at timestamptz,
  lease_until timestamptz,
  locked_by text,
  quality_score smallint,
  quality_checks jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table posts add column if not exists publication_job_id uuid references publication_jobs(id) on delete set null;

create index if not exists page_automation_enabled_idx on page_automation_settings (enabled, page_id);
create index if not exists page_agent_pool_page_idx on page_agent_pool (page_id, enabled, weight desc);
create index if not exists topics_page_rotation_idx on topics (page_id, enabled, last_used_at nulls first);
create index if not exists publication_jobs_due_idx on publication_jobs (status, scheduled_at, next_retry_at);
create index if not exists publication_jobs_page_scheduled_idx on publication_jobs (page_id, scheduled_at desc);
create index if not exists posts_page_posted_idx on posts (page_id, posted_at desc) where posted_at is not null;
create index if not exists posts_publication_job_idx on posts (publication_job_id) where publication_job_id is not null;

insert into page_agent_pool (page_id, agent_id, weight, is_primary)
select page_id, agent_id, 100, true from page_agent_assignments
on conflict (page_id, agent_id) do update set is_primary = true, updated_at = now();

insert into page_automation_settings (
  page_id, target_posts_per_day, timezone, topic_source, image_source,
  default_template_id, strategy_enabled, strategy_min_samples, exploration_rate
)
select
  default_page_id,
  least(greatest(posts_per_day, 1), 25),
  timezone,
  coalesce(topic_source, 'mine'),
  image_source,
  default_template_id,
  coalesce(strategy_optimization_enabled, true),
  greatest(coalesce(strategy_min_samples, 3), 20),
  coalesce(strategy_exploration_rate, 0.15)
from app_settings
where id = 1 and default_page_id is not null
on conflict (page_id) do nothing;

alter table page_automation_settings enable row level security;
alter table facebook_page_credentials enable row level security;
alter table page_agent_pool enable row level security;
alter table publication_jobs enable row level security;

create or replace function compact_copilot_history()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  removed_snapshots integer := 0;
  removed_jobs integer := 0;
  removed_locks integer := 0;
begin
  delete from post_metric_snapshots old
  where old.fetched_at < now() - interval '45 days'
    and exists (
      select 1 from post_metric_snapshots newer
      where newer.post_id = old.post_id and newer.fetched_at > old.fetched_at
    );
  get diagnostics removed_snapshots = row_count;

  delete from publication_jobs
  where updated_at < now() - interval '45 days'
    and status in ('published', 'blocked', 'failed', 'cancelled');
  get diagnostics removed_jobs = row_count;

  delete from autopilot_runs where updated_at < now() - interval '30 days';
  get diagnostics removed_locks = row_count;

  return jsonb_build_object(
    'snapshots', removed_snapshots,
    'jobs', removed_jobs,
    'locks', removed_locks
  );
end;
$$;
