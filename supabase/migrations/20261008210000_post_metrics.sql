create table if not exists post_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  page_id text,
  facebook_post_id text not null,
  reactions integer not null default 0,
  comments integer not null default 0,
  shares integer not null default 0,
  viral_score numeric not null default 0,
  permalink_url text,
  raw_data jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists post_metric_snapshots_post_fetched_idx
  on post_metric_snapshots (post_id, fetched_at desc);
create index if not exists post_metric_snapshots_fetched_idx
  on post_metric_snapshots (fetched_at desc);

alter table post_metric_snapshots enable row level security;
