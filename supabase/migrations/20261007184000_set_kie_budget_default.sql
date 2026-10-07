alter table app_settings
  alter column kie_daily_credit_limit set default 100;

update app_settings
set kie_daily_credit_limit = 100
where kie_daily_credit_limit is null;
