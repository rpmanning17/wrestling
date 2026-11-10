begin;
create temporary table person_clubs_before on commit drop as select * from public.person_club_rankings_current;
create temporary table person_rosters_before on commit drop as select * from public.person_club_roster_current;
create or replace view public.person_club_rankings_current with(security_invoker=true) as  WITH participation AS (
         SELECT replace(m.season, '–'::text, '-'::text) AS season,
            m.winner_team AS team,
            m.loser_team AS opponent_team,
            m.winner_person_id AS person_id,
            m.loser_person_id AS opponent_id,
            1 AS won
           FROM person_matches m
          WHERE (upper(TRIM(BOTH FROM m.win_type)) = ANY (ARRAY['F'::text, 'DEC'::text, 'MD'::text, 'TF'::text])) AND m.winner_person_id IS NOT NULL AND m.loser_person_id IS NOT NULL AND m.winner_person_id <> m.loser_person_id
        UNION ALL
         SELECT replace(m.season, '–'::text, '-'::text) AS replace,
            m.loser_team,
            m.winner_team,
            m.loser_person_id,
            m.winner_person_id,
            0
           FROM person_matches m
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
        ), scoped AS (
         SELECT 'ALL'::text AS season,
            resolved.club_key,
            resolved.club_name,
            resolved.opponent_club_key,
            resolved.person_id,
            resolved.opponent_id,
            resolved.won
           FROM resolved
        UNION ALL
         SELECT resolved.season,
            resolved.club_key,
            resolved.club_name,
            resolved.opponent_club_key,
            resolved.person_id,
            resolved.opponent_id,
            resolved.won
           FROM resolved
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
             LEFT JOIN person_rating_current p ON p.person_id = r_1.person_id
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
             LEFT JOIN person_rating_current opponent ON opponent.person_id = s.opponent_id
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
create or replace view public.person_club_roster_current with(security_invoker=true) as  WITH participations AS (
         SELECT replace(m.season, '–'::text, '-'::text) AS season,
            m.winner_team AS team,
            m.winner_person_id AS person_id,
            1 AS won
           FROM person_matches m
          WHERE (upper(TRIM(BOTH FROM m.win_type)) = ANY (ARRAY['F'::text, 'DEC'::text, 'MD'::text, 'TF'::text])) AND m.winner_person_id IS NOT NULL AND m.loser_person_id IS NOT NULL AND m.winner_person_id <> m.loser_person_id
        UNION ALL
         SELECT replace(m.season, '–'::text, '-'::text) AS replace,
            m.loser_team,
            m.loser_person_id,
            0
           FROM person_matches m
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
        ), scoped AS (
         SELECT 'ALL'::text AS season,
            normalized.club_key,
            normalized.club_name,
            normalized.person_id,
            normalized.won
           FROM normalized
        UNION ALL
         SELECT normalized.season,
            normalized.club_key,
            normalized.club_name,
            normalized.person_id,
            normalized.won
           FROM normalized
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
     JOIN wrestler_people p ON p.id = s.person_id
     LEFT JOIN person_rating_current r ON r.person_id = s.person_id
  GROUP BY s.season, s.club_key, s.person_id, p.display_name, r.rating, r.rating_deviation, r.conservative_score, r.sos_expected_win_pct, r.avg_opponent_rating, r.rating_status;
do $verify$ begin
 if exists((select * from person_clubs_before except select * from public.person_club_rankings_current)
 union all(select * from public.person_club_rankings_current except select * from person_clubs_before))
 or exists((select * from person_rosters_before except select * from public.person_club_roster_current)
 union all(select * from public.person_club_roster_current except select * from person_rosters_before))
 then raise exception 'Distinct club labels changed aggregate output';end if;
end $verify$;
notify pgrst,'reload schema';
commit;

