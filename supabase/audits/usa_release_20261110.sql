-- USA Bracketing final read-only active release audit. Administrator only.
-- Immutable source snapshot and all 47,071 typed stored rows were independently checked.
-- No raw/identity deletion or overwrite. Abort if any guarded input has changed.
begin;
set local lock_timeout='5s';
lock table public.rating_models in share mode;
lock table public.wrestler_model_ratings,public.wrestler_rating_history,
 public.matches,public.wrestler_aliases,public.wrestler_people,public.source_identity_current_rows in share mode;
do $release$
declare
 locked public.rating_models%rowtype;
 expected jsonb := '{"model_version":"glicko2-daily-dec08-person-identity-v1","status":"active","identity_scheme":"person_uuid","assignment_fingerprint":"935db7eab2db00b57fca9aebd97b2032d2cb4ea71ddd3e4aad7381b7c810a3ba","config":{"modelVersion":"glicko2-daily-dec08-person-identity-v1","glicko":{"initialRating":1500,"initialRd":350,"initialVolatility":0.06,"tau":0.5,"epsilon":0.000001,"maxRd":350},"period":{"days":1},"recency":{"policy":"glicko2_inactivity_rd_growth"},"uncertainty":{"k":1,"provisionalRd":120,"establishedRd":80},"predictor":"combined_rd","dominance":{"enabled":true,"winnerScore":{"decision":0.8,"major_decision":1,"tech_fall":1,"fall":1},"margin":null},"outcomes":{"contested":["decision","major_decision","tech_fall","fall"]},"matching":{"aliasPolicy":"retrospective","eventGapDays":7,"dedupeExactRows":true},"metrics":{"qualityPercentile":0.8,"sosReferenceRating":1500,"trendDays":90}},"config_hash":"e599879557210ffef6809bd85fdec4d3c15de98499018e807b2744c699b80d5a","input_fingerprint":"9fdd702f52b77ea649fc3b5e117d052b65cf0e1b24f3f2a7632231875877a196","code_version":"982a655b37517b7e1cbfbcd40d2f51b07a0f1685/verified-person-snapshot-v2","as_of_date":"2026-11-09","match_cutoff":"2026-11-08","first_match_date":"2024-10-05","rating_period_policy":"fixed_1d","rating_period_days":1,"uncertainty_k":1,"provisional_rd":120,"established_rd":80,"recency_policy":"glicko2_inactivity_rd_growth","dominance_enabled":true,"matches_total":68783,"matches_rated":64970,"matches_excluded":{"byReason":{"invalid_date":0,"missing_name":0,"placeholder_opponent":0,"self_match":0,"non_contested_method":3679,"unrecognized_method":6,"duplicate_row":0,"unresolved_identity":128},"excludedMethods":{"forfeit":2891,"medical_forfeit":342,"default":358,"disqualification":58,"no_contest":30},"unrecognizedWinTypes":{"OTHER1":6}},"wrestlers_rated":11650,"quality_threshold":1737.01,"label":"Verified source snapshot — unchanged person-keyed daily decision-0.8 Glicko-2","notes":"Current assignments including held appearances. Full private snapshot and output validation required before supervised promotion."}'::jsonb;
 source_manifest jsonb;
 actual_root text;
 old_checksum text;
begin
 select * into locked from public.rating_models where id='70b59c01-34ac-4ff0-bf2a-114571d4f41c'::uuid for update;
 if not found then raise exception 'Expected person run missing'; end if;
 if exists(select 1 from jsonb_each(expected) e where to_jsonb(locked)->e.key is distinct from e.value)
 then raise exception 'Person model metadata/status/provenance changed'; end if;
 if (select count(*) from public.rating_models where status='active')<>1
 or not exists(select 1 from public.rating_models where id='70b59c01-34ac-4ff0-bf2a-114571d4f41c'::uuid and status='active')
 then raise exception 'Expected predecessor is no longer sole active model'; end if;
 if (select config-'modelVersion' from public.rating_models where id='a29c4460-5e56-4d22-902d-ea39c65bfcac'::uuid)
 is distinct from ((expected->'config')-'modelVersion')
 then raise exception 'Production formula differs'; end if;
 if (select count(*) from public.wrestler_model_ratings where model_id='70b59c01-34ac-4ff0-bf2a-114571d4f41c'::uuid)<>11650
 or (select count(*) from public.wrestler_rating_history where model_id='70b59c01-34ac-4ff0-bf2a-114571d4f41c'::uuid)<>35421
 or (select sum(wins) from public.wrestler_model_ratings where model_id='70b59c01-34ac-4ff0-bf2a-114571d4f41c'::uuid)<>64970
 or (select sum(losses) from public.wrestler_model_ratings where model_id='70b59c01-34ac-4ff0-bf2a-114571d4f41c'::uuid)<>64970
 then raise exception 'Person output count/record mismatch'; end if;
 if exists(select 1 from public.wrestler_model_ratings where model_id='70b59c01-34ac-4ff0-bf2a-114571d4f41c'::uuid
 and (person_id is null or person_id::text<>athlete_key or abs(conservative_score-(rating-rating_deviation))>0.002))
 or exists(select 1 from public.wrestler_rating_history where model_id='70b59c01-34ac-4ff0-bf2a-114571d4f41c'::uuid
 and (person_id is null or person_id::text<>athlete_key))
 then raise exception 'Person output identity/conservative-score mismatch'; end if;

 with output_rows as (
 select to_jsonb(t)::text body,row_number() over(order by athlete_key collate "C") position
 from public.wrestler_model_ratings t where model_id='70b59c01-34ac-4ff0-bf2a-114571d4f41c'::uuid
), chunks as (
 select (position-1)/250 chunk_index,
 encode(sha256(convert_to(string_agg(md5(body),'' order by position),'UTF8')),'hex') chunk_hash
 from output_rows group by (position-1)/250
) select encode(sha256(convert_to(string_agg(chunk_hash,'' order by chunk_index),'UTF8')),'hex') into actual_root from chunks;
 if actual_root is distinct from '1f1bad5b14753d5be78bb768da397c9250ccbb796cba0d21c50d614263b45e86' then raise exception 'Complete rating output checksum changed'; end if;
 with output_rows as (
 select to_jsonb(t)::text body,row_number() over(order by athlete_key collate "C",period_end) position
 from public.wrestler_rating_history t where model_id='70b59c01-34ac-4ff0-bf2a-114571d4f41c'::uuid
), chunks as (
 select (position-1)/250 chunk_index,
 encode(sha256(convert_to(string_agg(md5(body),'' order by position),'UTF8')),'hex') chunk_hash
 from output_rows group by (position-1)/250
) select encode(sha256(convert_to(string_agg(chunk_hash,'' order by chunk_index),'UTF8')),'hex') into actual_root from chunks;
 if actual_root is distinct from '8105c92c2b2b6abe47725ce9ae366dfe347891058d5e1d0f50a5a55498661e0e' then raise exception 'Complete history output checksum changed'; end if;

 with manifest as (select 'matches' kind,count(*) n,encode(sha256(convert_to(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),''),'UTF8')),'hex') fingerprint from public.matches t
