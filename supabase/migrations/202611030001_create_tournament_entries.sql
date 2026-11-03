begin;

create table public.tournament_entries (
  id bigint generated always as identity primary key,
  event_date date not null,
  event_name text not null check (char_length(event_name) between 1 and 160),
  city text not null default '' check (char_length(city) <= 100),
  state text not null default '' check (char_length(state) <= 10),
  athlete_name text not null check (char_length(athlete_name) between 1 and 100),
  team text not null default '' check (char_length(team) <= 160),
  division_label text not null check (char_length(division_label) between 1 and 100),
  age_group text not null check (age_group in ('6U', '8U', '10U', '12U', '14U', '16U', '18U')),
  birth_year_start smallint not null check (birth_year_start between 1900 and 2100),
  birth_year_end smallint not null check (birth_year_end between 1900 and 2100),
  experience_division text not null check (experience_division in ('open', 'rookie')),
  bracket_weight_lbs numeric(5,2) not null check (bracket_weight_lbs > 0 and bracket_weight_lbs <= 400),
  placement smallint check (placement is null or placement > 0),
  placement_basis text check (placement_basis is null or placement_basis in ('reported', 'derived_round_robin')),
  confidence text not null default 'confirmed' check (confidence in ('confirmed', 'derived')),
  source_file text not null check (char_length(source_file) between 1 and 200),
  source_key text not null check (char_length(source_key) between 1 and 240),
  created_at timestamptz not null default now(),
  constraint tournament_entries_birth_year_order check (birth_year_start <= birth_year_end),
  constraint tournament_entries_source_unique unique (source_file, source_key)
);

alter table public.tournament_entries enable row level security;

revoke all on public.tournament_entries from public, authenticated;
grant select, insert, update, delete on public.tournament_entries to anon;
grant select, insert, update, delete on public.tournament_entries to service_role;
grant usage, select on sequence public.tournament_entries_id_seq to anon, service_role;

create policy "Personal app can read tournament entries"
  on public.tournament_entries for select to anon
  using ((select private.personal_app_request_is_valid()));

create policy "Personal app can add tournament entries"
  on public.tournament_entries for insert to anon
  with check ((select private.personal_app_request_is_valid()));

create policy "Personal app can update tournament entries"
  on public.tournament_entries for update to anon
  using ((select private.personal_app_request_is_valid()))
  with check ((select private.personal_app_request_is_valid()));

create policy "Personal app can delete tournament entries"
  on public.tournament_entries for delete to anon
  using ((select private.personal_app_request_is_valid()));

create index tournament_entries_scouting_idx
  on public.tournament_entries (age_group, experience_division, bracket_weight_lbs, event_date desc);

create index tournament_entries_athlete_event_idx
  on public.tournament_entries (lower(athlete_name), event_date desc);

commit;
