create table if not exists autopilot_runs (
  slot_key text primary key,
  status text not null default 'running',
  post_id uuid,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table autopilot_runs enable row level security;