union all select 'assignments',count(*),encode(sha256(convert_to(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by source_kind collate "C",source_id collate "C"),''),'UTF8')),'hex') from public.source_identity_current_rows t
union all select 'people',count(*),encode(sha256(convert_to(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),''),'UTF8')),'hex') from public.wrestler_people t
union all select 'aliases',count(*),encode(sha256(convert_to(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by alias_key collate "C"),''),'UTF8')),'hex') from public.wrestler_aliases t)
 select jsonb_object_agg(kind,jsonb_build_object('n',n,'fingerprint',fingerprint)) into source_manifest from manifest;
 if source_manifest is distinct from '{"matches":{"n":68783,"fingerprint":"d49c4c8c05a49004298830f14b73d41f6067e6d00dce0380ea5538bc558875a2"},"assignments":{"n":138661,"fingerprint":"179c69b4fdc049b345485bed95d2f98c6bd9732c3830e044537a18648a377bf9"},"people":{"n":11750,"fingerprint":"a2c3aa9ac6e134399e4666466b9e66c91a6f73f4d85efdc0afcf6b569faef985"},"aliases":{"n":1,"fingerprint":"5c5d646405687bc3ae7a21aa564734ca26cd69659689d2e339e63ae3c490624a"}}'::jsonb
 then raise exception 'Full source/assignment/people/alias snapshot changed'; end if;
 if locked.assignment_fingerprint is distinct from (
 select encode(sha256(convert_to(string_agg(source_kind||chr(31)||source_id||chr(31)||
 encode(convert_to(recorded_name,'UTF8'),'hex')||chr(31)||coalesce(person_id::text,''),
 chr(10) order by source_kind collate "C",source_id collate "C"),'UTF8')),'hex')
 from public.source_identity_current_rows)
 then raise exception 'Assignment fingerprint changed'; end if;

 if (select count(*) from public.wrestler_model_ratings where model_id='a29c4460-5e56-4d22-902d-ea39c65bfcac'::uuid)<>11724
 or (select count(*) from public.wrestler_rating_history where model_id='a29c4460-5e56-4d22-902d-ea39c65bfcac'::uuid)<>34809
 then raise exception 'Rollback predecessor incomplete'; end if;
 select md5(string_agg(to_jsonb(t)::text,chr(10) order by athlete_key collate "C")) into old_checksum
 from public.wrestler_model_ratings t where model_id='a29c4460-5e56-4d22-902d-ea39c65bfcac'::uuid;
 if old_checksum is distinct from '2f6dcc16a26368c4aa018884a2116cbe' then raise exception 'Rollback rating output changed'; end if;
 select md5(string_agg(to_jsonb(t)::text,chr(10) order by to_jsonb(t)::text collate "C")) into old_checksum
 from public.wrestler_rating_history t where model_id='a29c4460-5e56-4d22-902d-ea39c65bfcac'::uuid;
 if old_checksum is distinct from '1893a665b47ad8965cdf42eba622d73c' then raise exception 'Rollback history output changed'; end if;
 if not exists(select 1 from public.rating_models where id='a29c4460-5e56-4d22-902d-ea39c65bfcac'::uuid and status='archived') then raise exception 'Rollback predecessor not archived'; end if;
end $release$;
select true verified_active_release,'70b59c01-34ac-4ff0-bf2a-114571d4f41c' active_model;
rollback;

