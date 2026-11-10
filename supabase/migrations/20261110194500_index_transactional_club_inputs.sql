begin;
select pg_advisory_xact_lock(194260711,1);
lock table public.matches,public.source_identity_current_rows in share row exclusive mode;
alter table private.match_cohort_appearances
 add column club_season text,
 add column club_win_type text,
 add column club_opponent_team text,
 add column club_opponent_person_id uuid,
 add column club_alias_key text generated always as(regexp_replace(lower(trim(team)),'[^a-z0-9]+',' ','g')) stored,
 add column club_opponent_alias_key text generated always as(regexp_replace(lower(trim(club_opponent_team)),'[^a-z0-9]+',' ','g')) stored,
 add column club_contested boolean generated always as(upper(trim(club_win_type)) in('F','DEC','MD','TF')) stored;
create or replace function private.attach_cohort_person() returns trigger
language plpgsql security definer set search_path='' as $attach$
begin
 select a.person_id into NEW.person_id from public.source_identity_current_rows a
 where a.source_id=NEW.source_match_id::text and a.source_kind=case NEW.side when 'winner' then 'match_winner' else 'match_loser' end;
 select replace(m.season,'–','-'),m.win_type,case NEW.side when 'winner' then m.loser_team else m.winner_team end
 into NEW.club_season,NEW.club_win_type,NEW.club_opponent_team from public.matches m where m.id=NEW.source_match_id;
 select a.person_id into NEW.club_opponent_person_id from public.source_identity_current_rows a
 where a.source_id=NEW.source_match_id::text and a.source_kind=case NEW.side when 'winner' then 'match_loser' else 'match_winner' end;
 return NEW;
end $attach$;

create or replace function private.sync_cohort_assignment() returns trigger
language plpgsql security definer set search_path='' as $assign$
begin
 if TG_OP<>'INSERT' and OLD.source_kind in('match_winner','match_loser')
 and OLD.source_id~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  update private.match_cohort_appearances p set person_id=(
   select a.person_id from public.source_identity_current_rows a
   where a.source_kind=OLD.source_kind and a.source_id=OLD.source_id)
  where p.source_match_id=OLD.source_id::uuid and p.side=case OLD.source_kind when 'match_winner' then 'winner' else 'loser' end;
  update private.match_cohort_appearances p set club_opponent_person_id=(
   select a.person_id from public.source_identity_current_rows a where a.source_kind=OLD.source_kind and a.source_id=OLD.source_id)
  where p.source_match_id=OLD.source_id::uuid and p.side=case OLD.source_kind when 'match_winner' then 'loser' else 'winner' end;
 end if;
 if TG_OP<>'DELETE' and NEW.source_kind in('match_winner','match_loser')
 and NEW.source_id~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  update private.match_cohort_appearances p set person_id=NEW.person_id
  where p.source_match_id=NEW.source_id::uuid and p.side=case NEW.source_kind when 'match_winner' then 'winner' else 'loser' end;
  update private.match_cohort_appearances p set club_opponent_person_id=NEW.person_id
  where p.source_match_id=NEW.source_id::uuid and p.side=case NEW.source_kind when 'match_winner' then 'loser' else 'winner' end;
 end if;
 return null;
end $assign$;

update private.match_cohort_appearances p set
 club_season=replace(m.season,'–','-'),club_win_type=m.win_type,
 club_opponent_team=case p.side when 'winner' then m.loser_team else m.winner_team end,
 club_opponent_person_id=(select a.person_id from public.source_identity_current_rows a
 where a.source_id=m.id::text and a.source_kind=case p.side when 'winner' then 'match_loser' else 'match_winner' end)
from public.matches m where p.source_match_id=m.id;
create index match_club_inputs_covering_idx on private.match_cohort_appearances(club_contested)
 include(club_season,person_id,club_opponent_person_id,team,club_alias_key,club_opponent_alias_key,side);
