-- Read-only atomic manifest for private 1,000-row connector exports.
-- See docs/USA_IMPORT_CONTINUATION_20261109.md for exact encoding and ordering.
select 'matches' kind,count(*) n,encode(sha256(convert_to(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),''),'UTF8')),'hex') fingerprint from public.matches t
union all select 'assignments',count(*),encode(sha256(convert_to(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by source_kind collate "C",source_id collate "C"),''),'UTF8')),'hex') from public.source_identity_current_rows t
union all select 'people',count(*),encode(sha256(convert_to(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),''),'UTF8')),'hex') from public.wrestler_people t
union all select 'aliases',count(*),encode(sha256(convert_to(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by alias_key collate "C"),''),'UTF8')),'hex') from public.wrestler_aliases t;
