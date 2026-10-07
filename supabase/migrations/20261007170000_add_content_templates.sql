create table if not exists content_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  layout text not null default 'viral_quote',
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

alter table content_templates enable row level security;
