-- Versioned read snapshot for the expensive public reads (Rankings pool/standings, profile
-- classification, club directory/summaries/rosters).
--
-- Why: on the Supabase Free plan the live functions recompute full-population classification
-- and club aggregates on every request; under burstable-CPU starvation they intermittently exceed
-- the unchanged three-second anon statement_timeout. Their inputs change only when source data or
-- the active rating model changes.
--
-- How (exact, never stale):
--  * private.read_source_version is a single counter. Statement-level triggers on EVERY input
--    relation of these reads bump it in the writing transaction.
--  * private.build_read_snapshot() (administrator only) locks the counter row, then stores the
--    exact output of the existing (renamed private.live_*) functions, tagged with that counter
--    value and the active model. Writers block on the counter row until the build commits, so a
--    build can never mix source versions.
--  * Each public function serves the snapshot only when the stored version equals the current
--    counter AND the stored model is the active person model; otherwise it calls the unchanged live
--    function. A stale snapshot is therefore never served; it only stops being used.
-- No formula, raw bout, assignment, rating row, RLS rule, grant to other roles or timeout changes.

-- 1. Source version counter and bump triggers -------------------------------------------------
create table private.read_source_version (
  singleton boolean primary key default true check (singleton),
  version bigint not null default 0
);
insert into private.read_source_version(singleton, version) values (true, 0);
alter table private.read_source_version enable row level security;
create policy personal_app_read_source_version on private.read_source_version
  for select to anon using ((select private.personal_app_request_is_valid()));
revoke all on private.read_source_version from public, anon, authenticated, service_role;
grant select on private.read_source_version to anon;

create function private.bump_read_source_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update private.read_source_version set version = version + 1 where singleton;
  return null;
end $$;
revoke all on function private.bump_read_source_version() from public, anon, authenticated, service_role;

