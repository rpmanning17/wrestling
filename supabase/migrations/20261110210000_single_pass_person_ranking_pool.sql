-- Single-pass person ranking pool.
-- The Rankings page previously ran the full age classification twice per load: once through
-- current_person_cohorts(age) and again inside current_person_strength(age). On the Free plan's
-- burstable CPU the duplicate pass pushed tail latency past the unchanged three-second anon limit.
-- This invoker function classifies once (materialized) and returns every cohort row with the
-- standing fields left-joined. The standing SQL is the current_person_strength body verbatim
-- (from 20261109213000_scope_current_standings.sql) with only its cohort source replaced.
-- No formula, raw bout, assignment, rating row, RLS policy, grant to other roles or timeout changes.
create or replace function public.current_person_cohort_strength(target_age integer)
returns table (athlete_key text,athlete_name text,team text,evidence_date date,age_group text,bracket_weight_lbs numeric,weight_bucket integer,division_birth_year_start smallint,division_birth_year_end smallint,confidence_score smallint,confidence_label text,evidence_type text,tier_eligible boolean,
 strength_rated boolean,strength_weight_band text,strength_bracket_weight_lbs numeric(5,2),strength_score numeric,cohort_rank integer,cohort_size integer,cohort_tier integer,tier_unavailable_reason text)
language plpgsql stable security invoker set search_path='' as $function$
begin
 if target_age is null then raise exception 'current_person_cohort_strength requires an age'; end if;
 return query execute $strength$
 WITH pool_cohorts AS MATERIALIZED (
         SELECT * FROM private.calculate_person_cohorts($1,null)
        ), cohort_evidence AS (
         SELECT person_cohort_current.athlete_key,
            person_cohort_current.athlete_name,
            person_cohort_current.team,
            person_cohort_current.evidence_date,
            person_cohort_current.age_group,
            person_cohort_current.bracket_weight_lbs,
            person_cohort_current.weight_bucket,
            person_cohort_current.division_birth_year_start,
            person_cohort_current.division_birth_year_end,
            person_cohort_current.confidence_score,
            person_cohort_current.confidence_label,
            person_cohort_current.evidence_type,
            person_cohort_current.tier_eligible
           FROM pool_cohorts person_cohort_current
          WHERE ($1 is null or person_cohort_current.age_group=($1::text||'U')) AND person_cohort_current.age_group IS NOT NULL AND person_cohort_current.bracket_weight_lbs IS NOT NULL
        ), joined AS (
         SELECT evidence.athlete_key,
            COALESCE(evidence.athlete_name, current_rating.athlete_name) AS athlete_name,
            COALESCE(NULLIF(evidence.team, ''::text), current_rating.team, ''::text) AS team,
            evidence.age_group,
            evidence.division_birth_year_start,
            evidence.division_birth_year_end,
            evidence.weight_bucket,
            evidence.bracket_weight_lbs,
            evidence.evidence_date,
            evidence.confidence_score,
            evidence.confidence_label,
            evidence.evidence_type,
            evidence.tier_eligible,
            current_rating.model_id,
            current_rating.model_version,
            current_rating.as_of_date,
            current_rating.rating,
            current_rating.rating_deviation,
            current_rating.volatility,
            current_rating.conservative_score,
            current_rating.rating_status,
            current_rating.match_count,
            current_rating.wins,
            current_rating.losses,
            current_rating.last_match_date
           FROM cohort_evidence evidence
             JOIN public.person_rating_current current_rating ON current_rating.athlete_key = evidence.athlete_key
        ), normalized AS (
         SELECT joined.athlete_key,
            joined.athlete_name,
            joined.team,
            joined.age_group,
            joined.division_birth_year_start,
            joined.division_birth_year_end,
            joined.weight_bucket,
            joined.bracket_weight_lbs,
            joined.evidence_date,
            joined.confidence_score,
            joined.confidence_label,
            joined.evidence_type,
            joined.tier_eligible,
            joined.model_id,
            joined.model_version,
            joined.as_of_date,
            joined.rating,
            joined.rating_deviation,
            joined.volatility,
            joined.conservative_score,
            joined.rating_status,
            joined.match_count,
            joined.wins,
            joined.losses,
            joined.last_match_date,
            count(*) OVER (PARTITION BY joined.age_group, joined.weight_bucket, joined.conservative_score)::integer AS tied_population,
            min(joined.conservative_score) OVER (PARTITION BY joined.age_group, joined.weight_bucket) AS cohort_min,
            max(joined.conservative_score) OVER (PARTITION BY joined.age_group, joined.weight_bucket) AS cohort_max,
            count(*) OVER (PARTITION BY joined.age_group, joined.weight_bucket)::integer AS cohort_size,
            rank() OVER (PARTITION BY joined.age_group, joined.weight_bucket ORDER BY joined.conservative_score DESC)::integer AS cohort_rank
           FROM joined
        ), strength AS (
 SELECT athlete_key,
    athlete_name,
    team,
    age_group,
    division_birth_year_start,
    division_birth_year_end,
    weight_bucket,
    ((weight_bucket || '–'::text) || (weight_bucket + 9)) || ' lb'::text AS weight_band,
    bracket_weight_lbs::numeric(5,2) AS bracket_weight_lbs,
    evidence_date,
    confidence_score,
    confidence_label,
    evidence_type,
    model_id,
    model_version,
    as_of_date,
    rating,
    rating_deviation,
    volatility,
    conservative_score,
    rating_status,
    match_count,
    wins,
    losses,
    last_match_date,
        CASE
            WHEN cohort_max = cohort_min THEN 1000.00
            ELSE round((conservative_score - cohort_min) / NULLIF(cohort_max - cohort_min, 0::numeric) * 1000::numeric, 2)
        END AS strength_score,
    cohort_rank,
    cohort_size,
        CASE
            WHEN cohort_size >= 20 AND tier_eligible THEN ceil(10.0 * ((cohort_rank - 1)::numeric + tied_population::numeric / 2.0) / cohort_size::numeric)::integer
            ELSE NULL::integer
        END AS cohort_tier,
        CASE
            WHEN NOT tier_eligible THEN 'Age or weight evidence has tied support; current placement is an estimate.'::text
            WHEN cohort_size < 20 THEN 'At least 20 rated wrestlers are required for Cohort Tier.'::text
            ELSE NULL::text
        END AS tier_unavailable_reason
   FROM normalized
)
 SELECT c.athlete_key,c.athlete_name,c.team,c.evidence_date,c.age_group,c.bracket_weight_lbs,c.weight_bucket,
    c.division_birth_year_start,c.division_birth_year_end,c.confidence_score,c.confidence_label,c.evidence_type,c.tier_eligible,
    s.athlete_key IS NOT NULL AS strength_rated,s.weight_band AS strength_weight_band,s.bracket_weight_lbs AS strength_bracket_weight_lbs,
    s.strength_score,s.cohort_rank,s.cohort_size,s.cohort_tier,s.tier_unavailable_reason
   FROM pool_cohorts c LEFT JOIN strength s ON s.athlete_key = c.athlete_key
