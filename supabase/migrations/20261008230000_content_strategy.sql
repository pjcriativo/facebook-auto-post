alter table app_settings add column if not exists strategy_optimization_enabled boolean not null default true;
alter table app_settings add column if not exists strategy_min_samples smallint not null default 3;
alter table app_settings add column if not exists strategy_exploration_rate numeric not null default 0.15;

alter table app_settings drop constraint if exists app_settings_strategy_min_samples_check;
alter table app_settings add constraint app_settings_strategy_min_samples_check check (strategy_min_samples between 1 and 50);
alter table app_settings drop constraint if exists app_settings_strategy_exploration_rate_check;
alter table app_settings add constraint app_settings_strategy_exploration_rate_check check (strategy_exploration_rate between 0 and 0.5);
