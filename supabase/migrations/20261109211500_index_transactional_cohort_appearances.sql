begin;
lock table public.matches in share row exclusive mode;
create temporary table name_cohort_before on commit drop as select * from public.wrestler_cohort_current;
create temporary table person_cohort_before on commit drop as select * from public.person_cohort_current;
create temporary table standing_before on commit drop as select * from public.wrestler_strength_current;

-- Exact per-source-side projection, maintained in the SAME source transaction.
-- This is not an asynchronously refreshed result cache. Raw bouts remain intact.
create table private.match_cohort_appearances (
 source_match_id uuid not null references public.matches(id) on delete cascade,
 side text not null check(side in ('winner','loser')),
 athlete_name text not null, team text, event_date date not null, event_name text not null,
 age_group text, bracket_weight_lbs numeric,
 athlete_key text generated always as (lower(trim(athlete_name))) stored,
 age_value numeric generated always as (nullif(regexp_replace(coalesce(age_group,''),'[^0-9]','','g'),'')::numeric) stored,
 primary key(source_match_id,side)
);
create index match_cohort_athlete_idx on private.match_cohort_appearances(athlete_key);
create index match_cohort_age_idx on private.match_cohort_appearances(age_value,athlete_key);
alter table private.match_cohort_appearances enable row level security;
revoke all on private.match_cohort_appearances from public,anon,authenticated,service_role;
grant select on private.match_cohort_appearances to anon;
create policy personal_app_read_match_cohort_appearances on private.match_cohort_appearances
 for select to anon using ((select private.personal_app_request_is_valid()));

create function private.sync_match_cohort_appearances()
returns trigger language plpgsql security definer set search_path='' as $sync$
begin
 if TG_OP='DELETE' then
  delete from private.match_cohort_appearances where source_match_id=OLD.id;
  return OLD;
 end if;
 delete from private.match_cohort_appearances where source_match_id=NEW.id;
 insert into private.match_cohort_appearances(source_match_id,side,athlete_name,team,event_date,event_name,age_group,bracket_weight_lbs)
 select NEW.id,p.side,p.name,p.team,NEW.event_date,NEW.event_name,
 (regexp_match(NEW.weight_class,'(?<![0-9])(6|8|10|12|14|16|18) ?[uU](?![a-zA-Z])'))[1]||'U',
 substring(NEW.weight_class from '([0-9]+(?:[.][0-9]+)?)[^0-9]*$')::numeric
 from (values ('winner',NEW.winner_name,NEW.winner_team),('loser',NEW.loser_name,NEW.loser_team)) p(side,name,team);
 return NEW;
end $sync$;
revoke all on function private.sync_match_cohort_appearances() from public,anon,authenticated,service_role;
insert into private.match_cohort_appearances(source_match_id,side,athlete_name,team,event_date,event_name,age_group,bracket_weight_lbs)
select m.id,p.side,p.name,p.team,m.event_date,m.event_name,
 (regexp_match(m.weight_class,'(?<![0-9])(6|8|10|12|14|16|18) ?[uU](?![a-zA-Z])'))[1]||'U',
 substring(m.weight_class from '([0-9]+(?:[.][0-9]+)?)[^0-9]*$')::numeric
from public.matches m cross join lateral
 (values ('winner',m.winner_name,m.winner_team),('loser',m.loser_name,m.loser_team)) p(side,name,team);
create trigger sync_match_cohort_appearances
 after insert or update or delete on public.matches
 for each row execute function private.sync_match_cohort_appearances();

create view private.name_cohort_inputs with (security_invoker=true) as
select lower(trim(r.athlete_name)) athlete_key,r.*,
 nullif(regexp_replace(coalesce(r.age_group,''),'[^0-9]','','g'),'')::numeric age_value
from (
 select athlete_name,team,event_date,event_name,age_group,bracket_weight_lbs,weigh_in_lbs,4 source_rank from public.tournament_entries
 union all select athlete_name,team,event_date,event_name,age_group,
 coalesce(bracket_weight_lbs,substring(bracket_weight_label from '([0-9]+(?:[.][0-9]+)?)[^0-9]*$')::numeric),null,3
 from public.tournament_observations where identity_resolution in ('exact_existing','new_identity')
 union all select athlete_name,team,event_date,event_name,age_group,bracket_weight_lbs,null,2 from public.wrestler_evidence
) r
union all
select athlete_key,athlete_name,team,event_date,event_name,age_group,bracket_weight_lbs,null,1,age_value
from private.match_cohort_appearances;

