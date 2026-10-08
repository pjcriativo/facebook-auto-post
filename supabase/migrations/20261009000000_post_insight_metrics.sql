alter table post_metric_snapshots add column if not exists clicks integer not null default 0;
alter table post_metric_snapshots add column if not exists views integer not null default 0;
alter table post_metric_snapshots add column if not exists metric_source text not null default 'graph_fields';
