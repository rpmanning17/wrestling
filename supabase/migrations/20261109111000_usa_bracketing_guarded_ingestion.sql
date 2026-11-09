-- Guarded USA Bracketing results ingestion: only reviewed, contested youth bouts.
-- No rating updates, no inferred identity merge, no admin outcomes.
begin;
create function private.import_usa_bracketing_verified(payload jsonb)
returns integer language plpgsql security invoker set search_path = '' as $
declare
  e jsonb; m jsonb; raw jsonb;
  prior public.matches%rowtype;
  prior_e private.usa_bracketing_bout_evidence%rowtype;
  match_uuid uuid; inserted integer := 0;
  win text; lose text; raw_method text;
  package text; source_date date;
begin
  if jsonb_typeof(payload) is distinct from 'array'
     or jsonb_array_length(payload) < 1 or jsonb_array_length(payload) > 100 then
    raise exception 'Expected 1..100 reviewed source bouts';
  end if;
  if exists (select 1 from public.rating_models
             where status = 'active' and identity_scheme = 'person_uuid') then
    raise exception 'Person-keyed active rating requires supervised identity import release';
  end if;
  lock table public.matches in share row exclusive mode;
  for e in select value from jsonb_array_elements(payload) loop
    m := e->'match'; raw := e->'raw';
    if m is null or raw is null or e->>'bout_id' is null
       or m->>'source_file' is null or m->>'event_date' is null
       or m->>'winner_name' is null or m->>'loser_name' is null
       or raw->>'division' is null or raw->>'bout_id' <> e->>'bout_id'
       or raw->>'event_id' <> e->>'event_id'
       or raw->>'source_file' <> m->>'source_file'
       or raw->>'raw_row_sha256' <> e->>'raw_hash'
       or raw->>'archive_pack' <> e->>'pack'
       or raw->>'source_row_original' <> (m->>'source_row')
       or raw->>'weight_class_original' <> m->>'weight_class'
       or raw->>'result_raw_original' <> m->>'result' then
      raise exception 'USA provenance mismatch or incomplete record';
    end if;
    if not (raw->>'division' ~* '(^|[^0-9])((6|8|10|12|14)U|U(6|8|10|12|14))([^0-9]|$)')
       or raw->>'division' ~* '(16U|18U|Junior|Adult|Masters|High School|Varsity)'
       then raise exception 'Non-youth or ambiguous source division %', raw->>'division'; end if;
    if e->>'style' not in ('FS','GR','Folkstyle')
       or e->>'pack' not in ('youth','collector','melbourne')
       or raw->>'winner_side_original' not in ('1','2')
       then raise exception 'Unverified style, source pack or winning side'; end if;
    win := case when raw->>'winner_side_original'='1'
      then raw->>'participant1_name_original' else raw->>'participant2_name_original' end;
    lose := case when raw->>'winner_side_original'='1'
      then raw->>'participant2_name_original' else raw->>'participant1_name_original' end;
    if win is null or lose is null or win=lose or win <> m->>'winner_name'
       or lose <> m->>'loser_name' or win ~* '^(bye|wrestler [12]|tbd)$'
       or lose ~* '^(bye|wrestler [12]|tbd)$' then
       raise exception 'Invalid or mismatched match participants'; end if;
    if m->>'winner_team' is distinct from case when raw->>'winner_side_original'='1'
        then raw->>'participant1_team_original' else raw->>'participant2_team_original' end
      or m->>'loser_team' is distinct from case when raw->>'winner_side_original'='1'
        then raw->>'participant2_team_original' else raw->>'participant1_team_original' end
      then raise exception 'Original team mismatch'; end if;
    raw_method := raw->>'method_raw_original';
    if raw_method not in ('F','TF','Dec','MD','SV','TB')
       or m->>'win_type' <> case raw_method
          when 'Dec' then 'DEC' when 'SV' then 'DEC' when 'TB' then 'DEC'
          else raw_method end
       then raise exception 'Unverified or non-contested outcome %', raw_method; end if;
    if e->>'style_basis'='source_division' and raw->>'style_verified' <> e->>'style'
       then raise exception 'Source style mismatch'; end if;
    if m->>'source_file' not like 'usabracketing/%/bouts/%'
       or (m->>'source_row')::integer <> 1 then
       raise exception 'Not the original USA Bracketing unique source row'; end if;
    source_date := (m->>'event_date')::date;
    if source_date < (raw->>'event_start_date')::date
       or source_date > (raw->>'event_end_date')::date then
       raise exception 'Event date outside source event span'; end if;
    select * into prior from public.matches
    where source_file=m->>'source_file' and source_row=(m->>'source_row')::integer;
    if found then
      if row(prior.event_date::text, prior.season, prior.event_name, prior.city,
        prior.state, prior.weight_class, prior.round, prior.winner_name, prior.winner_team,
        prior.loser_name, prior.loser_team, prior.result, prior.win_type, prior.source_file,
        prior.source_row) is distinct from
        row(m->>'event_date',m->>'season',m->>'event_name',m->>'city',
        m->>'state',m->>'weight_class',m->>'round',m->>'winner_name',m->>'winner_team',
        m->>'loser_name',m->>'loser_team',m->>'result',m->>'win_type',m->>'source_file',
        (m->>'source_row')::integer) then
        raise exception 'Conflicting previously imported source %', m->>'source_file';
      end if;
      match_uuid := prior.id;
    else
      insert into public.matches (event_date,season,event_name,city,state,
        weight_class,round,winner_name,winner_team,loser_name,loser_team,
        result,win_type,source_file,source_row)
      values (source_date,m->>'season',m->>'event_name',m->>'city',m->>'state',
        m->>'weight_class',m->>'round',m->>'winner_name',m->>'winner_team',
        m->>'loser_name',m->>'loser_team',m->>'result',m->>'win_type',
        m->>'source_file',(m->>'source_row')::integer)
      returning id into match_uuid;
      inserted := inserted + 1;
    end if;
    select * into prior_e from private.usa_bracketing_bout_evidence
     where provider_bout_id=(e->>'bout_id')::uuid;
    if found then
      if row(prior_e.provider_event_id,prior_e.source_pack,
        prior_e.archive_sha256,prior_e.source_file,prior_e.original_source_row,
        prior_e.raw_row_sha256,prior_e.original_record,prior_e.verified_style,
        prior_e.date_basis,prior_e.review_state,prior_e.linked_match_id)
        is distinct from row((e->>'event_id')::uuid,e->>'pack',
        e->>'archive_sha',m->>'source_file',(m->>'source_row')::integer,
        e->>'raw_hash',raw,e->>'style',e->>'date_basis','imported',match_uuid)
        then raise exception 'Conflicting USA original source evidence'; end if;
    else
      insert into private.usa_bracketing_bout_evidence
        (provider_bout_id,provider_event_id,source_pack,archive_sha256,
        source_file,original_source_row,raw_row_sha256,original_record,
        verified_style,date_basis,review_state,linked_match_id)
      values ((e->>'bout_id')::uuid,(e->>'event_id')::uuid,e->>'pack',
        e->>'archive_sha',m->>'source_file',(m->>'source_row')::integer,
        e->>'raw_hash',raw,e->>'style',e->>'date_basis','imported',match_uuid);
    end if;
  end loop;
  return inserted;
end $;
revoke all on function private.import_usa_bracketing_verified(jsonb)
  from public, anon, authenticated, service_role;
commit;