create view private.person_cohort_inputs with (security_invoker=true) as
select r.*,nullif(regexp_replace(coalesce(r.age_group,''),'[^0-9]','','g'),'')::numeric age_value
from (
 select e.person_id::text athlete_key,e.athlete_name,e.team,e.event_date,e.event_name,e.age_group,e.bracket_weight_lbs,e.weigh_in_lbs,4 source_rank
 from public.person_tournament_entries e where e.person_id is not null
 union all
 select o.person_id::text,o.athlete_name,o.team,o.event_date,o.event_name,o.age_group,
 coalesce(o.bracket_weight_lbs,substring(o.bracket_weight_label from '([0-9]+(?:[.][0-9]+)?)[^0-9]*$')::numeric),null,3
 from public.person_tournament_observations o where o.person_id is not null and o.identity_resolution in ('exact_existing','new_identity')
 union all
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
) r
union all
select a.person_id::text,p.athlete_name,p.team,p.event_date,p.event_name,p.age_group,p.bracket_weight_lbs,null,1,p.age_value
from private.match_cohort_appearances p join public.source_identity_current_rows a
 on a.source_id=p.source_match_id::text and a.source_kind=case p.side when 'winner' then 'match_winner' else 'match_loser' end
where a.person_id is not null;
revoke all on private.name_cohort_inputs,private.person_cohort_inputs from public,anon,authenticated,service_role;
grant select on private.name_cohort_inputs,private.person_cohort_inputs to anon;
create or replace function public.current_wrestler_cohorts(target_age integer default null)
returns table (athlete_key text, athlete_name text, team text, evidence_date date, age_group text,
 bracket_weight_lbs numeric, weight_bucket integer, division_birth_year_start smallint,
 division_birth_year_end smallint, confidence_score smallint, confidence_label text,
 evidence_type text, tier_eligible boolean)
language plpgsql stable security invoker set search_path='' as $function$
begin
 return query execute $cohort$
with candidate_keys as materialized (select distinct coalesce(a.canonical_key,i.athlete_key) athlete_key from private.name_cohort_inputs i left join public.wrestler_aliases a on a.alias_key=i.athlete_key where i.age_value=$1),
 eligible_keys as materialized (select athlete_key from candidate_keys union select a.alias_key from public.wrestler_aliases a join candidate_keys k on k.athlete_key=a.canonical_key),
 raw as materialized (
 select distinct r.athlete_name,r.team,r.event_date,r.event_name,r.age_group,r.bracket_weight_lbs,r.weigh_in_lbs,r.source_rank
 from private.name_cohort_inputs r where $1 is null or r.athlete_key in (select athlete_key from eligible_keys)
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
language plpgsql stable security invoker set search_path='' as $function$
begin
 return query execute $cohort$
with candidate_keys as materialized (select distinct athlete_key from private.person_cohort_inputs where age_value=$1),
 eligible_keys as materialized (select athlete_key from candidate_keys),
 raw as materialized (
 select distinct r.athlete_key,r.athlete_name,r.team,r.event_date,r.event_name,r.age_group,r.bracket_weight_lbs,r.weigh_in_lbs,r.source_rank
 from private.person_cohort_inputs r where $1 is null or r.athlete_key in (select athlete_key from eligible_keys)
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

analyze private.match_cohort_appearances;
do $verify$
begin
 if (select count(*) from private.match_cohort_appearances) <> 2*(select count(*) from public.matches)
 or exists ((select * from name_cohort_before except select * from public.wrestler_cohort_current)
 union all (select * from public.wrestler_cohort_current except select * from name_cohort_before))
 or exists ((select * from person_cohort_before except select * from public.person_cohort_current)
 union all (select * from public.person_cohort_current except select * from person_cohort_before))
 or exists ((select * from standing_before except select * from public.wrestler_strength_current)
 union all (select * from public.wrestler_strength_current except select * from standing_before))
 then raise exception 'Appearance projection changed source coverage or cohort output'; end if;
end $verify$;
notify pgrst,'reload schema';
commit;

