alter table posts add column if not exists template_id uuid references content_templates(id) on delete set null;
create index if not exists posts_template_idx on posts (template_id) where template_id is not null;
