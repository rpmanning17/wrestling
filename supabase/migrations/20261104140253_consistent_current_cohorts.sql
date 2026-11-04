begin;
-- Only verified measurements belong here. Existing bracket labels are never copied.
alter table public.tournament_entries add column weigh_in_lbs numeric(5,2)
  check (weigh_in_lbs between 30 and 400);
comment on column public.tournament_entries.weigh_in_lbs is 'Optional verified event weigh-in in pounds, never inferred from a bracket label.';

-- Authoritative current classification, shared by search, profiles and rankings.
create view public.wrestler_cohort_current with (security_invoker=true) as
with raw as (
  select athlete_name, team, event_date, event_name, age_group,
    bracket_weight_lbs, weigh_in_lbs, 4 as source_rank from public.tournament_entries
  union all
  select athlete_name, team, event_date, event_name, age_group,
    coalesce(bracket_weight_lbs, substring(bracket_weight_label from '([0-9]+(?:[.][0-9]+)?)[^0-9]*$')::numeric), null, 3
    from public.tournament_observations where identity_resolution in ('exact_existing','new_identity')
  union all
  select athlete_name, team, event_date, event_name, age_group, bracket_weight_lbs, null, 2
    from public.wrestler_evidence
  union all
  select p.name, p.team, m.event_date, m.event_name,
    (regexp_match(m.weight_class, '(?<![0-9])(6|8|10|12|14|16|18) ?[uU](?![a-zA-Z])'))[1] || 'U',
    substring(m.weight_class from '([0-9]+(?:[.][0-9]+)?)[^0-9]*$')::numeric, null, 1
    from public.matches m cross join lateral (values (m.winner_name,m.winner_team),(m.loser_name,m.loser_team)) p(name,team)
), canonical as (
  select coalesce(a.canonical_key,lower(trim(r.athlete_name))) athlete_key,
    coalesce(a.canonical_name,r.athlete_name) athlete_name, r.team,r.event_date,
    regexp_replace(lower(trim(r.event_name)), '\s+', ' ', 'g') event_name,
    r.age_group,r.bracket_weight_lbs,r.weigh_in_lbs,r.source_rank
  from raw r left join public.wrestler_aliases a on a.alias_key=lower(trim(r.athlete_name))
  where trim(r.event_name)<>''
), dates as (
  select distinct athlete_key,event_name,event_date from canonical
), breaks as (
  select *,case when event_date-lag(event_date) over (partition by athlete_key,event_name order by event_date)>7 then 1 else 0 end new_event from dates
), islands as (
  select *,sum(new_event) over (partition by athlete_key,event_name order by event_date) event_number from breaks
), event_dates as (
  select athlete_key,event_name,event_number,max(event_date) event_date from islands group by 1,2,3
), events as (
  select *,row_number() over (partition by athlete_key order by event_date desc,event_name desc) recency from event_dates
), recent as (
  select c.*,e.recency,e.event_date latest_date,e.event_number,
    (case e.recency when 1 then 0.5 when 2 then 0.3 else 0.2 end)::numeric *
      case when c.event_name ~ '\mduals?\M' then 0.5 else 1 end event_weight
  from canonical c join islands i using (athlete_key,event_name,event_date)
    join events e using (athlete_key,event_name,event_number) where e.recency<=3
), field_rows as (
  select r.athlete_key,r.event_name,r.event_number,r.recency,r.event_weight,f.*
  from recent r cross join lateral (values
    ('age',nullif(regexp_replace(coalesce(r.age_group,''),'[^0-9]','','g'),'')::numeric,r.source_rank),
    ('weight',case when r.weigh_in_lbs between 30 and 400 then r.weigh_in_lbs
      when r.bracket_weight_lbs between 30 and 400 then r.bracket_weight_lbs end,
      case when r.weigh_in_lbs is not null then 5 else r.source_rank end)
  ) f(field,value,priority) where f.value is not null
), preferred as (
  select *,max(priority) over (partition by athlete_key,event_name,event_number,field) top_priority from field_rows
), distinct_values as (
  select distinct athlete_key,event_name,event_number,recency,event_weight,field,value
  from preferred where priority=top_priority
), divided as (
  select *,event_weight/count(*) over (partition by athlete_key,event_name,event_number,field) vote from distinct_values
), totals as (
  select athlete_key,field,value,sum(vote) score,min(recency) newest from divided group by 1,2,3
), winners as (
  select *,row_number() over (partition by athlete_key,field order by score desc,newest,value) place from totals
), labels as (
  select athlete_key,max(value) filter(where field='age')::integer || 'U' age_group,
    max(value) filter(where field='weight') bracket_weight_lbs from winners where place=1 group by 1
), metadata as (
  select distinct on (athlete_key) athlete_key,athlete_name,team,latest_date evidence_date
  from recent order by athlete_key,latest_date desc,source_rank desc,athlete_name,team
)
select m.*,l.age_group,l.bracket_weight_lbs,
  floor(l.bracket_weight_lbs/10)::integer*10 weight_bucket,
  null::smallint division_birth_year_start,null::smallint division_birth_year_end,
  50::smallint confidence_score,'limited'::text confidence_label,'recent_events'::text evidence_type
from metadata m left join labels l using (athlete_key);
revoke all on public.wrestler_cohort_current from public,authenticated;
grant select on public.wrestler_cohort_current to anon,service_role;

create or replace view public.wrestler_strength_current with (security_invoker=true) as
with cohort_evidence as (
 select * from public.wrestler_cohort_current where age_group is not null and bracket_weight_lbs is not null
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
  bracket_weight_lbs::numeric(5,2) as bracket_weight_lbs, evidence_date, confidence_score, confidence_label, evidence_type,
  model_id, model_version, as_of_date,
  rating, rating_deviation, volatility, conservative_score, rating_status,
  match_count, wins, losses, last_match_date,
  case
    when cohort_max = cohort_min then 1000.00
    else round((conservative_score - cohort_min) / nullif(cohort_max - cohort_min, 0) * 1000, 2)
  end as strength_score,
  cohort_rank, cohort_size
from normalized;


commit;
