begin;

-- Administrator-only immutable evidence. No client-facing RPC, policy or grants.
create table private.flo_import_runs (
  run_sha256 text primary key check (run_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  approval_reference text not null check (length(trim(approval_reference)) > 0),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  inserted_rows integer not null check (inserted_rows > 0),
  created_at timestamptz not null default now()
);
alter table private.flo_import_runs enable row level security;
revoke all on private.flo_import_runs from public, anon, authenticated;
-- Supabase creates service_role; disposable test databases may omit it.
do $$ begin
  if exists (select 1 from pg_roles where rolname='service_role') then
    execute 'revoke all on private.flo_import_runs from service_role';
  end if;
end $$;

commit;
