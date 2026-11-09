-- Browser-collected USA Bracketing placements are source evidence, never matches.
-- Keep unsupported gender labels in the private review table; never guess boys/girls.
begin;

alter table public.tournament_observations
  drop constraint tournament_observations_extraction_method_check;
alter table public.tournament_observations
  add constraint tournament_observations_extraction_method_check
    check (extraction_method in ('screenshot_only','screenshot_and_live_table','browser_table_capture'));

create function private.import_usa_bracketing_placements(payload jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  x jsonb; src jsonb; proposed jsonb; previous private.usa_bracketing_placement_evidence%rowtype;
  obs public.tournament_observations%rowtype; obsid bigint; entered integer := 0;
  source_gender text; label text; found_age text;
begin
  if jsonb_typeof(payload) is distinct from 'array'
     or jsonb_array_length(payload) not between 1 and 100 then
    raise exception 'Expected 1..100 placement evidence items';
  end if;
  lock table public.tournament_observations in share row exclusive mode;
  for x in select value from jsonb_array_elements(payload) loop
    src := x->'raw'; proposed := x->'observation';
    if src is null
       or x->>'evidence_key' !~ '^[a-f0-9]{64}$'
       or x->>'pack' not in ('youth','collector','melbourne')
       or x->>'archive_sha' !~ '^[a-f0-9]{64}$'
       or x->>'event_id' <> src->>'verified_event_id'
       or src->>'disposition' <> 'youth_placement_separate_evidence_not_imported'
       or src->>'weight_class_original' is null
       or src->>'placement_raw_original' is null
       or src->>'bracket_url' not like '%/events/'||(x->>'event_id')||'/brackets/%'
       or (src->>'parsed_rank')::integer < 1
       or src->>'parsed_name' = '' then
      raise exception 'Invalid USA placement evidence item %',x->>'evidence_key';
    end if;
    label := src->>'weight_class_original';
    if label !~* '(^|[^0-9])((6|8|10|12|14)U|U(6|8|10|12|14))([^0-9]|$)'
       or label ~* '(16U|18U|junior|adult|high school|varsity)' then
       raise exception 'Non-youth placement label';
    end if;
    found_age := src->>'age_group_label';
    if found_age not in ('6U','8U','10U','12U','14U') then
       raise exception 'Unverified age label';
    end if;
    source_gender := case when label ~* '(^|[^A-Za-z])boys([^A-Za-z]|$)' then 'boys'
                          when label ~* '(^|[^A-Za-z])girls([^A-Za-z]|$)' then 'girls'
                          else null end;
    if proposed is null or proposed = 'null'::jsonb then
      if source_gender is not null then raise exception 'Explicit gender placement missing public observation'; end if;
    else
      if source_gender is null or proposed->>'division_gender' <> source_gender
         or proposed->>'source_filter_id' <> 'usab:'||src->>'verified_bracket_id'
         or proposed->>'division_label' <> label
         or proposed->>'bracket_weight_label' <> label
         or proposed->>'source_zip_sha256' <> upper(x->>'archive_sha')
         or proposed->>'source_athlete_name' <> src->>'parsed_name'
         or proposed->>'athlete_name' <> src->>'parsed_name'
         or proposed->>'team' <> src->>'parsed_team'
         or (proposed->>'placement')::integer <> (src->>'parsed_rank')::integer
         or proposed->>'age_group' <> found_age
         or proposed->>'identity_resolution' <> 'ambiguous'
         or proposed->>'extraction_method' <> 'browser_table_capture'
         or proposed ? 'bracket_weight_lbs'
         or proposed ? 'eligibility_birth_year_start'
         or proposed ? 'eligibility_birth_year_end' then
         raise exception 'Source placement to public observation mismatch';
      end if;
    end if;

    select * into previous from private.usa_bracketing_placement_evidence
       where evidence_key=x->>'evidence_key';
    if found then
      if previous.provider_event_id <> (x->>'event_id')::uuid
         or previous.source_pack <> x->>'pack'
         or previous.archive_sha256 <> x->>'archive_sha'
         or previous.original_record <> src then
         raise exception 'Conflicting original placement source %',x->>'evidence_key';
      end if;
    end if;
    obsid := null;
    if proposed is not null and proposed <> 'null'::jsonb then
      select * into obs from public.tournament_observations
      where source_filter_id=proposed->>'source_filter_id'
        and bracket_weight_label=proposed->>'bracket_weight_label'
        and placement=(proposed->>'placement')::smallint
        and athlete_name=proposed->>'athlete_name';
      if found then
         if obs.event_date::text <> proposed->>'event_date'
           or obs.event_name <> proposed->>'event_name'
           or obs.team <> proposed->>'team'
           or obs.division_label <> proposed->>'division_label'
           or obs.division_gender <> proposed->>'division_gender'
           or obs.age_group <> proposed->>'age_group'
           or obs.source_zip_sha256 <> proposed->>'source_zip_sha256'
           or obs.extraction_method <> 'browser_table_capture'
           or obs.identity_resolution <> 'ambiguous'
           or obs.bracket_weight_lbs is not null
           or obs.eligibility_birth_year_start is not null then
            raise exception 'Conflicting previously recorded placement';
         end if;
         obsid := obs.id;
      else
        select coalesce(max(id),0)+1 into obsid from public.tournament_observations;
        insert into public.tournament_observations (
          id,event_date,event_end_date,event_name,city,state,athlete_name,team,
          division_label,division_gender,division_basis,age_group,experience_division,
          bracket_weight_label,weight_evidence_kind,placement,placement_verified,
          identity_resolution,source_filter_id,source_placers_file,source_weight_file,
          source_zip_sha256,extraction_method,confidence,notes,source_athlete_name)
        values (
          obsid,(proposed->>'event_date')::date,(proposed->>'event_end_date')::date,
          proposed->>'event_name',proposed->>'city',proposed->>'state',
          proposed->>'athlete_name',proposed->>'team',proposed->>'division_label',
          proposed->>'division_gender',proposed->>'division_basis',proposed->>'age_group',
          proposed->>'experience_division',proposed->>'bracket_weight_label',
          'bracket_class',(proposed->>'placement')::smallint,true,'ambiguous',
          proposed->>'source_filter_id',proposed->>'source_placers_file',
          proposed->>'source_weight_file',proposed->>'source_zip_sha256',
          'browser_table_capture',proposed->>'confidence',proposed->>'notes',
          proposed->>'source_athlete_name');
        entered := entered+1;
      end if;
    end if;
    if previous.evidence_key is not null then
      if previous.linked_observation_id is distinct from obsid
        or previous.review_state is distinct from
          (case when obsid is null then 'held_gender_unspecified' else 'imported_placement_identity_held' end) then
        raise exception 'Previously imported placement changed';
      end if;
    else
      insert into private.usa_bracketing_placement_evidence(
        evidence_key,provider_event_id,source_pack,archive_sha256,original_record,review_state,linked_observation_id)
      values(x->>'evidence_key',(x->>'event_id')::uuid,x->>'pack',x->>'archive_sha',src,
        case when obsid is null then 'held_gender_unspecified' else 'imported_placement_identity_held' end,
        obsid);
    end if;
  end loop;
  return entered;
end; $$;
revoke all on function private.import_usa_bracketing_placements(jsonb)
  from public, anon, authenticated, service_role;
commit;
