alter table app_settings
  alter column kie_text_model set default 'deepseek-v4-1-flash',
  alter column kie_text_fallback_model set default 'claude-sonnet-5';

-- Upgrade only installations that still use the original automatic defaults.
-- Explicit model choices made by an administrator are preserved.
update app_settings
set
  kie_text_model = 'deepseek-v4-1-flash',
  kie_text_fallback_model = 'claude-sonnet-5',
  updated_at = now()
where kie_text_model = 'gemini-3-5-flash-openai'
  and kie_text_fallback_model = 'gpt-5-2';
