-- Editable profile for the app's single administrator. ADMIN_EMAIL and
-- ADMIN_PASSWORD remain bootstrap fallbacks until the corresponding values
-- are saved from the Settings screen.
alter table app_settings add column if not exists admin_full_name text;
alter table app_settings add column if not exists admin_email text;
alter table app_settings add column if not exists admin_avatar_url text;
alter table app_settings add column if not exists admin_password_hash text;
