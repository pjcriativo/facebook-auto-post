-- Attribute paid AI usage to a Page so Copilot V2 can enforce independent budgets.
alter table ai_usage add column if not exists page_id text;
create index if not exists ai_usage_page_created_idx on ai_usage (page_id, created_at desc);