do $triggers$
declare rel text;
begin
  -- Every relation read (directly or through views) by the snapshot-served functions.
  foreach rel in array array[
    'public.matches', 'public.source_identity_current_rows', 'public.tournament_entries',
    'public.tournament_observations', 'public.wrestler_evidence', 'public.wrestler_people',
    'public.wrestler_aliases', 'public.club_aliases', 'public.rating_models',
    'public.wrestler_model_ratings', 'private.match_cohort_appearances', 'private.club_person_source_counts'
  ] loop
    execute format('create trigger bump_read_source_version after insert or update or delete or truncate on %s
      for each statement execute function private.bump_read_source_version()', rel);
  end loop;
end $triggers$;

-- 2. Keep the existing implementations as private live functions -------------------------------
alter function public.current_person_cohort_strength(integer) set schema private;
alter function private.current_person_cohort_strength(integer) rename to live_current_person_cohort_strength;
alter function public.current_person_strength(integer) set schema private;
alter function private.current_person_strength(integer) rename to live_current_person_strength;
alter function public.person_cohorts_by_ids(uuid[]) set schema private;
alter function private.person_cohorts_by_ids(uuid[]) rename to live_person_cohorts_by_ids;
alter function public.person_club_directory(text, text) set schema private;
alter function private.person_club_directory(text, text) rename to live_person_club_directory;
alter function public.person_club_rankings_for_season(text, text) set schema private;
alter function private.person_club_rankings_for_season(text, text) rename to live_person_club_rankings_for_season;
alter function public.person_club_rankings_for_keys(text, text[]) set schema private;
alter function private.person_club_rankings_for_keys(text, text[]) rename to live_person_club_rankings_for_keys;
alter function public.person_club_roster_for_season(text, text) set schema private;
alter function private.person_club_roster_for_season(text, text) rename to live_person_club_roster_for_season;

-- 3. Snapshot storage (exact output columns of the live functions) -----------------------------
create table private.read_snapshot (
  singleton boolean primary key default true check (singleton),
  source_version bigint not null,
  model_id uuid not null,
  ages integer[] not null,
  seasons text[] not null,
  built_at timestamptz not null default now(),
  row_counts jsonb not null
);
create table private.snap_person_pool (
  snap_age integer not null, athlete_key text, athlete_name text, team text, evidence_date date, age_group text,
  bracket_weight_lbs numeric, weight_bucket integer, division_birth_year_start smallint, division_birth_year_end smallint,
  confidence_score smallint, confidence_label text, evidence_type text, tier_eligible boolean,
  strength_rated boolean, strength_weight_band text, strength_bracket_weight_lbs numeric, strength_score numeric,
  cohort_rank integer, cohort_size integer, cohort_tier integer, tier_unavailable_reason text
);
create index snap_person_pool_age_idx on private.snap_person_pool(snap_age);
create table private.snap_person_strength (
  snap_age integer not null, athlete_key text, athlete_name text, team text, age_group text,
  division_birth_year_start smallint, division_birth_year_end smallint, weight_bucket integer, weight_band text,
  bracket_weight_lbs numeric, evidence_date date, confidence_score smallint, confidence_label text, evidence_type text,
  model_id uuid, model_version text, as_of_date date, rating numeric, rating_deviation numeric, volatility numeric,
  conservative_score numeric, rating_status text, match_count integer, wins integer, losses integer, last_match_date date,
  strength_score numeric, cohort_rank integer, cohort_size integer, cohort_tier integer, tier_unavailable_reason text
);
create index snap_person_strength_age_key_idx on private.snap_person_strength(snap_age, athlete_key);
create table private.snap_person_cohorts (
  athlete_key text, athlete_name text, team text, evidence_date date, age_group text, bracket_weight_lbs numeric,
  weight_bucket integer, division_birth_year_start smallint, division_birth_year_end smallint, confidence_score smallint,
  confidence_label text, evidence_type text, tier_eligible boolean
);
create index snap_person_cohorts_key_idx on private.snap_person_cohorts(athlete_key);
create table private.snap_club_directory (
  snap_season text not null, snap_sort text not null,
  club_key text, club_name text, bouts integer, wrestlers integer, sort_value numeric
);
create index snap_club_directory_idx on private.snap_club_directory(snap_season, snap_sort);
create table private.snap_club_summaries (like public.person_club_rankings_current);
create index snap_club_summaries_idx on private.snap_club_summaries(season, club_key);
create table private.snap_club_roster (like public.person_club_roster_current);
create index snap_club_roster_idx on private.snap_club_roster(season, club_key);

do $rls$
declare rel text;
begin
  foreach rel in array array['read_snapshot','snap_person_pool','snap_person_strength','snap_person_cohorts',
    'snap_club_directory','snap_club_summaries','snap_club_roster'] loop
    execute format('alter table private.%I enable row level security', rel);
    execute format('create policy personal_app_read on private.%I for select to anon
      using ((select private.personal_app_request_is_valid()))', rel);
    execute format('revoke all on private.%I from public, anon, authenticated, service_role', rel);
    execute format('grant select on private.%I to anon', rel);
  end loop;
end $rls$;

-- 4. Validity: the snapshot matches the current source version and the active person model ------
create function private.read_snapshot_valid() returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from private.read_snapshot s
    join private.read_source_version v on v.singleton and v.version = s.source_version
    join public.rating_models m on m.id = s.model_id and m.status = 'active' and m.identity_scheme = 'person_uuid'
    where s.singleton)
$$;
revoke all on function private.read_snapshot_valid() from public, anon, authenticated, service_role;
grant execute on function private.read_snapshot_valid() to anon;

-- 5. Public functions: same signatures/results; snapshot when valid, live otherwise ------------
create function public.current_person_cohort_strength(target_age integer)
returns table (athlete_key text,athlete_name text,team text,evidence_date date,age_group text,bracket_weight_lbs numeric,weight_bucket integer,division_birth_year_start smallint,division_birth_year_end smallint,confidence_score smallint,confidence_label text,evidence_type text,tier_eligible boolean,
 strength_rated boolean,strength_weight_band text,strength_bracket_weight_lbs numeric,strength_score numeric,cohort_rank integer,cohort_size integer,cohort_tier integer,tier_unavailable_reason text)
language plpgsql stable security invoker set search_path = '' as $f$
begin
  if target_age is not null and private.read_snapshot_valid()
     and target_age = any((select s.ages from private.read_snapshot s where s.singleton)) then
    return query select p.athlete_key,p.athlete_name,p.team,p.evidence_date,p.age_group,p.bracket_weight_lbs,p.weight_bucket,
      p.division_birth_year_start,p.division_birth_year_end,p.confidence_score,p.confidence_label,p.evidence_type,p.tier_eligible,
      p.strength_rated,p.strength_weight_band,p.strength_bracket_weight_lbs,p.strength_score,p.cohort_rank,p.cohort_size,p.cohort_tier,p.tier_unavailable_reason
      from private.snap_person_pool p where p.snap_age = target_age;
  else
    return query select * from private.live_current_person_cohort_strength(target_age);
  end if;
end $f$;

create function public.current_person_strength(target_age integer default null)
returns table (athlete_key text,athlete_name text,team text,age_group text,division_birth_year_start smallint,division_birth_year_end smallint,weight_bucket integer,weight_band text,bracket_weight_lbs numeric,evidence_date date,confidence_score smallint,confidence_label text,evidence_type text,model_id uuid,model_version text,as_of_date date,rating numeric,rating_deviation numeric,volatility numeric,conservative_score numeric,rating_status text,match_count integer,wins integer,losses integer,last_match_date date,strength_score numeric,cohort_rank integer,cohort_size integer,cohort_tier integer,tier_unavailable_reason text)
language plpgsql stable security invoker set search_path = '' as $f$
begin
  if target_age is not null and private.read_snapshot_valid()
     and target_age = any((select s.ages from private.read_snapshot s where s.singleton)) then
    return query select s.athlete_key,s.athlete_name,s.team,s.age_group,s.division_birth_year_start,s.division_birth_year_end,s.weight_bucket,
      s.weight_band,s.bracket_weight_lbs,s.evidence_date,s.confidence_score,s.confidence_label,s.evidence_type,s.model_id,s.model_version,
      s.as_of_date,s.rating,s.rating_deviation,s.volatility,s.conservative_score,s.rating_status,s.match_count,s.wins,s.losses,
      s.last_match_date,s.strength_score,s.cohort_rank,s.cohort_size,s.cohort_tier,s.tier_unavailable_reason
      from private.snap_person_strength s where s.snap_age = target_age;
  else
    return query select * from private.live_current_person_strength(target_age);
  end if;
end $f$;

create function public.person_cohorts_by_ids(person_ids uuid[])
returns table (athlete_key text, athlete_name text, team text, evidence_date date, age_group text, bracket_weight_lbs numeric, weight_bucket integer, division_birth_year_start smallint, division_birth_year_end smallint, confidence_score smallint, confidence_label text, evidence_type text, tier_eligible boolean)
language plpgsql stable security invoker set search_path = '' as $f$
begin
  if private.read_snapshot_valid() then
    return query select c.* from private.snap_person_cohorts c
      where c.athlete_key in (select distinct k::text from unnest(coalesce(person_ids, array[]::uuid[])) k);
  else
    return query select * from private.live_person_cohorts_by_ids(person_ids);
  end if;
end $f$;

create function public.person_club_directory(target_season text, target_sort text)
returns table (club_key text, club_name text, bouts integer, wrestlers integer, sort_value numeric)
language plpgsql stable security invoker set search_path = '' as $f$
begin
  if private.read_snapshot_valid() and target_season = any((select s.seasons from private.read_snapshot s where s.singleton))
     and target_sort in ('wrestlers','bouts','avg_conservative','median_conservative','top_five_conservative','avg_opponent_rating') then
    return query select d.club_key,d.club_name,d.bouts,d.wrestlers,d.sort_value from private.snap_club_directory d
      where d.snap_season = target_season and d.snap_sort = target_sort;
  else
    return query select * from private.live_person_club_directory(target_season, target_sort);
  end if;
end $f$;

create function public.person_club_rankings_for_season(target_season text, target_club text default null)
returns setof public.person_club_rankings_current
language plpgsql stable security invoker set search_path = '' as $f$
begin
  if private.read_snapshot_valid() and target_season = any((select s.seasons from private.read_snapshot s where s.singleton)) then
    return query select c.* from private.snap_club_summaries c
      where c.season = target_season and (target_club is null or c.club_key = target_club);
  else
    return query select * from private.live_person_club_rankings_for_season(target_season, target_club);
  end if;
end $f$;

create function public.person_club_rankings_for_keys(target_season text, target_keys text[])
returns setof public.person_club_rankings_current
language plpgsql stable security invoker set search_path = '' as $f$
begin
  if private.read_snapshot_valid() and target_season = any((select s.seasons from private.read_snapshot s where s.singleton)) then
    return query select c.* from private.snap_club_summaries c
      where c.season = target_season and c.club_key = any(coalesce(target_keys, array[]::text[]));
  else
    return query select * from private.live_person_club_rankings_for_keys(target_season, target_keys);
  end if;
end $f$;

create function public.person_club_roster_for_season(target_season text, target_club text default null)
returns setof public.person_club_roster_current
language plpgsql stable security invoker set search_path = '' as $f$
begin
  if private.read_snapshot_valid() and target_season = any((select s.seasons from private.read_snapshot s where s.singleton)) then
    return query select r.* from private.snap_club_roster r
      where r.season = target_season and (target_club is null or r.club_key = target_club);
  else
    return query select * from private.live_person_club_roster_for_season(target_season, target_club);
  end if;
end $f$;

revoke all on function public.current_person_cohort_strength(integer), public.current_person_strength(integer),
  public.person_cohorts_by_ids(uuid[]), public.person_club_directory(text,text),
  public.person_club_rankings_for_season(text,text), public.person_club_rankings_for_keys(text,text[]),
  public.person_club_roster_for_season(text,text) from public, anon, authenticated, service_role;
grant execute on function public.current_person_cohort_strength(integer), public.current_person_strength(integer),
  public.person_cohorts_by_ids(uuid[]), public.person_club_directory(text,text),
  public.person_club_rankings_for_season(text,text), public.person_club_rankings_for_keys(text,text[]),
  public.person_club_roster_for_season(text,text) to anon;
grant execute on function public.current_person_strength(integer) to service_role;

-- 6. Administrator build ----------------------------------------------------------------------
create function private.build_read_snapshot() returns jsonb
language plpgsql security invoker set search_path = '' as $f$
declare
  v bigint;
  m uuid;
  age_list integer[];
  season_list text[];
  counts jsonb;
  a integer;
  s text;
  sort_key text;
begin
  -- Lock the counter: every source writer must update it, so no write can commit mid-build.
  select r.version into v from private.read_source_version r where r.singleton for update;
  select id into m from public.rating_models where status = 'active' and identity_scheme = 'person_uuid';
  delete from private.read_snapshot;
  delete from private.snap_person_pool; delete from private.snap_person_strength; delete from private.snap_person_cohorts;
  delete from private.snap_club_directory; delete from private.snap_club_summaries; delete from private.snap_club_roster;
  if m is null then
    return jsonb_build_object('built', false, 'reason', 'no active person model');
  end if;

  select coalesce(array_agg(distinct x order by x), array[]::integer[]) into age_list from (
    select nullif(regexp_replace(coalesce(p.age_group,''),'[^0-9]','','g'),'')::integer x from private.match_cohort_appearances p
    union select i.age_value::integer from private.person_cohort_inputs i
  ) ages where x is not null and x between 1 and 99;
  select array['ALL'] || coalesce(array_agg(distinct c.season order by c.season), array[]::text[])
    into season_list from private.club_person_source_counts c where c.season is not null and c.season <> 'ALL';

  foreach a in array age_list loop
    insert into private.snap_person_pool select a, l.* from private.live_current_person_cohort_strength(a) l;
    insert into private.snap_person_strength select a, l.* from private.live_current_person_strength(a) l;
  end loop;
  insert into private.snap_person_cohorts select * from private.calculate_person_cohorts(null, null);
  foreach s in array season_list loop
    foreach sort_key in array array['wrestlers','bouts','avg_conservative','median_conservative','top_five_conservative','avg_opponent_rating'] loop
      insert into private.snap_club_directory select s, sort_key, d.* from private.live_person_club_directory(s, sort_key) d;
    end loop;
    insert into private.snap_club_summaries select * from private.live_person_club_rankings_for_season(s, null);
    insert into private.snap_club_roster select * from private.live_person_club_roster_for_season(s, null);
  end loop;

  counts := jsonb_build_object(
    'person_pool', (select count(*) from private.snap_person_pool),
    'person_strength', (select count(*) from private.snap_person_strength),
    'person_cohorts', (select count(*) from private.snap_person_cohorts),
    'club_directory', (select count(*) from private.snap_club_directory),
    'club_summaries', (select count(*) from private.snap_club_summaries),
    'club_roster', (select count(*) from private.snap_club_roster));
  insert into private.read_snapshot(singleton, source_version, model_id, ages, seasons, row_counts)
    values (true, v, m, age_list, season_list, counts);
  return jsonb_build_object('built', true, 'source_version', v, 'model_id', m, 'ages', age_list,
    'seasons', season_list, 'row_counts', counts);
end $f$;
revoke all on function private.build_read_snapshot() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
