-- Up Migration: 001_initial_schema.sql
-- Matching spec in info.md section 8

create table if not exists players (
  id            serial primary key,
  display_id    text unique not null,
  full_name     text not null,
  contact_key   text unique not null,
  consent_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create table if not exists runs (
  id             serial primary key,
  player_id      int not null references players(id),
  status         text not null check (status in ('valid','redo','disqualified','aborted')),
  score          int not null,
  accuracy       numeric(5,2) not null,
  avg_focus      numeric(5,2) not null,
  best_streak_s  numeric(6,2) not null,
  seed           int not null,
  calibration    jsonb not null,
  started_at     timestamptz not null,
  finished_at    timestamptz
);

create unique index if not exists one_valid_run_per_player on runs(player_id) where status = 'valid';

create table if not exists run_events (
  id        bigserial primary key,
  run_id    int not null references runs(id) on delete cascade,
  t_ms      int not null,
  kind      text not null,
  focus     numeric(5,2) not null,
  data      jsonb
);

create table if not exists focus_samples (
  run_id  int not null references runs(id) on delete cascade,
  t_ms    int not null,
  score   numeric(5,2) not null,
  primary key (run_id, t_ms)
);

create table if not exists audit_log (
  id         bigserial primary key,
  actor      text not null,
  action     text not null,
  details    jsonb,
  created_at timestamptz not null default now()
);
