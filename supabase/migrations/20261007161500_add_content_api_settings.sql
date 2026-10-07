-- Server-only credentials and model choices editable from Dashboard > APIs.
alter table app_settings add column if not exists groq_api_key text;
alter table app_settings add column if not exists groq_model text default 'llama-3.3-70b-versatile';
alter table app_settings add column if not exists gemini_api_key text;
alter table app_settings add column if not exists gemini_model text default 'gemini-3.5-flash-lite';
alter table app_settings add column if not exists pollinations_api_key text;
alter table app_settings add column if not exists pollinations_text_model text default 'openai';
alter table app_settings add column if not exists pollinations_image_model text default 'flux';
alter table app_settings add column if not exists pexels_api_key text;