$strength$ using target_age;
end $function$;
revoke all on function public.current_person_cohort_strength(integer) from public,anon,authenticated,service_role;
grant execute on function public.current_person_cohort_strength(integer) to anon;

-- Abort unless the single pass reproduces both existing functions exactly for age 12 under the
-- currently active model (the release audit repeats this for every age under the candidate).
do $verify$ begin
 if exists((select athlete_key,athlete_name,team,evidence_date,age_group,bracket_weight_lbs,weight_bucket,division_birth_year_start,division_birth_year_end,confidence_score,confidence_label,evidence_type,tier_eligible from public.current_person_cohort_strength(12)
   except select * from public.current_person_cohorts(12))
  union all (select * from public.current_person_cohorts(12)
   except select athlete_key,athlete_name,team,evidence_date,age_group,bracket_weight_lbs,weight_bucket,division_birth_year_start,division_birth_year_end,confidence_score,confidence_label,evidence_type,tier_eligible from public.current_person_cohort_strength(12)))
 or (select count(*) from public.current_person_cohort_strength(12)) <> (select count(*) from public.current_person_cohorts(12))
 then raise exception 'Single-pass cohort rows differ'; end if;
 if exists((select athlete_key,strength_score,cohort_rank,cohort_size,cohort_tier,tier_unavailable_reason,strength_weight_band,age_group,strength_bracket_weight_lbs from public.current_person_cohort_strength(12) where strength_rated
   except select athlete_key,strength_score,cohort_rank,cohort_size,cohort_tier,tier_unavailable_reason,weight_band,age_group,bracket_weight_lbs from public.current_person_strength(12))
  union all (select athlete_key,strength_score,cohort_rank,cohort_size,cohort_tier,tier_unavailable_reason,weight_band,age_group,bracket_weight_lbs from public.current_person_strength(12)
   except select athlete_key,strength_score,cohort_rank,cohort_size,cohort_tier,tier_unavailable_reason,strength_weight_band,age_group,strength_bracket_weight_lbs from public.current_person_cohort_strength(12) where strength_rated))
 or (select count(*) from public.current_person_cohort_strength(12) where strength_rated) <> (select count(*) from public.current_person_strength(12))
 then raise exception 'Single-pass standing rows differ'; end if;
end $verify$;