create or replace function public.person_club_rankings_for_season(target_season text,target_club text default null)
 returns setof public.person_club_rankings_current language plpgsql stable security invoker set search_path='' as $fn$
 begin return query execute $query$with active_ratings as materialized(select * from public.person_rating_current),
 participation as materialized (
 select p.club_season season,p.team,p.club_alias_key alias_key,p.club_opponent_alias_key opponent_alias_key,
 p.person_id,p.club_opponent_person_id opponent_id,case p.side when 'winner' then 1 else 0 end won
 from private.match_cohort_appearances p
 where p.club_contested and p.person_id is not null and p.club_opponent_person_id is not null and p.person_id<>p.club_opponent_person_id
 and ($1='ALL' or p.club_season=$1)
 ), alias_keys as materialized (
 select alias_key from participation union select opponent_alias_key from participation
 ), club_keys as materialized (
 select k.alias_key,coalesce(a.club_key,'raw:'||k.alias_key) club_key,a.canonical_name
 from alias_keys k left join public.club_aliases a on a.alias_key=k.alias_key
 ), resolved as (
 select p.season,p.person_id,p.opponent_id,p.won,k.club_key,
 coalesce(k.canonical_name,trim(p.team)) club_name,o.club_key opponent_club_key
 from participation p left join club_keys k on k.alias_key=p.alias_key
 left join club_keys o on o.alias_key=p.opponent_alias_key
 where nullif(trim(p.team),'') is not null
 ), scoped AS (select case when $1='ALL' then 'ALL' else resolved.season end season,resolved.club_key,resolved.club_name,resolved.opponent_club_key,resolved.person_id,resolved.opponent_id,resolved.won
 from resolved where ($1='ALL' or resolved.season=$1) and ($2 is null or resolved.club_key=$2)
 ), roster AS (
         SELECT DISTINCT scoped.season,
            scoped.club_key,
            scoped.person_id
           FROM scoped
        ), rated_roster AS (
         SELECT r_1.season,
            r_1.club_key,
            r_1.person_id,
            p.conservative_score,
            p.rating_deviation,
            row_number() OVER (PARTITION BY r_1.season, r_1.club_key ORDER BY p.conservative_score DESC NULLS LAST) AS power_rank
           FROM roster r_1
             LEFT JOIN active_ratings p ON p.person_id = r_1.person_id
        ), roster_summary AS (
         SELECT rated_roster.season,
            rated_roster.club_key,
            count(*)::integer AS wrestlers,
            count(rated_roster.conservative_score)::integer AS rated_wrestlers,
            round(avg(rated_roster.conservative_score), 1) AS avg_conservative,
            round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (rated_roster.conservative_score::double precision))::numeric, 1) AS median_conservative,
            round(avg(rated_roster.conservative_score) FILTER (WHERE rated_roster.power_rank <= 5), 1) AS top_five_conservative,
            round(avg(rated_roster.rating_deviation), 1) AS avg_rating_deviation
           FROM rated_roster
          GROUP BY rated_roster.season, rated_roster.club_key
        ), rated AS (
         SELECT s.season,
            s.club_key,
            s.club_name,
            s.opponent_club_key,
            s.person_id,
            s.opponent_id,
            s.won,
            opponent.rating AS opponent_rating
           FROM scoped s
             LEFT JOIN active_ratings opponent ON opponent.person_id = s.opponent_id
        ), bouts AS (
         SELECT rated.season,
            rated.club_key,
            max(rated.club_name) AS club_name,
            count(*)::integer AS bouts,
            count(*) FILTER (WHERE rated.won = 1)::integer AS wins,
            count(*) FILTER (WHERE rated.won = 0)::integer AS losses,
            count(*) FILTER (WHERE rated.club_key = rated.opponent_club_key)::integer AS in_house_bouts,
            round(avg(rated.opponent_rating), 1) AS avg_opponent_rating,
            avg(1.0::double precision / (1.0::double precision + power(10.0::double precision, (rated.opponent_rating::double precision - 1500.0::double precision) / 400.0::double precision)))::numeric AS schedule_expected_win_pct
           FROM rated
          GROUP BY rated.season, rated.club_key
        )
 SELECT b.season,
    b.club_key,
    b.club_name,
    b.bouts,
    b.wins,
    b.losses,
    r.wrestlers,
    r.rated_wrestlers,
    r.avg_conservative,
    r.median_conservative,
    r.top_five_conservative,
    r.avg_rating_deviation,
    b.avg_opponent_rating,
    b.in_house_bouts,
    b.schedule_expected_win_pct
   FROM bouts b
     JOIN roster_summary r ON r.season = b.season AND r.club_key = b.club_key;
 $query$ using target_season,target_club;end $fn$;

