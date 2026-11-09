begin;
create temporary table strength_before on commit drop as select * from public.wrestler_strength_current;
create or replace function public.current_wrestler_strength(target_age integer default null)
returns table (athlete_key text,athlete_name text,team text,age_group text,division_birth_year_start smallint,division_birth_year_end smallint,weight_bucket integer,weight_band text,bracket_weight_lbs numeric(5,2),evidence_date date,confidence_score smallint,confidence_label text,evidence_type text,model_id uuid,model_version text,as_of_date date,rating numeric(8,3),rating_deviation numeric(8,3),volatility numeric(8,6),conservative_score numeric(8,3),rating_status text,match_count integer,wins integer,losses integer,last_match_date date,strength_score numeric,cohort_rank integer,cohort_size integer,cohort_tier integer,tier_unavailable_reason text)
language plpgsql stable security invoker set search_path='' as $function$
begin return query execute $strength$
 WITH cohort_evidence AS (
         SELECT wrestler_cohort_current.athlete_key,
            wrestler_cohort_current.athlete_name,
            wrestler_cohort_current.team,
            wrestler_cohort_current.evidence_date,
            wrestler_cohort_current.age_group,
            wrestler_cohort_current.bracket_weight_lbs,
            wrestler_cohort_current.weight_bucket,
            wrestler_cohort_current.division_birth_year_start,
            wrestler_cohort_current.division_birth_year_end,
            wrestler_cohort_current.confidence_score,
            wrestler_cohort_current.confidence_label,
            wrestler_cohort_current.evidence_type,
            wrestler_cohort_current.tier_eligible
           FROM public.current_wrestler_cohorts($1) wrestler_cohort_current
          WHERE ($1 is null or wrestler_cohort_current.age_group=($1::text||'U')) AND wrestler_cohort_current.age_group IS NOT NULL AND wrestler_cohort_current.bracket_weight_lbs IS NOT NULL
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
             JOIN public.wrestler_rating_current current_rating ON current_rating.athlete_key = evidence.athlete_key
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
        )
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
   FROM normalized;
$strength$ using target_age; end $function$;
revoke all on function public.current_wrestler_strength(integer) from public,authenticated;
grant execute on function public.current_wrestler_strength(integer) to anon;
create or replace view public.wrestler_strength_current with(security_invoker=true) as
select athlete_key::text as athlete_key,athlete_name::text as athlete_name,team::text as team,age_group::text as age_group,division_birth_year_start::smallint as division_birth_year_start,division_birth_year_end::smallint as division_birth_year_end,weight_bucket::integer as weight_bucket,weight_band::text as weight_band,bracket_weight_lbs::numeric(5,2) as bracket_weight_lbs,evidence_date::date as evidence_date,confidence_score::smallint as confidence_score,confidence_label::text as confidence_label,evidence_type::text as evidence_type,model_id::uuid as model_id,model_version::text as model_version,as_of_date::date as as_of_date,rating::numeric(8,3) as rating,rating_deviation::numeric(8,3) as rating_deviation,volatility::numeric(8,6) as volatility,conservative_score::numeric(8,3) as conservative_score,rating_status::text as rating_status,match_count::integer as match_count,wins::integer as wins,losses::integer as losses,last_match_date::date as last_match_date,strength_score::numeric as strength_score,cohort_rank::integer as cohort_rank,cohort_size::integer as cohort_size,cohort_tier::integer as cohort_tier,tier_unavailable_reason::text as tier_unavailable_reason from public.current_wrestler_strength(null);
create or replace function public.current_person_strength(target_age integer default null)
returns table (athlete_key text,athlete_name text,team text,age_group text,division_birth_year_start smallint,division_birth_year_end smallint,weight_bucket integer,weight_band text,bracket_weight_lbs numeric(5,2),evidence_date date,confidence_score smallint,confidence_label text,evidence_type text,model_id uuid,model_version text,as_of_date date,rating numeric(8,3),rating_deviation numeric(8,3),volatility numeric(8,6),conservative_score numeric(8,3),rating_status text,match_count integer,wins integer,losses integer,last_match_date date,strength_score numeric,cohort_rank integer,cohort_size integer,cohort_tier integer,tier_unavailable_reason text)
language plpgsql stable security invoker set search_path='' as $function$
begin return query execute $strength$
 WITH cohort_evidence AS (
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
           FROM public.current_person_cohorts($1) person_cohort_current
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
        )
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
   FROM normalized;
$strength$ using target_age; end $function$;
revoke all on function public.current_person_strength(integer) from public,authenticated;
grant execute on function public.current_person_strength(integer) to anon;
create or replace view public.person_strength_current with(security_invoker=true) as
select athlete_key::text as athlete_key,athlete_name::text as athlete_name,team::text as team,age_group::text as age_group,division_birth_year_start::smallint as division_birth_year_start,division_birth_year_end::smallint as division_birth_year_end,weight_bucket::integer as weight_bucket,weight_band::text as weight_band,bracket_weight_lbs::numeric(5,2) as bracket_weight_lbs,evidence_date::date as evidence_date,confidence_score::smallint as confidence_score,confidence_label::text as confidence_label,evidence_type::text as evidence_type,model_id::uuid as model_id,model_version::text as model_version,as_of_date::date as as_of_date,rating::numeric(8,3) as rating,rating_deviation::numeric(8,3) as rating_deviation,volatility::numeric(8,6) as volatility,conservative_score::numeric(8,3) as conservative_score,rating_status::text as rating_status,match_count::integer as match_count,wins::integer as wins,losses::integer as losses,last_match_date::date as last_match_date,strength_score::numeric as strength_score,cohort_rank::integer as cohort_rank,cohort_size::integer as cohort_size,cohort_tier::integer as cohort_tier,tier_unavailable_reason::text as tier_unavailable_reason from public.current_person_strength(null);
do $verify$ begin
 if exists ((select * from strength_before except select * from public.wrestler_strength_current)
 union all(select * from public.wrestler_strength_current except select * from strength_before))
 then raise exception 'Scoped standings changed full output'; end if;
end $verify$;
notify pgrst,'reload schema';
commit;

