-- The first full production prompt used 0.23 credit. Seven credits preserve
-- a strict ceiling while covering 24 similar texts plus a small retry margin.
update page_automation_settings
set daily_credit_limit = 7,
    updated_at = now()
where page_id = '110466444020119';
