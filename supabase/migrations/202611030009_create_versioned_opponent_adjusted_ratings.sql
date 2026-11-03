begin;

-- ---------------------------------------------------------------------------------------------
-- Versioned, opponent-adjusted (Glicko-2) ratings.
--
-- Raw matches, evidence tables and the legacy public.wrestler_ratings view are NOT modified.
-- A calculation run writes one rating_models row plus its wrestler_model_ratings and
-- wrestler_rating_history rows. Older models are never overwritten; exactly one model may be
-- 'active' and it feeds the new views below. With no active model the application keeps using
-- the legacy view.
-- ---------------------------------------------------------------------------------------------

create table public.rating_models (
  id uuid primary key default gen_random_uuid(),
  model_version text not null check (char_length(model_version) between 1 and 80),
  label text not null default '' check (char_length(label) <= 200),
  status text not null default 'building' check (status in ('building', 'candidate', 'active', 'archived')),
  config jsonb not null,
  config_hash text not null check (char_length(config_hash) = 64),
  input_fingerprint text not null check (char_length(input_fingerprint) = 64),
  code_version text not null default '' check (char_length(code_version) <= 80),
  calculated_at timestamptz not null default now(),
  as_of_date date not null,
  match_cutoff date,
  first_match_date date,
  rating_period_policy text not null check (char_length(rating_period_policy) between 1 and 40),
  rating_period_days smallint not null check (rating_period_days between 1 and 120),
  uncertainty_k numeric(6, 3) not null check (uncertainty_k >= 0),
  provisional_rd numeric(6, 2) not null check (provisional_rd > 0),
  established_rd numeric(6, 2) not null check (established_rd > 0),
  recency_policy text not null check (char_length(recency_policy) between 1 and 80),
  dominance_enabled boolean not null default false,
  matches_total integer not null default 0 check (matches_total >= 0),
  matches_rated integer not null default 0 check (matches_rated >= 0),
  matches_excluded jsonb not null default '{}'::jsonb,
  wrestlers_rated integer not null default 0 check (wrestlers_rated >= 0),
  quality_threshold numeric(8, 2),
  backtest_metrics jsonb,
  notes text not null default '' check (char_length(notes) <= 1000),
  created_at timestamptz not null default now()
);

comment on table public.rating_models is
  'One row per calculated rating model run. Immutable results; recalculation creates a new row. Exactly one row may be active.';
comment on column public.rating_models.config is
  'Complete rating configuration used for the run (see src/lib/rating/config.ts).';
comment on column public.rating_models.input_fingerprint is
  'SHA-256 over the sorted match ids/outcomes and alias table used, so identical inputs are recognised.';
comment on column public.rating_models.match_cutoff is
  'Latest match date included in the calculation.';
comment on column public.rating_models.as_of_date is
  'Date that inactivity-driven uncertainty growth was applied through.';
comment on column public.rating_models.uncertainty_k is
  'Conservative score = rating - k * rating_deviation.';
comment on column public.rating_models.backtest_metrics is
  'Summary of the chronological backtest associated with this configuration, if one was run.';

create unique index rating_models_one_active_idx
  on public.rating_models ((true))
  where status = 'active';

create unique index rating_models_identical_run_idx
  on public.rating_models (config_hash, input_fingerprint, as_of_date, coalesce(match_cutoff, date '1900-01-01'));

create index rating_models_status_idx
  on public.rating_models (status, calculated_at desc);

create table public.wrestler_model_ratings (
  model_id uuid not null references public.rating_models(id) on delete cascade,
  athlete_key text not null check (char_length(athlete_key) between 1 and 160),
  athlete_name text not null check (char_length(athlete_name) between 1 and 100),
  team text not null default '' check (char_length(team) <= 160),
  rating numeric(8, 3) not null,
  rating_deviation numeric(8, 3) not null check (rating_deviation > 0),
  volatility numeric(8, 6) not null check (volatility > 0),
  conservative_score numeric(8, 3) not null,
  rating_status text not null check (rating_status in ('provisional', 'developing', 'established')),
  match_count integer not null check (match_count > 0),
  wins integer not null check (wins >= 0),
  losses integer not null check (losses >= 0),
  first_match_date date not null,
  last_match_date date not null,
  pin_pct numeric(6, 5) check (pin_pct is null or pin_pct between 0 and 1),
  bonus_pct numeric(6, 5) check (bonus_pct is null or bonus_pct between 0 and 1),
  win_methods jsonb not null default '{}'::jsonb,
  loss_methods jsonb not null default '{}'::jsonb,
  avg_win_margin numeric(6, 2),
  avg_loss_margin numeric(6, 2),
  margin_samples integer not null default 0,
  avg_opponent_rating numeric(8, 2),
  sos_expected_win_pct numeric(6, 5) check (sos_expected_win_pct is null or sos_expected_win_pct between 0 and 1),
  quality_wins integer not null default 0,
  quality_losses integer not null default 0,
  rating_trend numeric(8, 2),
  primary key (model_id, athlete_key),
  constraint wrestler_model_ratings_record check (wins + losses = match_count)
);

