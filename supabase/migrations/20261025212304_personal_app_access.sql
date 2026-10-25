begin;

drop policy if exists owner_only on public.results;

revoke all on public.results from anon, authenticated;
grant select, insert, update, delete on public.results to anon;

drop index if exists public.results_owner_date;
drop index if exists public.results_owner_season;
alter table public.results drop column if exists owner_id;

create policy personal_server_access
on public.results
for all
to anon
using (
  (select encode(
    extensions.digest(
      coalesce(
        current_setting('request.headers', true)::jsonb ->> 'x-personal-app-key',
        ''
      ),
      'sha256'
    ),
    'hex'
  )) = '38f0024c53acc4e7ade4d582f0e796d9448fad0725881bda27b3f353043d6ffb'
)
with check (
  (select encode(
    extensions.digest(
      coalesce(
        current_setting('request.headers', true)::jsonb ->> 'x-personal-app-key',
        ''
      ),
      'sha256'
    ),
    'hex'
  )) = '38f0024c53acc4e7ade4d582f0e796d9448fad0725881bda27b3f353043d6ffb'
);

create index results_event_date on public.results(event_date desc);
create index results_season on public.results(season);

commit;
