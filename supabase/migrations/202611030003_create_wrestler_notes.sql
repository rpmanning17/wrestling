begin;

create table public.wrestler_notes (
  id bigint generated always as identity primary key,
  wrestler_key text not null check (char_length(wrestler_key) between 1 and 160),
  wrestler_name text not null check (char_length(wrestler_name) between 1 and 100),
  body text not null check (char_length(body) between 1 and 4000),
  client_id text not null unique check (char_length(client_id) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.wrestler_notes enable row level security;

revoke all on public.wrestler_notes from public, authenticated;
grant select, insert, update, delete on public.wrestler_notes to anon;
grant select, insert, update, delete on public.wrestler_notes to service_role;
grant usage, select on sequence public.wrestler_notes_id_seq to anon, service_role;

create policy "Personal app can read wrestler notes"
  on public.wrestler_notes for select to anon
  using ((select private.personal_app_request_is_valid()));

create policy "Personal app can add wrestler notes"
  on public.wrestler_notes for insert to anon
  with check ((select private.personal_app_request_is_valid()));

create policy "Personal app can update wrestler notes"
  on public.wrestler_notes for update to anon
  using ((select private.personal_app_request_is_valid()))
  with check ((select private.personal_app_request_is_valid()));

create policy "Personal app can delete wrestler notes"
  on public.wrestler_notes for delete to anon
  using ((select private.personal_app_request_is_valid()));

create index wrestler_notes_profile_idx
  on public.wrestler_notes (wrestler_key, created_at desc);

commit;

