begin;

create table public.wrestler_evidence (
  id bigint generated always as identity primary key,
  athlete_key text not null check (char_length(athlete_key) between 1 and 160),
  athlete_name text not null check (char_length(athlete_name) between 1 and 100),
  team text not null default '' check (char_length(team) <= 160),
  event_date date not null,
  event_name text not null check (char_length(event_name) between 1 and 160),
  city text not null default '' check (char_length(city) <= 100),
  state text not null default '' check (char_length(state) <= 10),
  evidence_type text not null check (evidence_type in ('confirmed_entry', 'inferred_identity', 'inferred_same_bout', 'inferred_same_bracket')),
  age_group text not null check (age_group in ('6U', '8U', '10U', '12U', '14U', '16U', '18U')),
  division_birth_year_start smallint not null check (division_birth_year_start between 1900 and 2100),
  division_birth_year_end smallint not null check (division_birth_year_end between 1900 and 2100),
  experience_division text check (experience_division is null or experience_division in ('open', 'rookie')),
  bracket_weight_lbs numeric(5,2) not null check (bracket_weight_lbs > 0 and bracket_weight_lbs <= 400),
  weight_basis text not null check (weight_basis in ('reported_bracket', 'match_class')),
  confidence_score smallint not null check (confidence_score between 0 and 100),
  confidence_label text not null check (confidence_label in ('confirmed', 'strong', 'moderate', 'limited')),
  anchor_athlete_name text check (anchor_athlete_name is null or char_length(anchor_athlete_name) between 1 and 100),
  source_entry_id bigint references public.tournament_entries(id) on delete cascade,
  source_match_id uuid references public.matches(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 500),
  source_key text not null unique check (char_length(source_key) between 1 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wrestler_evidence_birth_year_order check (division_birth_year_start <= division_birth_year_end)
);

alter table public.wrestler_evidence enable row level security;

revoke all on public.wrestler_evidence from public, authenticated;
grant select on public.wrestler_evidence to anon;
grant select, insert, update, delete on public.wrestler_evidence to service_role;
grant usage, select on sequence public.wrestler_evidence_id_seq to service_role;

create policy "Personal app can read wrestler evidence"
  on public.wrestler_evidence for select to anon
  using ((select private.personal_app_request_is_valid()));

create index wrestler_evidence_athlete_event_idx
  on public.wrestler_evidence (athlete_key, event_date desc, confidence_score desc);

create index wrestler_evidence_cohort_idx
  on public.wrestler_evidence (age_group, bracket_weight_lbs, event_date desc, confidence_score desc);

create index if not exists matches_winner_name_lower_idx
  on public.matches (lower(trim(winner_name)), event_date desc);

create index if not exists matches_loser_name_lower_idx
  on public.matches (lower(trim(loser_name)), event_date desc);

create or replace function private.refresh_wrestler_evidence()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.wrestler_evidence evidence
  where evidence.evidence_type = 'confirmed_entry'
    and not exists (
      select 1 from public.tournament_entries entry where entry.id = evidence.source_entry_id
    );

  insert into public.wrestler_evidence (
    athlete_key, athlete_name, team, event_date, event_name, city, state,
    evidence_type, age_group, division_birth_year_start, division_birth_year_end,
    experience_division, bracket_weight_lbs, weight_basis, confidence_score,
    confidence_label, anchor_athlete_name, source_entry_id, source_match_id, reason, source_key
  )
  select
    lower(trim(entry.athlete_name)), entry.athlete_name, entry.team, entry.event_date,
    entry.event_name, entry.city, entry.state, 'confirmed_entry', entry.age_group,
    entry.division_birth_year_start, entry.division_birth_year_end,
    entry.experience_division, entry.bracket_weight_lbs, 'reported_bracket', 100,
    'confirmed', entry.athlete_name, entry.id, null,
    'Confirmed division roster supplied for this tournament.',
    'confirmed-entry:' || entry.id::text
  from public.tournament_entries entry
  on conflict (source_key) do update set
    athlete_key = excluded.athlete_key,
    athlete_name = excluded.athlete_name,
    team = excluded.team,
    event_date = excluded.event_date,
    event_name = excluded.event_name,
    city = excluded.city,
    state = excluded.state,
    age_group = excluded.age_group,
    division_birth_year_start = excluded.division_birth_year_start,
    division_birth_year_end = excluded.division_birth_year_end,
    experience_division = excluded.experience_division,
    bracket_weight_lbs = excluded.bracket_weight_lbs,
    updated_at = now();

  delete from public.wrestler_evidence
  where evidence_type <> 'confirmed_entry';

  with recursive
  anchor_bands as (
    select
      lower(trim(entry.athlete_name)) as athlete_key,
      min(entry.athlete_name) as athlete_name,
      min(entry.id) as source_entry_id,
      min(entry.age_group) as age_group,
      min(entry.division_birth_year_start) as division_birth_year_start,
      min(entry.division_birth_year_end) as division_birth_year_end
    from public.tournament_entries entry
    group by lower(trim(entry.athlete_name))
    having count(distinct concat_ws(':', entry.age_group, entry.division_birth_year_start, entry.division_birth_year_end)) = 1
  ),
  match_rows as (
    select
      match.id as match_id,
      match.event_date,
      match.event_name,
      match.city,
      match.state,
      match.weight_class,
      nullif(substring(match.weight_class from '([0-9]+(?:\.[0-9]+)?)\D*$'), '')::numeric(5,2) as bracket_weight_lbs,
      lower(trim(match.winner_name)) as winner_key,
      match.winner_name,
      match.winner_team,
      lower(trim(match.loser_name)) as loser_key,
      match.loser_name,
      match.loser_team
    from public.matches match
    where match.event_date >= date '2026-07-01'
      and substring(match.weight_class from '([0-9]+(?:\.[0-9]+)?)\D*$') is not null
  ),
  edges as (
    select match_id, event_date, event_name, city, state, weight_class, bracket_weight_lbs,
      winner_key as from_key, winner_name as from_name, winner_team as from_team,
      loser_key as to_key, loser_name as to_name, loser_team as to_team
    from match_rows
    union all
    select match_id, event_date, event_name, city, state, weight_class, bracket_weight_lbs,
      loser_key, loser_name, loser_team, winner_key, winner_name, winner_team
    from match_rows
  ),
  walk as (
    select distinct
      edge.event_date, edge.event_name, edge.city, edge.state, edge.weight_class,
      edge.bracket_weight_lbs, anchor.athlete_key as participant_key,
      edge.from_name as participant_name, edge.from_team as participant_team,
      anchor.athlete_key as anchor_key, anchor.athlete_name as anchor_name,
      anchor.source_entry_id, anchor.age_group, anchor.division_birth_year_start,
      anchor.division_birth_year_end, 0 as depth, null::uuid as first_match_id,
      array[anchor.athlete_key]::text[] as visited
    from anchor_bands anchor
    join edges edge on edge.from_key = anchor.athlete_key

    union all

    select
      walk.event_date, walk.event_name, edge.city, edge.state, walk.weight_class,
      walk.bracket_weight_lbs, edge.to_key, edge.to_name, edge.to_team,
      walk.anchor_key, walk.anchor_name, walk.source_entry_id, walk.age_group,
      walk.division_birth_year_start, walk.division_birth_year_end,
      walk.depth + 1, coalesce(walk.first_match_id, edge.match_id),
      walk.visited || edge.to_key
    from walk
    join edges edge
      on edge.event_date = walk.event_date
      and edge.event_name = walk.event_name
      and edge.weight_class = walk.weight_class
      and edge.from_key = walk.participant_key
    where walk.depth < 16
      and not edge.to_key = any(walk.visited)
  ),
  resolved as (
    select
      walk.event_date, walk.event_name, min(walk.city) as city, min(walk.state) as state,
      walk.weight_class, walk.bracket_weight_lbs, walk.participant_key,
      min(walk.participant_name) as participant_name,
      min(walk.participant_team) as participant_team,
      min(walk.age_group) as age_group,
      min(walk.division_birth_year_start) as division_birth_year_start,
      min(walk.division_birth_year_end) as division_birth_year_end,
      min(walk.depth) as min_depth,
      count(distinct walk.anchor_key) as anchor_count,
      min(walk.anchor_name) as anchor_name,
      min(walk.source_entry_id) as source_entry_id,
      (array_agg(walk.first_match_id order by walk.depth) filter (where walk.first_match_id is not null))[1] as source_match_id
    from walk
    group by walk.event_date, walk.event_name, walk.weight_class,
      walk.bracket_weight_lbs, walk.participant_key
    having count(distinct concat_ws(':', walk.age_group, walk.division_birth_year_start, walk.division_birth_year_end)) = 1
  )
  insert into public.wrestler_evidence (
    athlete_key, athlete_name, team, event_date, event_name, city, state,
    evidence_type, age_group, division_birth_year_start, division_birth_year_end,
    experience_division, bracket_weight_lbs, weight_basis, confidence_score,
    confidence_label, anchor_athlete_name, source_entry_id, source_match_id, reason, source_key
  )
  select
    resolved.participant_key, resolved.participant_name, resolved.participant_team,
    resolved.event_date, resolved.event_name, resolved.city, resolved.state,
    case
      when resolved.min_depth = 0 then 'inferred_identity'
      when resolved.min_depth = 1 then 'inferred_same_bout'
      else 'inferred_same_bracket'
    end,
    resolved.age_group, resolved.division_birth_year_start, resolved.division_birth_year_end,
    null, resolved.bracket_weight_lbs, 'match_class',
    case
      when resolved.min_depth = 0 then 96
      when resolved.anchor_count >= 2 then 94
      when resolved.min_depth = 1 then 90
      else 82
    end,
    case when resolved.min_depth <= 1 or resolved.anchor_count >= 2 then 'strong' else 'moderate' end,
    resolved.anchor_name, resolved.source_entry_id, resolved.source_match_id,
    case
      when resolved.min_depth = 0 then 'Same identified wrestler as a confirmed current-season division entry.'
      when resolved.anchor_count >= 2 then 'Current-season bracket connection supported by multiple confirmed division anchors.'
      when resolved.min_depth = 1 then 'Direct current-season bout against a confirmed division anchor.'
      else 'Connected current-season bracket path to a confirmed division anchor.'
    end,
    concat_ws(':', 'inferred', resolved.event_date, md5(resolved.event_name),
      md5(resolved.weight_class), md5(resolved.participant_key), resolved.age_group)
  from resolved
  where not exists (
    select 1
    from public.wrestler_evidence confirmed
    where confirmed.evidence_type = 'confirmed_entry'
      and confirmed.athlete_key = resolved.participant_key
      and confirmed.event_date = resolved.event_date
      and confirmed.age_group = resolved.age_group
      and confirmed.bracket_weight_lbs = resolved.bracket_weight_lbs
  )
  on conflict (source_key) do nothing;
end;
$$;

revoke all on function private.refresh_wrestler_evidence() from public, anon, authenticated;
grant execute on function private.refresh_wrestler_evidence() to service_role;

select private.refresh_wrestler_evidence();

create view public.wrestler_ratings
with (security_invoker = true)
as
with
match_lines as (
  select lower(trim(winner_name)) as athlete_key, winner_name as athlete_name,
    winner_team as team, event_date, 1 as win, 0 as loss,
    case when lower(trim(win_type)) ~ '^(f|fall|pin|tf|tech|tech fall|technical fall|md|major decision)$' then 1 else 0 end as decisive_win
  from public.matches
  union all
  select lower(trim(loser_name)), loser_name, loser_team, event_date, 0, 1, 0
  from public.matches
),
match_stats as (
  select athlete_key, min(athlete_name) as athlete_name,
    (array_agg(team order by event_date desc) filter (where team <> ''))[1] as latest_team,
    sum(win)::integer as wins, sum(loss)::integer as losses,
    sum(decisive_win)::integer as decisive_wins, max(event_date) as latest_match_date
  from match_lines
  group by athlete_key
),
placement_stats as (
  select lower(trim(athlete_name)) as athlete_key, min(placement)::integer as best_placement
  from public.tournament_entries
  where placement is not null
  group by lower(trim(athlete_name))
),
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
raw_scores as (
  select
    evidence.athlete_key,
    coalesce(evidence.athlete_name, stats.athlete_name) as athlete_name,
    coalesce(nullif(evidence.team, ''), stats.latest_team, '') as team,
    evidence.age_group, evidence.division_birth_year_start, evidence.division_birth_year_end,
    evidence.weight_bucket, evidence.bracket_weight_lbs, evidence.evidence_date,
    evidence.confidence_score, evidence.confidence_label, evidence.evidence_type,
    stats.wins, stats.losses, stats.decisive_wins, stats.latest_match_date,
    placement.best_placement,
    round(
      (stats.wins::numeric / nullif(stats.wins + stats.losses, 0)) * 500
      + case when placement.best_placement is null then 0 else greatest(0, 1 - (placement.best_placement - 1)::numeric / 7) * 200 end
      + case when stats.wins = 0 then 0 else stats.decisive_wins::numeric / stats.wins * 100 end
      + greatest(0, 1 - (current_date - stats.latest_match_date)::numeric / 730) * 100
      + least(1, (stats.wins + stats.losses)::numeric / 20) * 100,
      6
    ) as raw_strength
  from cohort_evidence evidence
  join match_stats stats on stats.athlete_key = evidence.athlete_key
  left join placement_stats placement on placement.athlete_key = evidence.athlete_key
  where stats.wins + stats.losses > 0
),
normalized as (
  select raw_scores.*,
    min(raw_strength) over (partition by age_group, weight_bucket) as cohort_min,
    max(raw_strength) over (partition by age_group, weight_bucket) as cohort_max,
    count(*) over (partition by age_group, weight_bucket)::integer as cohort_size,
    rank() over (partition by age_group, weight_bucket order by raw_strength desc)::integer as cohort_rank
  from raw_scores
)
select
  athlete_key, athlete_name, team, age_group, division_birth_year_start,
  division_birth_year_end, weight_bucket, weight_bucket || '–' || (weight_bucket + 9) || ' lb' as weight_band,
  bracket_weight_lbs, evidence_date, confidence_score, confidence_label, evidence_type,
  wins, losses, decisive_wins, latest_match_date, best_placement, raw_strength,
  case
    when cohort_max = cohort_min then 1000.00
    else round((raw_strength - cohort_min) / nullif(cohort_max - cohort_min, 0) * 1000, 2)
  end as strength_score,
  cohort_rank, cohort_size
from normalized;

revoke all on public.wrestler_ratings from public, authenticated;
grant select on public.wrestler_ratings to anon, service_role;

commit;
