-- Align new installations and untouched legacy settings with the Brazilian
-- production schedule configured in vercel.json.
alter table app_settings
  alter column timezone set default 'America/Sao_Paulo';

update app_settings
set timezone = 'America/Sao_Paulo', updated_at = now()
where timezone = 'Asia/Karachi';
