alter table posts add column if not exists base_image_url text;
alter table posts add column if not exists image_hook text;
alter table posts add column if not exists image_prompt text;
alter table posts add column if not exists overlay_style text;