create or replace function public.person_club_roster_for_season(target_season text,target_club text default null)
 returns setof public.person_club_roster_current language plpgsql stable security invoker set search_path='' as $fn$
 begin return query execute $query$with active_ratings as materialized(select * from public.person_rating_current),
 participations as materialized (
 select p.club_season season,p.team,p.club_alias_key alias_key,p.club_opponent_alias_key opponent_alias_key,
 p.person_id,p.club_opponent_person_id opponent_id,case p.side when 'winner' then 1 else 0 end won
 from private.match_cohort_appearances p
 where p.club_contested and p.person_id is not null and p.club_opponent_person_id is not null and p.person_id<>p.club_opponent_person_id
 and ($1='ALL' or p.club_season=$1)
 ), alias_keys as materialized (
 select alias_key from participations union select opponent_alias_key from participations
 ), club_keys as materialized (
 select k.alias_key,coalesce(a.club_key,'raw:'||k.alias_key) club_key,a.canonical_name
 from alias_keys k left join public.club_aliases a on a.alias_key=k.alias_key
 ), normalized as (
 select p.season,p.person_id,p.won,k.club_key,
 coalesce(k.canonical_name,trim(p.team)) club_name
 from participations p left join club_keys k on k.alias_key=p.alias_key
 
 where nullif(trim(p.team),'') is not null
 ), scoped AS (select case when $1='ALL' then 'ALL' else normalized.season end season,normalized.club_key,normalized.club_name,normalized.person_id,normalized.won
 from normalized where ($1='ALL' or normalized.season=$1) and ($2 is null or normalized.club_key=$2)
 )
 SELECT s.season,
    s.club_key,
    max(s.club_name) AS club_name,
    s.person_id::text AS athlete_key,
    p.display_name AS athlete_name,
    count(*)::integer AS bouts,
    sum(s.won)::integer AS wins,
    (count(*) - sum(s.won))::integer AS losses,
    r.rating,
    r.rating_deviation,
    r.conservative_score,
    r.sos_expected_win_pct,
    r.avg_opponent_rating,
    r.rating_status
   FROM scoped s
     JOIN public.wrestler_people p ON p.id = s.person_id
     LEFT JOIN active_ratings r ON r.person_id = s.person_id
  GROUP BY s.season, s.club_key, s.person_id, p.display_name, r.rating, r.rating_deviation, r.conservative_score, r.sos_expected_win_pct, r.avg_opponent_rating, r.rating_status; $query$ using target_season,target_club;end $fn$;

do $verify$ begin
 if exists(select 1 from private.match_cohort_appearances p join public.matches m on m.id=p.source_match_id
 left join public.source_identity_current_rows a on a.source_id=m.id::text and a.source_kind=case p.side when 'winner' then 'match_loser' else 'match_winner' end
 where p.club_season is distinct from replace(m.season,'–','-') or p.club_win_type is distinct from m.win_type
 or p.club_opponent_team is distinct from case p.side when 'winner' then m.loser_team else m.winner_team end
 or p.club_opponent_person_id is distinct from a.person_id) then raise exception 'Club projection differs from source';end if;
 if exists((select * from public.person_club_rankings_current except select r.* from (select distinct season from public.person_club_rankings_current) s cross join lateral public.person_club_rankings_for_season(s.season,null) r)
 union all(select r.* from (select distinct season from public.person_club_rankings_current) s cross join lateral public.person_club_rankings_for_season(s.season,null) r except select * from public.person_club_rankings_current))
 then raise exception 'Projected club summaries differ';end if;
end $verify$;
analyze private.match_cohort_appearances;
notify pgrst,'reload schema';
commit;