comment on column public.wrestler_model_ratings.avg_opponent_rating is
  'Explanatory only: mean of opponents'' CURRENT ratings. Never used to compute any rating.';
comment on column public.wrestler_model_ratings.sos_expected_win_pct is
  'Expected win rate of a reference-rated wrestler against this wrestler''s actual opponents (lower = harder schedule). Explanatory only.';

create index wrestler_model_ratings_athlete_idx
  on public.wrestler_model_ratings (athlete_key);

create table public.wrestler_rating_history (
  model_id uuid not null references public.rating_models(id) on delete cascade,
  athlete_key text not null check (char_length(athlete_key) between 1 and 160),
  period_end date not null,
  rating numeric(8, 3) not null,
  rating_deviation numeric(8, 3) not null,
  volatility numeric(8, 6) not null,
  match_count integer not null,
  primary key (model_id, athlete_key, period_end)
);

comment on table public.wrestler_rating_history is
  'Rating after each rating period in which the wrestler competed. Used for trends and audits.';

create table public.rating_backtest_runs (
  id uuid primary key default gen_random_uuid(),
  model_id uuid references public.rating_models(id) on delete set null,
  config_hash text not null check (char_length(config_hash) = 64),
  ran_at timestamptz not null default now(),
  scope text not null check (scope in ('tuning', 'confirmation', 'full')),
  evaluate_from date,
  evaluate_until date,
  metrics jsonb not null,
  notes text not null default '' check (char_length(notes) <= 1000)
);

create index rating_backtest_runs_model_idx
  on public.rating_backtest_runs (model_id, ran_at desc);

-- Row-level security: same personal-app model as every other table in this project.
alter table public.rating_models enable row level security;
alter table public.wrestler_model_ratings enable row level security;
alter table public.wrestler_rating_history enable row level security;
alter table public.rating_backtest_runs enable row level security;

revoke all on public.rating_models, public.wrestler_model_ratings, public.wrestler_rating_history, public.rating_backtest_runs from public, authenticated;
grant select on public.rating_models, public.wrestler_model_ratings, public.wrestler_rating_history, public.rating_backtest_runs to anon;
grant select, insert, update, delete on public.rating_models, public.wrestler_model_ratings, public.wrestler_rating_history, public.rating_backtest_runs to service_role;

create policy "Personal app can read rating models"
  on public.rating_models for select to anon
  using ((select private.personal_app_request_is_valid()));

create policy "Personal app can read model ratings"
  on public.wrestler_model_ratings for select to anon
  using ((select private.personal_app_request_is_valid()));

create policy "Personal app can read rating history"
  on public.wrestler_rating_history for select to anon
  using ((select private.personal_app_request_is_valid()));

create policy "Personal app can read backtest runs"
  on public.rating_backtest_runs for select to anon
  using ((select private.personal_app_request_is_valid()));

-- Atomic activation for use from the SQL editor or migrations. The calculation script performs the
-- same two steps with table updates because the private schema is not exposed over the REST API.
create or replace function private.activate_rating_model(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.rating_models where id = target and status in ('candidate', 'active', 'archived')
  ) then
    raise exception 'Rating model % does not exist or has not finished building', target;
  end if;

  update public.rating_models set status = 'archived' where status = 'active' and id <> target;
  update public.rating_models set status = 'active' where id = target;
end;
$$;

revoke all on function private.activate_rating_model(uuid) from public, anon, authenticated;
grant execute on function private.activate_rating_model(uuid) to service_role;

