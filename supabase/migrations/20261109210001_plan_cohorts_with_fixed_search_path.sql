begin;
create or replace function public.current_wrestler_cohorts(target_age integer default null)
returns table (athlete_key text, athlete_name text, team text, evidence_date date, age_group text,
 bracket_weight_lbs numeric, weight_bucket integer, division_birth_year_start smallint,
 division_birth_year_end smallint, confidence_score smallint, confidence_label text,
 evidence_type text, tier_eligible boolean)
language plpgsql stable security invoker set search_path = '' as $function$
begin
 -- EXECUTE plans this static query with the actual age on every call, avoiding
 -- a generic nullable-parameter plan while keeping a fixed safe search_path.
 return query execute $cohort$
with match_labels as materialized (
  select distinct coalesce(weight_class,'') as weight_class from public.matches
), parsed_match_labels as materialized (
  select weight_class,
    (regexp_match(weight_class, '(?<![0-9])(6|8|10|12|14|16|18) ?[uU](?![a-zA-Z])'))[1] || 'U' as age_group,
    substring(weight_class from '([0-9]+(?:[.][0-9]+)?)[^0-9]*$')::numeric as bracket_weight_lbs
  from match_labels
), raw as materialized (
  select athlete_name, team, event_date, event_name, age_group,
    bracket_weight_lbs, weigh_in_lbs, 4 as source_rank from public.tournament_entries
  union
  select athlete_name, team, event_date, event_name, age_group,
    coalesce(bracket_weight_lbs, substring(bracket_weight_label from '([0-9]+(?:[.][0-9]+)?)[^0-9]*$')::numeric), null, 3
    from public.tournament_observations where identity_resolution in ('exact_existing','new_identity')
  union
  select athlete_name, team, event_date, event_name, age_group, bracket_weight_lbs, null, 2
    from public.wrestler_evidence
  union
  select p.name,p.team,m.event_date,m.event_name,l.age_group,l.bracket_weight_lbs,null,1
  from public.matches m join parsed_match_labels l on l.weight_class=coalesce(m.weight_class,'')
  cross join lateral (values (m.winner_name,m.winner_team),(m.loser_name,m.loser_team)) p(name,team)
), event_labels as materialized (
  select event_name,regexp_replace(lower(trim(event_name)), '\s+', ' ', 'g') as normalized_event
  from (select distinct event_name from raw where trim(event_name)<>'') e
), canonical_all as materialized (
  select distinct coalesce(a.canonical_key,lower(trim(r.athlete_name))) athlete_key,
    coalesce(a.canonical_name,r.athlete_name) athlete_name, r.team,r.event_date,
    e.normalized_event event_name,
    r.age_group,r.bracket_weight_lbs,r.weigh_in_lbs,r.source_rank
  from raw r join event_labels e on e.event_name=r.event_name left join public.wrestler_aliases a on a.alias_key=lower(trim(r.athlete_name))
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
), classified as materialized (
select coalesce(m.athlete_key,l.athlete_key) athlete_key,m.athlete_name,m.team,m.evidence_date,l.age_group,l.bracket_weight_lbs,
  floor(l.bracket_weight_lbs/10)::integer*10 weight_bucket,
  null::smallint division_birth_year_start,null::smallint division_birth_year_end,
  50::smallint confidence_score,'limited'::text confidence_label,'recent_events'::text evidence_type,coalesce(l.tier_eligible,false) tier_eligible
from metadata m full join labels l using (athlete_key)
)
select * from classified;

$cohort$ using target_age;
end $function$;
create or replace function public.current_person_cohorts(target_age integer default null)
returns table (athlete_key text, athlete_name text, team text, evidence_date date, age_group text,
 bracket_weight_lbs numeric, weight_bucket integer, division_birth_year_start smallint,
 division_birth_year_end smallint, confidence_score smallint, confidence_label text,
 evidence_type text, tier_eligible boolean)
language plpgsql stable security invoker set search_path = '' as $function$
begin
 -- EXECUTE plans this static query with the actual age on every call, avoiding
 -- a generic nullable-parameter plan while keeping a fixed safe search_path.
 return query execute $cohort$
with match_labels as materialized (
 select distinct coalesce(weight_class,'') weight_class from public.matches
), parsed_match_labels as materialized (
 select weight_class,
 (regexp_match(weight_class, '(?<![0-9])(6|8|10|12|14|16|18) ?[uU](?![a-zA-Z])'))[1] || 'U' age_group,
 substring(weight_class from '([0-9]+(?:[.][0-9]+)?)[^0-9]*$')::numeric bracket_weight_lbs
 from match_labels
), raw as materialized (
  select e.person_id::text athlete_key,e.athlete_name,e.team,e.event_date,e.event_name,e.age_group,
    e.bracket_weight_lbs,e.weigh_in_lbs,4 as source_rank
  from public.person_tournament_entries e where e.person_id is not null
  union
  select o.person_id::text,o.athlete_name,o.team,o.event_date,o.event_name,o.age_group,
    coalesce(o.bracket_weight_lbs,substring(o.bracket_weight_label from '([0-9]+(?:[.][0-9]+)?)[^0-9]*$')::numeric),null,3
  from public.person_tournament_observations o
  where o.person_id is not null and o.identity_resolution in ('exact_existing','new_identity')
  union
  select coalesce(entry.person_id,
      case when lower(trim(e.athlete_name))=lower(trim(m.winner_name)) then m.winner_person_id end,
      case when lower(trim(e.athlete_name))=lower(trim(m.loser_name)) then m.loser_person_id end)::text,
    e.athlete_name,e.team,e.event_date,e.event_name,e.age_group,e.bracket_weight_lbs,null,2
  from public.wrestler_evidence e
  left join public.person_tournament_entries entry on entry.id=e.source_entry_id
  left join public.person_matches m on m.id=e.source_match_id
  where coalesce(entry.person_id,
      case when lower(trim(e.athlete_name))=lower(trim(m.winner_name)) then m.winner_person_id end,
      case when lower(trim(e.athlete_name))=lower(trim(m.loser_name)) then m.loser_person_id end) is not null
  union
  select p.person_id::text,p.name,p.team,m.event_date,m.event_name,
    l.age_group,l.bracket_weight_lbs,null,1
  from public.person_matches m join parsed_match_labels l on l.weight_class=coalesce(m.weight_class,'') cross join lateral
    (values (m.winner_name,m.winner_team,m.winner_person_id),
            (m.loser_name,m.loser_team,m.loser_person_id)) p(name,team,person_id)
  where p.person_id is not null
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

$cohort$ using target_age;
end $function$;
notify pgrst, 'reload schema';
commit;

