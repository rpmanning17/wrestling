-- USA Bracketing source evidence is private and additive. This file changes no ratings.
-- The original collector identifies each bout by its own URL and source row 1,
-- unlike CSV exports that reserve row 1 for column names.
begin;

alter table public.matches drop constraint matches_source_row_check;
alter table public.matches add constraint matches_source_row_check
  check (source_row is null or source_row >= 1);

create table private.usa_bracketing_bout_evidence (
  provider_bout_id uuid primary key,
  provider_event_id uuid not null,
  source_pack text not null check (source_pack in ('youth','collector','melbourne')),
  archive_sha256 text not null check (archive_sha256 ~ '^[a-f0-9]{64}$'),
  source_file text not null unique,
  original_source_row integer not null check (original_source_row >= 1),
  raw_row_sha256 text not null check (raw_row_sha256 ~ '^[a-f0-9]{64}$'),
  original_record jsonb not null,
  verified_style text check (verified_style in ('Folkstyle','FS','GR')),
  date_basis text,
  review_state text not null,
  linked_match_id uuid references public.matches(id),
  created_at timestamptz not null default now()
);
create index usa_bout_evidence_match_idx on private.usa_bracketing_bout_evidence(linked_match_id)
 where linked_match_id is not null;
create index usa_bout_evidence_event_idx on private.usa_bracketing_bout_evidence(provider_event_id,review_state);

create table private.usa_bracketing_placement_evidence (
  evidence_key text primary key check (evidence_key ~ '^[a-f0-9]{64}$'),
  provider_event_id uuid not null,
  source_pack text not null check (source_pack in ('youth','collector','melbourne')),
  archive_sha256 text not null check (archive_sha256 ~ '^[a-f0-9]{64}$'),
  original_record jsonb not null,
  review_state text not null,
  linked_observation_id bigint references public.tournament_observations(id),
  created_at timestamptz not null default now()
);
create index usa_placement_event_idx on private.usa_bracketing_placement_evidence(provider_event_id);

create table private.usa_bracketing_owner_notes (
  note_key text primary key,
  note jsonb not null,
  created_at timestamptz not null default now()
);

create table private.usa_bracketing_import_runs (
  id uuid primary key default gen_random_uuid(),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  source_archive_hashes jsonb not null,
  imported integer not null default 0,
  deduplicated integer not null default 0,
  excluded integer not null default 0,
  held integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table private.usa_bracketing_bout_evidence enable row level security;
alter table private.usa_bracketing_placement_evidence enable row level security;
alter table private.usa_bracketing_owner_notes enable row level security;
alter table private.usa_bracketing_import_runs enable row level security;
revoke all on private.usa_bracketing_bout_evidence,
 private.usa_bracketing_placement_evidence,
 private.usa_bracketing_owner_notes,
 private.usa_bracketing_import_runs from public, anon, authenticated, service_role;

commit;