-- Current ratings from the active model, one row per wrestler.
create view public.wrestler_rating_current
with (security_invoker = true)
as
select
  model.id as model_id,
  model.model_version,
  model.as_of_date,
  model.uncertainty_k,
  model.calculated_at,
  rating.athlete_key,
  rating.athlete_name,
  rating.team,
  rating.rating,
  rating.rating_deviation,
  rating.volatility,
  rating.conservative_score,
  rating.rating_status,
  rating.match_count,
  rating.wins,
  rating.losses,
  rating.first_match_date,
  rating.last_match_date,
  rating.pin_pct,
  rating.bonus_pct,
  rating.win_methods,
  rating.loss_methods,
  rating.avg_win_margin,
  rating.avg_loss_margin,
  rating.margin_samples,
  rating.avg_opponent_rating,
  rating.sos_expected_win_pct,
  rating.quality_wins,
  rating.quality_losses,
  rating.rating_trend
from public.rating_models model
join public.wrestler_model_ratings rating on rating.model_id = model.id
where model.status = 'active';

-- Age/weight cohort leaderboard from the active model. Mirrors the legacy view's cohort rules
-- (latest evidence per wrestler, age group and 10 lb band) but ranks by the conservative score and
-- keeps the familiar 0-1000 display: weakest conservative score in the cohort = 0, strongest = 1000.
create view public.wrestler_strength_current
with (security_invoker = true)
as
with
cohort_evidence as (
  select distinct on (evidence.athlete_key, evidence.age_group, floor(evidence.bracket_weight_lbs / 10))
    evidence.athlete_key, evidence.athlete_name, evidence.team, evidence.age_group,
    evidence.division_birth_year_start, evidence.division_birth_year_end,
    floor(evidence.bracket_weight_lbs / 10)::integer * 10 as weight_bucket,
    evidence.bracket_weight_lbs, evidence.event_date as evidence_date,
    evidence.confidence_score, evidence.confidence_label, evidence.evidence_type
  from public.wrestler_evidence evidence
  order by evidence.athlete_key, evidence.age_group, floor(evidence.bracket_weight_lbs / 10),
    evidence.event_date desc, evidence.confidence_score desc, evidence.id desc
),
joined as (
  select
    evidence.athlete_key,
    coalesce(evidence.athlete_name, current_rating.athlete_name) as athlete_name,
    coalesce(nullif(evidence.team, ''), current_rating.team, '') as team,
    evidence.age_group, evidence.division_birth_year_start, evidence.division_birth_year_end,
    evidence.weight_bucket, evidence.bracket_weight_lbs, evidence.evidence_date,
    evidence.confidence_score, evidence.confidence_label, evidence.evidence_type,
    current_rating.model_id, current_rating.model_version, current_rating.as_of_date,
    current_rating.rating, current_rating.rating_deviation, current_rating.volatility,
    current_rating.conservative_score, current_rating.rating_status,
    current_rating.match_count, current_rating.wins, current_rating.losses,
    current_rating.last_match_date
  from cohort_evidence evidence
  join public.wrestler_rating_current current_rating on current_rating.athlete_key = evidence.athlete_key
),
normalized as (
  select joined.*,
    min(conservative_score) over (partition by age_group, weight_bucket) as cohort_min,
    max(conservative_score) over (partition by age_group, weight_bucket) as cohort_max,
    count(*) over (partition by age_group, weight_bucket)::integer as cohort_size,
    rank() over (partition by age_group, weight_bucket order by conservative_score desc)::integer as cohort_rank
  from joined
)
select
  athlete_key, athlete_name, team, age_group, division_birth_year_start, division_birth_year_end,
  weight_bucket, weight_bucket || '–' || (weight_bucket + 9) || ' lb' as weight_band,
  bracket_weight_lbs, evidence_date, confidence_score, confidence_label, evidence_type,
  model_id, model_version, as_of_date,
  rating, rating_deviation, volatility, conservative_score, rating_status,
  match_count, wins, losses, last_match_date,
  case
    when cohort_max = cohort_min then 1000.00
    else round((conservative_score - cohort_min) / nullif(cohort_max - cohort_min, 0) * 1000, 2)
  end as strength_score,
  cohort_rank, cohort_size
from normalized;

revoke all on public.wrestler_rating_current, public.wrestler_strength_current from public, authenticated;
grant select on public.wrestler_rating_current, public.wrestler_strength_current to anon, service_role;

commit;
