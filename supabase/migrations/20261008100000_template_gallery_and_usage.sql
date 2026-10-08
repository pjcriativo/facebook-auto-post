alter table pages_cache add column if not exists username text;
alter table pages_cache add column if not exists picture_url text;

alter table content_templates add column if not exists niche text not null default 'Geral';
alter table content_templates add column if not exists description text not null default '';
alter table content_templates add column if not exists page_id text;
alter table content_templates add column if not exists identity_source text not null default 'profile';

update content_templates
set niche = 'Fé e oração', identity_source = 'profile'
where lower(handle) like '%marcosgp%';

alter table ai_generation_jobs add column if not exists generation_id uuid;
alter table ai_usage add column if not exists generation_id uuid;
alter table ai_usage add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table posts add column if not exists generation_id uuid;

create index if not exists content_templates_page_niche_idx
  on content_templates (page_id, niche, enabled);
create index if not exists ai_usage_generation_idx
  on ai_usage (generation_id, created_at);
