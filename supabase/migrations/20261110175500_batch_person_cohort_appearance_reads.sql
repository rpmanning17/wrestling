begin;
create temporary table person_cohort_before on commit drop as select * from public.person_cohort_current;
create or replace function public.current_person_cohorts(target_age integer default null)
returns table (athlete_key text, athlete_name text, team text, evidence_date date, age_group text,
 bracket_weight_lbs numeric, weight_bucket integer, division_birth_year_start smallint,
 division_birth_year_end smallint, confidence_score smallint, confidence_label text,
 evidence_type text, tier_eligible boolean)
language plpgsql stable security invoker set search_path='' as $function$
begin return query execute $cohort$
with nonmatch_inputs as materialized (select * from private.person_cohort_inputs where source_rank<>1),
 candidate_keys as materialized (
 select distinct athlete_key from nonmatch_inputs where age_value=$1
 union
 select a.person_id::text from private.match_cohort_appearances p cross join lateral (
 select a.person_id from public.source_identity_current_rows a
 where a.source_id=p.source_match_id::text and a.source_kind=case p.side when 'winner' then 'match_winner' else 'match_loser' end offset 0
 ) a where p.age_group=($1::text||'U') and a.person_id is not null
), eligible_keys as materialized(select athlete_key from candidate_keys),
 raw as materialized (
 select distinct athlete_key,athlete_name,team,event_date,event_name,age_group,bracket_weight_lbs,weigh_in_lbs,source_rank from (
 select r.athlete_key,r.athlete_name,r.team,r.event_date,r.event_name,r.age_group,r.bracket_weight_lbs,r.weigh_in_lbs,r.source_rank
 from nonmatch_inputs r where $1 is null or r.athlete_key in(select athlete_key from eligible_keys)
 union all
 select r.athlete_key,r.athlete_name,r.team,r.event_date,r.event_name,r.age_group,r.bracket_weight_lbs,r.weigh_in_lbs,r.source_rank
 from private.person_cohort_inputs r where $1 is null and r.source_rank=1
 union all
 select a.person_id::text,p.athlete_name,p.team,p.event_date,p.event_name,p.age_group,p.bracket_weight_lbs,null,1
 from eligible_keys k cross join lateral (
 select a.person_id,a.source_kind,array_agg(a.source_id::uuid) match_ids
 from public.source_identity_current_rows a
 where a.person_id=k.athlete_key::uuid and a.source_kind in('match_winner','match_loser')
 and a.source_id~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 group by a.person_id,a.source_kind offset 0
 ) a cross join lateral (
 select p.* from private.match_cohort_appearances p
 where p.source_match_id=any(a.match_ids)
 and p.side=case a.source_kind when 'match_winner' then 'winner' else 'loser' end offset 0
 ) p where $1 is not null
 ) inputs
), event_labels as materialized (
 select event_name,regexp_replace(lower(trim(event_name)), '\s+', ' ', 'g') normalized_event
 from (select distinct event_name from raw where trim(event_name)<>'') e
), canonical_all as materialized (
  select r.athlete_key,p.display_name athlete_name,r.team,r.event_date,
    el.normalized_event event_name,
    r.age_group,r.bracket_weight_lbs,r.weigh_in_lbs,r.source_rank
  from raw r join event_labels el on el.event_name=r.event_name join public.wrestler_people p on p.id=r.athlete_key::uuid
  where trim(r.event_name)<>''
), canonical as materialized (
 select * from canonical_all c where $1 is null or c.athlete_key in (
  select a.athlete_key from canonical_all a
  where nullif(regexp_replace(coalesce(a.age_group,''),'[^0-9]','','g'),'')::numeric=$1
 )
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
  select *,count(*) over (partition by athlete_key,field,score) score_ties, row_number() over (partition by athlete_key,field order by score desc,newest,value) place from totals
), labels as materialized (
  select athlete_key,max(value) filter(where field='age')::integer || 'U' age_group,
    max(value) filter(where field='weight') bracket_weight_lbs,
    bool_and(score_ties=1) and count(*)=2 tier_eligible from winners where place=1 group by 1
), metadata as materialized (
  select distinct on (athlete_key) athlete_key,athlete_name,team,latest_date evidence_date
  from recent order by athlete_key,latest_date desc,source_rank desc,athlete_name,team
)
select coalesce(m.athlete_key,l.athlete_key) athlete_key,m.athlete_name,m.team,m.evidence_date,l.age_group,l.bracket_weight_lbs,
  floor(l.bracket_weight_lbs/10)::integer*10 weight_bucket,
  null::smallint division_birth_year_start,null::smallint division_birth_year_end,
  50::smallint confidence_score,'limited'::text confidence_label,'recent_events'::text evidence_type,coalesce(l.tier_eligible,false) tier_eligible
from metadata m full join labels l using (athlete_key);


$cohort$ using target_age; end $function$;

do $verify$ begin
 if exists((select * from person_cohort_before except select * from public.person_cohort_current)
 union all(select * from public.person_cohort_current except select * from person_cohort_before))
 then raise exception 'Batched person reads changed cohort output'; end if;
end $verify$;
notify pgrst,'reload schema';
commit;

