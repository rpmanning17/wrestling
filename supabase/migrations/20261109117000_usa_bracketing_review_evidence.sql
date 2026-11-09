-- Keep non-contested and unresolved youth source records without introducing matches or rated wins.
begin;
create function private.import_usa_bracketing_review_evidence(payload jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
 x jsonb; raw jsonb; prior private.usa_bracketing_bout_evidence%rowtype; added integer:=0;
 status text; actual_style text;
begin
 if jsonb_typeof(payload) is distinct from 'array'
     or jsonb_array_length(payload) not between 1 and 100 then
   raise exception 'Expected 1..100 reviewed source records';
 end if;
 for x in select value from jsonb_array_elements(payload) loop
   raw:=x->'raw';status:=x->>'review_state';actual_style:=x->>'verified_style';
   if x->>'bout_id' is null or x->>'event_id' is null
      or x->>'pack' not in ('youth','collector','melbourne')
      or x->>'archive_sha' !~ '^[a-f0-9]{64}$'
      or x->>'raw_hash' !~ '^[a-f0-9]{64}$'
      or x->>'source_file' is null
      or x->>'source_file' not like 'usabracketing/%/bouts/%'
      or (x->>'original_source_row')::integer < 1
      or status is null
      or not (status like 'excluded_admin_%' or status in
        ('held_style_unverified','held_unverified_method_RULE','held_unverified_method_ID'))
      or raw->>'bout_id' <> x->>'bout_id'
      or raw->>'event_id' <> x->>'event_id'
      or raw->>'source_file' <> x->>'source_file'
      or raw->>'disposition' <> status
      or raw->>'archive_pack' <> x->>'pack'
      or raw->>'source_row_original' <> x->>'original_source_row'
      or actual_style is not null and actual_style not in ('FS','GR','Folkstyle')
      or coalesce(nullif(raw->>'division',''),raw->>'weight_class_original') !~*
           '(^|[^0-9])((6|8|10|12|14)U|U(6|8|10|12|14))([^0-9]|$)'
      or coalesce(nullif(raw->>'division',''),raw->>'weight_class_original') ~*
           '(16U|18U|junior|adult|high school|varsity)' then
      raise exception 'Invalid excluded or held USA Bracketing youth record %',x->>'bout_id';
   end if;
   select * into prior from private.usa_bracketing_bout_evidence
     where provider_bout_id=(x->>'bout_id')::uuid;
   if found then
     if prior.provider_event_id <> (x->>'event_id')::uuid
        or prior.source_pack <> x->>'pack'
        or prior.archive_sha256 <> x->>'archive_sha'
        or prior.source_file <> x->>'source_file'
        or prior.raw_row_sha256 <> x->>'raw_hash'
        or prior.original_record <> raw
        or prior.review_state <> status
        or prior.linked_match_id is not null then
       raise exception 'Conflicting held source record %',x->>'bout_id';
     end if;
   else
     insert into private.usa_bracketing_bout_evidence (
       provider_bout_id,provider_event_id,source_pack,archive_sha256,source_file,
       original_source_row,raw_row_sha256,original_record,verified_style,date_basis,
       review_state,linked_match_id)
     values ((x->>'bout_id')::uuid,(x->>'event_id')::uuid,x->>'pack',
       x->>'archive_sha',x->>'source_file',(x->>'original_source_row')::integer,
       x->>'raw_hash',raw,actual_style,null,status,null);
     added:=added+1;
   end if;
 end loop;
 return added;
end; $$;
revoke all on function private.import_usa_bracketing_review_evidence(jsonb) from public,anon,authenticated,service_role;
commit;
