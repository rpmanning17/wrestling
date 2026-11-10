begin;
create index person_club_rating_covering_idx on public.wrestler_model_ratings(model_id,person_id)
 include(rating,rating_deviation,conservative_score,sos_expected_win_pct,avg_opponent_rating,rating_status);
create or replace function public.person_club_rankings_for_season(target_season text,target_club text default null)
 returns setof public.person_club_rankings_current language plpgsql stable security invoker set search_path='' as $fn$
 begin return query execute $query$with active_ratings as materialized(select person_id,rating,conservative_score,rating_deviation from public.person_rating_current),
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
 begin return query execute $query$with active_ratings as materialized(select person_id,rating,rating_deviation,conservative_score,sos_expected_win_pct,avg_opponent_rating,rating_status from public.person_rating_current),
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


notify pgrst,'reload schema';
commit;

