begin;
-- Serializes only source/assignment writes; reads remain concurrent.
select pg_advisory_xact_lock(194260711,1);
lock table public.matches,public.source_identity_current_rows in share row exclusive mode;
create temporary table person_cohort_before on commit drop as select * from public.person_cohort_current;
alter table private.match_cohort_appearances add column person_id uuid;
create function private.lock_cohort_identity_writes() returns trigger
language plpgsql security definer set search_path='' as $lock$
begin perform pg_advisory_xact_lock(194260711,1); return null; end $lock$;
revoke all on function private.lock_cohort_identity_writes() from public,anon,authenticated,service_role;
create trigger lock_cohort_match_writes before insert or update or delete on public.matches
 for each statement execute function private.lock_cohort_identity_writes();
create trigger lock_cohort_assignment_writes before insert or update or delete on public.source_identity_current_rows
 for each statement execute function private.lock_cohort_identity_writes();

create function private.attach_cohort_person() returns trigger
language plpgsql security definer set search_path='' as $attach$
begin
 select a.person_id into NEW.person_id from public.source_identity_current_rows a
 where a.source_id=NEW.source_match_id::text
 and a.source_kind=case NEW.side when 'winner' then 'match_winner' else 'match_loser' end;
 return NEW;
end $attach$;
revoke all on function private.attach_cohort_person() from public,anon,authenticated,service_role;
create trigger attach_cohort_person before insert or update of source_match_id,side on private.match_cohort_appearances
 for each row execute function private.attach_cohort_person();

create function private.sync_cohort_assignment() returns trigger
language plpgsql security definer set search_path='' as $assign$
begin
 if TG_OP<>'INSERT' and OLD.source_kind in('match_winner','match_loser')
 and OLD.source_id~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  update private.match_cohort_appearances p set person_id=(
   select a.person_id from public.source_identity_current_rows a
   where a.source_kind=OLD.source_kind and a.source_id=OLD.source_id)
  where p.source_match_id=OLD.source_id::uuid and p.side=case OLD.source_kind when 'match_winner' then 'winner' else 'loser' end;
 end if;
 if TG_OP<>'DELETE' and NEW.source_kind in('match_winner','match_loser')
 and NEW.source_id~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  update private.match_cohort_appearances p set person_id=NEW.person_id
  where p.source_match_id=NEW.source_id::uuid and p.side=case NEW.source_kind when 'match_winner' then 'winner' else 'loser' end;
 end if;
 return null;
end $assign$;
revoke all on function private.sync_cohort_assignment() from public,anon,authenticated,service_role;
create trigger sync_cohort_assignment after insert or update or delete on public.source_identity_current_rows
 for each row execute function private.sync_cohort_assignment();

update private.match_cohort_appearances p set person_id=a.person_id
from public.source_identity_current_rows a
where a.source_id=p.source_match_id::text
and a.source_kind=case p.side when 'winner' then 'match_winner' else 'match_loser' end;
create index match_cohort_person_covering_idx on private.match_cohort_appearances(person_id)
 include(source_match_id,side,athlete_name,team,event_date,event_name,age_group,bracket_weight_lbs);
create or replace view private.person_cohort_inputs with(security_invoker=true) as
select r.*,nullif(regexp_replace(coalesce(r.age_group,''),'[^0-9]','','g'),'')::numeric age_value
from (
 select e.person_id::text athlete_key,e.athlete_name,e.team,e.event_date,e.event_name,e.age_group,e.bracket_weight_lbs,e.weigh_in_lbs,4 source_rank
 from public.person_tournament_entries e where e.person_id is not null
 union all
 select o.person_id::text,o.athlete_name,o.team,o.event_date,o.event_name,o.age_group,
 coalesce(o.bracket_weight_lbs,substring(o.bracket_weight_label from '([0-9]+(?:[.][0-9]+)?)[^0-9]*$')::numeric),null,3
 from public.person_tournament_observations o where o.person_id is not null and o.identity_resolution in ('exact_existing','new_identity')
 union all
 select coalesce(entry_assignment.person_id,
 case when lower(trim(e.athlete_name))=lower(trim(m.winner_name)) then winner.person_id end,
 case when lower(trim(e.athlete_name))=lower(trim(m.loser_name)) then loser.person_id end)::text,
 e.athlete_name,e.team,e.event_date,e.event_name,e.age_group,e.bracket_weight_lbs,null,2
 from public.wrestler_evidence e
 left join public.tournament_entries entry on entry.id=e.source_entry_id
 left join public.matches m on m.id=e.source_match_id
 left join public.source_identity_current_rows entry_assignment on entry_assignment.source_kind='tournament_entry' and entry_assignment.source_id=entry.id::text
 left join public.source_identity_current_rows winner on winner.source_kind='match_winner' and winner.source_id=m.id::text
 left join public.source_identity_current_rows loser on loser.source_kind='match_loser' and loser.source_id=m.id::text
 where coalesce(entry_assignment.person_id,
 case when lower(trim(e.athlete_name))=lower(trim(m.winner_name)) then winner.person_id end,
 case when lower(trim(e.athlete_name))=lower(trim(m.loser_name)) then loser.person_id end) is not null
) r
union all
select p.person_id::text,p.athlete_name,p.team,p.event_date,p.event_name,p.age_group,p.bracket_weight_lbs,null,1,p.age_value
from private.match_cohort_appearances p where p.person_id is not null;
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
 select p.person_id::text from private.match_cohort_appearances p where p.age_group=($1::text||'U') and p.person_id is not null
), eligible_keys as materialized(select athlete_key from candidate_keys),
 raw as materialized (
 select distinct athlete_key,athlete_name,team,event_date,event_name,age_group,bracket_weight_lbs,weigh_in_lbs,source_rank from (
 select r.athlete_key,r.athlete_name,r.team,r.event_date,r.event_name,r.age_group,r.bracket_weight_lbs,r.weigh_in_lbs,r.source_rank
 from nonmatch_inputs r where $1 is null or r.athlete_key in(select athlete_key from eligible_keys)
 union all
 select r.athlete_key,r.athlete_name,r.team,r.event_date,r.event_name,r.age_group,r.bracket_weight_lbs,r.weigh_in_lbs,r.source_rank
 from private.person_cohort_inputs r where $1 is null and r.source_rank=1
 union all
 select p.person_id::text,p.athlete_name,p.team,p.event_date,p.event_name,p.age_group,p.bracket_weight_lbs,null,1
 from private.match_cohort_appearances p
 where $1 is not null and p.person_id=any(array(select k.athlete_key::uuid from eligible_keys k))
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
 then raise exception 'Person projection changed cohort output'; end if;
 if exists(select 1 from private.match_cohort_appearances p left join public.source_identity_current_rows a
 on a.source_id=p.source_match_id::text and a.source_kind=case p.side when 'winner' then 'match_winner' else 'match_loser' end
 where p.person_id is distinct from a.person_id) then raise exception 'Person projection differs from current assignments';end if;
end $verify$;
analyze private.match_cohort_appearances;
notify pgrst,'reload schema';
commit;

