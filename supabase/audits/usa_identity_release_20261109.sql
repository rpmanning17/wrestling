-- ONE-TIME owner-authorized post-import identity reconciliation (2026-11-09).
-- Never re-run after a successful release. Every link is versioned and reversible.
-- Identical names alone are insufficient; ambiguous associations remain unresolved.
begin;
lock table public.matches in share mode;
do $release$
declare link_decision uuid; new_decision uuid; batch uuid; payload jsonb;
i integer; applied integer; counted integer;
begin
 if exists(select 1 from public.rating_models where status='active' and identity_scheme='person_uuid')
 or (select count(*) from public.matches where source_file like 'usabracketing/%')<>1047
 or (select count(*) from public.source_identity_current_rows a where a.source_kind in('match_winner','match_loser')
     and a.source_id in (select id::text from public.matches where source_file like 'usabracketing/%')
     and a.revision=1 and a.person_id is null)<>2094
 then raise exception 'USA identity baseline changed'; end if;

 create temporary table tmp_usa_link_base on commit drop as
 with new_sides as (
 select m.id::text source_id,'match_winner'::text source_kind,m.winner_name recorded_name,
 lower(trim(m.winner_name)) nk,lower(trim(m.winner_team)) team,m.event_date,m.event_name,
 (regexp_match(m.weight_class,'([0-9]+)(?:-[0-9]+)?$'))[1]::numeric wt,
 (regexp_match(m.weight_class,'(6|8|10|12|14)U','i'))[1]::int age
 from public.matches m where m.source_file like 'usabracketing/%'
 union all
 select m.id::text,'match_loser',m.loser_name,lower(trim(m.loser_name)),
 lower(trim(m.loser_team)),m.event_date,m.event_name,
 (regexp_match(m.weight_class,'([0-9]+)(?:-[0-9]+)?$'))[1]::numeric,
 (regexp_match(m.weight_class,'(6|8|10|12|14)U','i'))[1]::int
 from public.matches m where m.source_file like 'usabracketing/%'
 ), old_sides as (
 select lower(trim(a.recorded_name)) nk,a.person_id,m.event_date,
 (regexp_match(m.weight_class,'([0-9]+)$'))[1]::numeric wt,
 (regexp_match(m.weight_class,'(6|8|10|12|14)U','i'))[1]::int age
 from public.source_identity_current_rows a join public.matches m on a.source_id=m.id::text
 where a.source_kind in ('match_winner','match_loser') and a.person_id is not null
 and m.source_file not like 'usabracketing/%'
 ), old_names as (
 select nk,count(distinct person_id) num_people,min(person_id::text)::uuid one_person
 from old_sides group by 1
 ), linked as (
 select n.*,onm.num_people,onm.one_person,
 count(*) filter(where o.person_id is not null
   and n.wt is not null and o.wt is not null and abs(n.wt-o.wt)<=15
   and abs(n.event_date-o.event_date)<730
   and (o.age is null or n.age is null or abs(o.age-n.age)<=2)) compatible_rows
 from new_sides n left join old_names onm on onm.nk=n.nk
 left join old_sides o on o.nk=n.nk
 group by n.source_id,n.source_kind,n.recorded_name,n.nk,n.team,n.event_date,n.event_name,n.wt,n.age,
 onm.num_people,onm.one_person
 )
 select linked.*,coalesce(a.club_key,'raw:'||linked.team) club_key,
 null::uuid resolved_person,null::uuid decision_id
 from linked left join public.club_aliases a on a.alias_key=linked.team and a.relationship='alias';

 create temporary table tmp_usa_new_group on commit drop as
 select nk,club_key,min(recorded_name) display_name,gen_random_uuid() person_id,
 count(*) source_count,count(distinct event_date::text||'|'||event_name) event_count,
 max(wt)-min(wt) wt_span,max(age)-min(age) age_span,
 (max(age)-min(age)<=2 and max(wt)-min(wt)<=35
  and (bool_and(team<>'') or count(distinct event_date::text||'|'||event_name)=1
       and max(wt)-min(wt)<=15)) eligible
 from tmp_usa_link_base where num_people is null group by nk,club_key;

 if (select count(*) from tmp_usa_link_base)<>2094
 or (select count(*) from tmp_usa_new_group where eligible)<>230
 then raise exception 'Unexpected identity plan size'; end if;

 insert into public.identity_decisions(authority,disposition,evidence,source_checksum,rationale)
 values('source_evidenced','same_person',
 '{"provider":"USA Bracketing","rule":"one historical person with exact full name and at least two same-name bouts within 730 days and 15 pounds, compatible age when present","uncertain":"leave unassigned","source":"current versioned person assignments"}'::jsonb,
 '157766803897108e88c96b5440ed28eb330f216370dd30b4e5bafe82cfc57ddc',
 'Conservative unique-name identity supported by multiple age, time and weight-compatible historical results')
 returning id into link_decision;
 insert into public.identity_decisions(authority,disposition,evidence,source_checksum,rationale)
 values('agent_inferred','same_person',
 '{"provider":"USA Bracketing","rule":"unseen full name; new person grouped by name plus known club alias, or one-event unteamed name, with bounded age and weight","cross-club_merging":false}'::jsonb,
 '157766803897108e88c96b5440ed28eb330f216370dd30b4e5bafe82cfc57ddc',
 'Separate newly recorded people by original name and club, without guessing existing identities')
 returning id into new_decision;

 insert into public.wrestler_people(id,display_name)
 select person_id,display_name from tmp_usa_new_group where eligible;
 update tmp_usa_link_base b set resolved_person=one_person,decision_id=link_decision
 where b.num_people=1 and b.compatible_rows>=2;
 update tmp_usa_link_base b set resolved_person=g.person_id,decision_id=new_decision
 from tmp_usa_new_group g
 where b.nk=g.nk and b.club_key=g.club_key and g.eligible and b.num_people is null;

 update tmp_usa_link_base b set resolved_person=null,decision_id=null
 where exists(select 1 from tmp_usa_link_base other
  where other.source_id=b.source_id and other.source_kind<>b.source_kind
    and other.resolved_person=b.resolved_person and b.resolved_person is not null);

 select count(*) into counted from tmp_usa_link_base where resolved_person is not null;
 if counted<1800 or counted>1930 then raise exception 'Unexpected resolved side count %',counted;end if;

 for i in 0..((counted-1)/500) loop
  select jsonb_agg(jsonb_build_object(
     'source_kind',p.source_kind,'source_id',p.source_id,'recorded_name',p.recorded_name,
     'person_id',p.resolved_person,'decision_id',p.decision_id,'expected_revision',1))
  into payload from (select source_kind,source_id,recorded_name,resolved_person,decision_id
    from tmp_usa_link_base where resolved_person is not null
    order by source_id,source_kind limit 500 offset i*500) p;
  if payload is null then raise exception 'Missing identity batch %',i;end if;
  insert into public.identity_assignment_batches(decision_id)
  values(link_decision) returning id into batch;
  applied:=private.apply_identity_batch(batch,payload);
  if applied<>jsonb_array_length(payload) then raise exception 'Incomplete identity batch %',i;end if;
 end loop;
 if (select count(*) from public.source_identity_current_rows a where a.source_kind in('match_winner','match_loser')
    and a.source_id in (select id::text from public.matches where source_file like 'usabracketing/%')
    and a.person_id is not null)<>counted then
    raise exception 'Final identity ledger differs from plan'; end if;
end;
$release$;
select count(*) as source_sides,
 count(*) filter(where a.person_id is not null) as linked_sides,
 count(*) filter(where a.person_id is null) as held_sides,
 count(distinct a.person_id) filter(where a.person_id is not null) as unique_people
from public.source_identity_current_rows a
where a.source_kind in ('match_winner','match_loser')
and a.source_id in (select id::text from public.matches where source_file like 'usabracketing/%');
commit;
