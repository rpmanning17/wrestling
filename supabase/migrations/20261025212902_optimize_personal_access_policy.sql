begin;

create schema if not exists private;
revoke all on schema private from public, authenticated;
grant usage on schema private to anon;

create or replace function private.personal_app_request_is_valid()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
 select encode(
  extensions.digest(
   coalesce(
    current_setting('request.headers', true)::jsonb ->> 'x-personal-app-key',
    ''
   ),
   'sha256'
  ),
  'hex'
 ) = '38f0024c53acc4e7ade4d582f0e796d9448fad0725881bda27b3f353043d6ffb'
$$;

revoke all on function private.personal_app_request_is_valid() from public, authenticated;
grant execute on function private.personal_app_request_is_valid() to anon;

drop policy if exists personal_server_access on public.results;
create policy personal_server_access
on public.results
for all
to anon
using ((select private.personal_app_request_is_valid()))
with check ((select private.personal_app_request_is_valid()));

commit;
