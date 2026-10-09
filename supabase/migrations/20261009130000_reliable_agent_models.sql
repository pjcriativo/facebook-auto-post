-- Prefer the lowest-cost model that passed strict JSON tests; keep a reliable fallback.
update content_agents
set primary_model = 'gpt-5-6-terra',
    fallback_model = 'gpt-5-5',
    updated_at = now()
where slug in (
  'mestre-biblico',
  'intercessor-libertacao',
  'conselheiro-pastoral',
  'devocional-motivacional',
  'missionario-evangelista'
);

update page_automation_settings
set daily_credit_limit = 5,
    updated_at = now()
where page_id = '110466444020119';
