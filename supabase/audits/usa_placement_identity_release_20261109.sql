-- ONE-TIME USA Bracketing placement identity reconciliation.
-- A placement may link only to a verified, person-assigned bout with the exact
-- source event, date, athlete and ORIGINAL bracket label. Club abbreviations
-- are not relied upon. Unmatched placements remain ambiguous.
begin;
lock table public.matches in share mode;
do $release$
declare dec uuid; batch uuid; payload jsonb; i integer; written integer;
begin
 if exists(select 1 from public.rating_models where status='active' and identity_scheme='person_uuid')
 or (select count(*) from public.tournament_observations where source_filter_id like 'usab:%')<>648
 or (select count(*) from public.source_identity_current_rows a join public.tournament_observations o
   on o.id::text=a.source_id where o.source_filter_id like 'usab:%'
   and a.source_kind='tournament_observation' and a.revision=1 and a.person_id is null)<>648
 then raise exception 'Placement release baseline changed';end if;

 create temporary table tmp_usa_placement_links on commit drop as
 with sides as (
 select m.event_date,m.event_name,m.weight_class,m.winner_name as name,a.person_id
 from public.matches m join public.source_identity_current_rows a
 on a.source_kind='match_winner' and a.source_id=m.id::text
 where m.source_file like 'usabracketing/%' and a.person_id is not null
 union all
 select m.event_date,m.event_name,m.weight_class,m.loser_name,a.person_id
 from public.matches m join public.source_identity_current_rows a
 on a.source_kind='match_loser' and a.source_id=m.id::text
 where m.source_file like 'usabracketing/%' and a.person_id is not null
 )
 select o.id::text source_id,o.athlete_name recorded_name,
 count(distinct s.person_id) candidate_count,
 min(s.person_id::text)::uuid person_id
 from public.tournament_observations o left join sides s
 on s.event_date=o.event_date
 and lower(trim(s.event_name))=lower(trim(o.event_name))
 and lower(trim(s.name))=lower(trim(o.athlete_name))
 and lower(trim(s.weight_class))=lower(trim(o.bracket_weight_label))
 where o.source_filter_id like 'usab:%'
 group by o.id,o.athlete_name;

 if (select count(*) from tmp_usa_placement_links)<>648
 or (select count(*) from tmp_usa_placement_links where candidate_count=1)<>491
 then raise exception 'Unexpected placement identity candidates';end if;

 insert into public.identity_decisions(authority,disposition,evidence,source_checksum,rationale)
 values ('source_evidenced','same_person',
 '{"provider":"USA Bracketing","matching":"same verified event name, date, athlete name, and full bracket label, with exactly one reviewed person ID","club_alias_guessing":false}'::jsonb,
 '157766803897108e88c96b5440ed28eb330f216370dd30b4e5bafe82cfc57ddc',
 'Source-specific placement identity supported by a person-assigned published match within precisely the same bracket')
 returning id into dec;
 for i in 0..1 loop
  select jsonb_agg(jsonb_build_object('source_kind','tournament_observation',
    'source_id',p.source_id,'recorded_name',p.recorded_name,
    'person_id',p.person_id,'decision_id',dec,'expected_revision',1))
  into payload from (select source_id,recorded_name,person_id from tmp_usa_placement_links
    where candidate_count=1 order by source_id limit 400 offset i*400) p;
  if payload is null then raise exception 'Empty placement batch';end if;
  insert into public.identity_assignment_batches(decision_id) values(dec) returning id into batch;
  written:=private.apply_identity_batch(batch,payload);
  if written<>jsonb_array_length(payload) then raise exception 'Incomplete placement batch';end if;
 end loop;
 update public.tournament_observations o set identity_resolution='exact_existing'
 from tmp_usa_placement_links p where o.id::text=p.source_id and p.candidate_count=1
 and o.identity_resolution='ambiguous';
 if (select count(*) from public.tournament_observations o where o.source_filter_id like 'usab:%'
    and o.identity_resolution='exact_existing')<>491
 then raise exception 'Placed wrestler evidence mismatch';end if;
end; $release$;
select count(*) as placements,
 count(*) filter(where a.person_id is not null) as linked,
 count(*) filter(where a.person_id is null) as unresolved
from public.source_identity_current_rows a join public.tournament_observations o
on o.id::text=a.source_id where o.source_filter_id like 'usab:%' and a.source_kind='tournament_observation';
commit;
