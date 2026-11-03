begin;

create table public.tournament_observations (
  id bigint generated always as identity primary key,
  event_date date not null,
  event_end_date date,
  event_name text not null check (char_length(event_name) between 1 and 160),
  city text not null default '' check (char_length(city) <= 100),
  state text not null default '' check (char_length(state) <= 10),
  athlete_name text not null check (char_length(athlete_name) between 1 and 100),
  team text not null default '' check (char_length(team) <= 160),
  division_label text not null check (char_length(division_label) between 1 and 100),
  division_gender text not null check (division_gender in ('boys', 'girls')),
  division_basis text not null check (division_basis in ('birth_year_band', 'school_level')),
  age_group text check (age_group is null or age_group in ('6U', '8U', '10U', '12U', '14U', '16U', '18U')),
  eligibility_birth_year_start smallint check (eligibility_birth_year_start is null or eligibility_birth_year_start between 1900 and 2100),
  eligibility_birth_year_end smallint check (eligibility_birth_year_end is null or eligibility_birth_year_end between 1900 and 2100),
  experience_division text check (experience_division is null or experience_division in ('open', 'rookie')),
  school_level text check (school_level is null or school_level in ('varsity', 'junior_varsity')),
  bracket_weight_label text not null check (char_length(bracket_weight_label) between 1 and 40),
  bracket_weight_lbs numeric(5,2) check (bracket_weight_lbs is null or (bracket_weight_lbs > 0 and bracket_weight_lbs <= 400)),
  weight_evidence_kind text not null default 'bracket_class' check (weight_evidence_kind = 'bracket_class'),
  placement smallint not null check (placement > 0),
  placement_verified boolean not null default true,
  identity_resolution text not null check (identity_resolution in ('exact_existing', 'new_identity', 'ambiguous', 'placeholder')),
  resolved_entry_id bigint references public.tournament_entries(id) on delete set null,
  source_filter_id text not null check (char_length(source_filter_id) between 1 and 80),
  source_placers_file text not null check (char_length(source_placers_file) between 1 and 240),
  source_weight_file text not null check (char_length(source_weight_file) between 1 and 240),
  source_zip_sha256 text not null check (source_zip_sha256 ~ '^[A-F0-9]{64}$'),
  extraction_method text not null default 'screenshot_and_live_table'
    check (extraction_method in ('screenshot_only', 'screenshot_and_live_table')),
  confidence text not null default 'confirmed' check (confidence in ('confirmed', 'derived')),
  notes text not null default '' check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_observations_dates check (event_end_date is null or event_end_date >= event_date),
  constraint tournament_observations_birth_years check (
    (eligibility_birth_year_start is null and eligibility_birth_year_end is null)
    or (
      eligibility_birth_year_start is not null
      and eligibility_birth_year_end is not null
      and eligibility_birth_year_start <= eligibility_birth_year_end
    )
  ),
  constraint tournament_observations_source_unique unique (
    source_filter_id, bracket_weight_label, placement, athlete_name
  )
);

comment on column public.tournament_observations.eligibility_birth_year_start is
  'Lower year in the division eligibility label; not an asserted wrestler birth year.';
comment on column public.tournament_observations.eligibility_birth_year_end is
  'Upper year in the division eligibility label; wrestlers may compete up.';
comment on column public.tournament_observations.bracket_weight_lbs is
  'Numeric bracket class label when present; never an asserted actual or entry weight.';
comment on column public.tournament_observations.placement_verified is
  'True only when the supplied placers screenshot explicitly shows the placement.';

alter table public.tournament_observations enable row level security;

revoke all on public.tournament_observations from public, authenticated;
grant select on public.tournament_observations to anon;
grant select, insert, update, delete on public.tournament_observations to service_role;
grant usage, select on sequence public.tournament_observations_id_seq to service_role;

create policy "Personal app can read tournament observations"
  on public.tournament_observations for select to anon
  using ((select private.personal_app_request_is_valid()));

create index tournament_observations_athlete_idx
  on public.tournament_observations (lower(athlete_name), event_date desc);

create index tournament_observations_cohort_idx
  on public.tournament_observations (age_group, bracket_weight_lbs, event_date desc)
  where age_group is not null and bracket_weight_lbs is not null;

create index tournament_observations_review_idx
  on public.tournament_observations (identity_resolution, event_date desc);

commit;
