begin;
create or replace function public.person_club_rankings_for_season(target_season text,target_club text default null)
returns setof public.person_club_rankings_current language plpgsql stable security invoker set search_path='' as $fn$
begin return query execute $query$ WITH active_ratings as materialized(select * from public.person_rating_current), source_bouts as materialized (
 select m.*,w.person_id winner_person_id,l.person_id loser_person_id from public.matches m
 join private.match_cohort_appearances w on w.source_match_id=m.id and w.side='winner'
 join private.match_cohort_appearances l on l.source_match_id=m.id and l.side='loser'
 where upper(trim(m.win_type)) in('F','DEC','MD','TF') and w.person_id is not null and l.person_id is not null and w.person_id<>l.person_id
 ), participation AS (
         SELECT replace(m.season, '–'::text, '-'::text) AS season,
            m.winner_team AS team,
            m.loser_team AS opponent_team,
            m.winner_person_id AS person_id,
            m.loser_person_id AS opponent_id,
            1 AS won
           FROM source_bouts m
          WHERE (upper(TRIM(BOTH FROM m.win_type)) = ANY (ARRAY['F'::text, 'DEC'::text, 'MD'::text, 'TF'::text])) AND m.winner_person_id IS NOT NULL AND m.loser_person_id IS NOT NULL AND m.winner_person_id <> m.loser_person_id
        UNION ALL
         SELECT replace(m.season, '–'::text, '-'::text) AS replace,
            m.loser_team,
            m.winner_team,
            m.loser_person_id,
            m.winner_person_id,
            0
           FROM source_bouts m
          WHERE (upper(TRIM(BOTH FROM m.win_type)) = ANY (ARRAY['F'::text, 'DEC'::text, 'MD'::text, 'TF'::text])) AND m.winner_person_id IS NOT NULL AND m.loser_person_id IS NOT NULL AND m.winner_person_id <> m.loser_person_id
        ), team_keys as materialized (
 select team,regexp_replace(lower(trim(team)),'[^a-z0-9]+',' ','g') alias_key
 from (select distinct team from participation union select distinct opponent_team from participation) teams
 ), resolved AS (
         SELECT p.season,
            p.person_id,
            p.opponent_id,
            p.won,
            COALESCE(a.club_key, 'raw:'::text || tk.alias_key) AS club_key,
            COALESCE(a.canonical_name, TRIM(BOTH FROM p.team)) AS club_name,
            COALESCE(o.club_key, 'raw:'::text || otk.alias_key) AS opponent_club_key
           FROM participation p
             left join team_keys tk on tk.team=p.team
             left join team_keys otk on otk.team=p.opponent_team
             LEFT JOIN public.club_aliases a ON a.alias_key=tk.alias_key
             LEFT JOIN public.club_aliases o ON o.alias_key=otk.alias_key
          WHERE NULLIF(TRIM(BOTH FROM p.team), ''::text) IS NOT NULL
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
revoke all on function public.person_club_rankings_for_season(text,text) from public,anon,authenticated,service_role;
grant execute on function public.person_club_rankings_for_season(text,text) to anon;

create or replace function public.person_club_roster_for_season(target_season text,target_club text default null)
returns setof public.person_club_roster_current language plpgsql stable security invoker set search_path='' as $fn$
begin return query execute $query$ WITH active_ratings as materialized(select * from public.person_rating_current), source_bouts as materialized (
 select m.*,w.person_id winner_person_id,l.person_id loser_person_id from public.matches m
 join private.match_cohort_appearances w on w.source_match_id=m.id and w.side='winner'
 join private.match_cohort_appearances l on l.source_match_id=m.id and l.side='loser'
 where upper(trim(m.win_type)) in('F','DEC','MD','TF') and w.person_id is not null and l.person_id is not null and w.person_id<>l.person_id
 ), participations AS (
         SELECT replace(m.season, '–'::text, '-'::text) AS season,
            m.winner_team AS team,
            m.winner_person_id AS person_id,
            1 AS won
           FROM source_bouts m
          WHERE (upper(TRIM(BOTH FROM m.win_type)) = ANY (ARRAY['F'::text, 'DEC'::text, 'MD'::text, 'TF'::text])) AND m.winner_person_id IS NOT NULL AND m.loser_person_id IS NOT NULL AND m.winner_person_id <> m.loser_person_id
        UNION ALL
         SELECT replace(m.season, '–'::text, '-'::text) AS replace,
            m.loser_team,
            m.loser_person_id,
            0
           FROM source_bouts m
          WHERE (upper(TRIM(BOTH FROM m.win_type)) = ANY (ARRAY['F'::text, 'DEC'::text, 'MD'::text, 'TF'::text])) AND m.winner_person_id IS NOT NULL AND m.loser_person_id IS NOT NULL AND m.winner_person_id <> m.loser_person_id
        ), team_keys as materialized (
 select team,regexp_replace(lower(trim(team)),'[^a-z0-9]+',' ','g') alias_key
 from (select distinct team from participations) teams
 ), normalized AS (
         SELECT p_1.season,
            COALESCE(a.club_key, 'raw:'::text || tk.alias_key) AS club_key,
            COALESCE(a.canonical_name, TRIM(BOTH FROM p_1.team)) AS club_name,
            p_1.person_id,
            p_1.won
           FROM participations p_1
             left join team_keys tk on tk.team=p_1.team
             LEFT JOIN public.club_aliases a ON a.alias_key=tk.alias_key
          WHERE NULLIF(TRIM(BOTH FROM p_1.team), ''::text) IS NOT NULL
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
revoke all on function public.person_club_roster_for_season(text,text) from public,anon,authenticated,service_role;
grant execute on function public.person_club_roster_for_season(text,text) to anon;
do $verify$ begin
 if exists((select * from public.person_club_rankings_current except select r.* from (select distinct season from public.person_club_rankings_current) s cross join lateral public.person_club_rankings_for_season(s.season,null) r)
 union all(select r.* from (select distinct season from public.person_club_rankings_current) s cross join lateral public.person_club_rankings_for_season(s.season,null) r except select * from public.person_club_rankings_current))
 then raise exception 'Scoped club summaries differ';end if;
end $verify$;
notify pgrst,'reload schema';
commit;

