-- Agent-operated tournament release pipeline (docs/RELEASE_PIPELINE.md).
-- 1. Private raw-source preservation and an append-only run ledger (no participant data in CI logs).
-- 2. Active person models may gain FIRST assignments for brand-new source rows only.
-- 3. A guarded rollback may reactivate a previously active, complete person model.
-- 4. USA Bracketing import no longer blanket-refuses while a person model is active.
-- 5. A dedicated login role for the CI runner with only the privileges the pipeline uses.
-- Function bodies are derived mechanically from their applied sources; only the marked guards change.
begin;

create table private.import_sources (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('flo','trackwrestling','usa_bracketing','normalized')),
  original_filename text not null check (char_length(original_filename) between 1 and 200),
  sha256 text not null unique check (sha256 ~ '^[a-f0-9]{64}$'),
  content bytea not null check (octet_length(content) between 1 and 52428800),
  received_at timestamptz not null default now(),
  constraint import_source_content_hash check (encode(sha256(content),'hex') = sha256)
);

create table private.import_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references private.import_sources(id),
  request jsonb not null check (jsonb_typeof(request) = 'object'),
  status text not null default 'requested' check (status in
    ('requested','planned','approved','imported','assigned','candidate','active','verified','failed','rolled_back')),
  plan jsonb,
  plan_sha256 text check (plan_sha256 is null or plan_sha256 ~ '^[a-f0-9]{64}$'),
  approved_plan_sha256 text check (approved_plan_sha256 is null or approved_plan_sha256 ~ '^[a-f0-9]{64}$'),
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.import_run_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references private.import_runs(id),
  phase text not null check (char_length(phase) between 1 and 60),
  outcome text not null check (outcome in ('started','succeeded','skipped','failed')),
  detail jsonb not null default '{}'::jsonb,
  code_version text,
  created_at timestamptz not null default now()
);
create index import_run_events_run_idx on private.import_run_events (run_id, id);

alter table private.import_sources enable row level security;
alter table private.import_runs enable row level security;
alter table private.import_run_events enable row level security;
revoke all on private.import_sources, private.import_runs, private.import_run_events from public, anon, authenticated;

create or replace function private.apply_identity_batch(target_batch uuid, payload jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  n integer;
  existing integer;
begin
  if jsonb_typeof(payload) <> 'array' or jsonb_array_length(payload) not between 1 and 1000 then
    raise exception 'Identity batch must contain 1..1000 assignments';
  end if;
  -- An active person model may only gain FIRST assignments for source rows it never rated.
  -- Activation proved every source row then had a current assignment, so revision 0 rows are new.
  if exists (select 1 from public.rating_models where status='active' and identity_scheme='person_uuid')
     and exists (select 1 from jsonb_to_recordset(payload) as x(source_kind text, source_id text, expected_revision integer)
       left join public.source_identity_current_rows c using (source_kind, source_id)
       where x.expected_revision is distinct from 0 or c.source_id is not null) then
    raise exception 'Archive active person model before changing existing identity assignments';
  end if;
  select count(*) into n from jsonb_to_recordset(payload) as x(
    source_kind text, source_id text, recorded_name text, person_id uuid, decision_id uuid, expected_revision integer);
  if n <> (select count(*) from (select distinct source_kind,source_id from jsonb_to_recordset(payload) as x(
    source_kind text, source_id text, recorded_name text, person_id uuid, decision_id uuid, expected_revision integer)) d)
    then raise exception 'Duplicate source in identity batch'; end if;
  perform 1 from public.identity_assignment_batches where id = target_batch for update;
  if not found then raise exception 'Unknown identity batch'; end if;
  lock table public.source_identity_current_rows in share row exclusive mode;
  if exists (
    select 1 from jsonb_to_recordset(payload) as x(
      source_kind text, source_id text, recorded_name text, person_id uuid, decision_id uuid, expected_revision integer)
    left join public.matches m on m.id=case when x.source_kind in ('match_winner','match_loser') then x.source_id::uuid end
    left join public.tournament_entries e on e.id=case when x.source_kind='tournament_entry' then x.source_id::bigint end
    left join public.tournament_observations o on o.id=case when x.source_kind='tournament_observation' then x.source_id::bigint end
    where x.source_kind not in ('match_winner','match_loser','tournament_entry','tournament_observation')
      or x.source_id is null or x.recorded_name is null or x.expected_revision is null or x.expected_revision < 0
      or case x.source_kind
        when 'match_winner' then m.winner_name is distinct from x.recorded_name
        when 'match_loser' then m.loser_name is distinct from x.recorded_name
        when 'tournament_entry' then e.athlete_name is distinct from x.recorded_name
        when 'tournament_observation' then o.athlete_name is distinct from x.recorded_name
        else true end
  ) then raise exception 'Identity source record missing or changed'; end if;
  select count(*) into existing
  from jsonb_to_recordset(payload) as x(
    source_kind text, source_id text, recorded_name text, person_id uuid, decision_id uuid, expected_revision integer)
  join public.source_identity_current_rows c using (source_kind,source_id)
  where c.batch_id = target_batch and c.revision = x.expected_revision + 1
    and c.person_id is not distinct from x.person_id and c.recorded_name = x.recorded_name;
  if existing = n then return n; end if;
  if existing > 0 then raise exception 'Partial or changed identity batch retry'; end if;
  if exists (
    select 1 from jsonb_to_recordset(payload) as x(
      source_kind text, source_id text, recorded_name text, person_id uuid, decision_id uuid, expected_revision integer)
    left join public.source_identity_current_rows c using (source_kind,source_id)
    where coalesce(c.revision,0) <> x.expected_revision
       or c.batch_id = target_batch
  ) then raise exception 'Stale identity assignment revision'; end if;
  insert into public.source_identity_assignments
    (batch_id,decision_id,source_kind,recorded_name,match_id,entry_id,observation_id,person_id,revision)
  select target_batch,x.decision_id,x.source_kind,x.recorded_name,
    case when x.source_kind in ('match_winner','match_loser') then x.source_id::uuid end,
    case when x.source_kind='tournament_entry' then x.source_id::bigint end,
    case when x.source_kind='tournament_observation' then x.source_id::bigint end,
    x.person_id,x.expected_revision+1
  from jsonb_to_recordset(payload) as x(
    source_kind text, source_id text, recorded_name text, person_id uuid, decision_id uuid, expected_revision integer);
  insert into public.source_identity_current_rows
    (source_kind,source_id,recorded_name,person_id,revision,batch_id)
  select x.source_kind,x.source_id,x.recorded_name,x.person_id,x.expected_revision+1,target_batch
  from jsonb_to_recordset(payload) as x(
    source_kind text, source_id text, recorded_name text, person_id uuid, decision_id uuid, expected_revision integer)
  on conflict (source_kind,source_id) do update set
    recorded_name=excluded.recorded_name,person_id=excluded.person_id,revision=excluded.revision,
    batch_id=excluded.batch_id,created_at=now();
  return n;
end $$;

create or replace function private.guard_person_rating_activation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  totals record;
  rollback_target boolean;
begin
  if new.status <> 'active' or new.identity_scheme <> 'person_uuid' then return new; end if;
  -- private.rollback_rating_model sets this transaction-local marker for an archived model only.
  rollback_target := tg_op = 'UPDATE' and old.status = 'archived'
    and coalesce(current_setting('matnotes.rollback_target', true), '') = new.id::text;
  if not rollback_target then
    if new.matches_total <> (select count(*) from public.matches) then
      raise exception 'Person model source match count is stale';
    end if;
    if (select count(*) from public.source_identity_current_rows
        where source_kind in ('match_winner','match_loser')) <> 2 * new.matches_total then
      raise exception 'Person model match assignments are incomplete';
    end if;
    if new.assignment_fingerprint is distinct from (
      select encode(sha256(convert_to(string_agg(
        source_kind || chr(31) || source_id || chr(31) ||
        encode(convert_to(recorded_name,'UTF8'),'hex') || chr(31) || coalesce(person_id::text,''),
        chr(10) order by source_kind collate "C",source_id collate "C"),'UTF8')),'hex')
      from public.source_identity_current_rows
    ) then raise exception 'Person model assignment fingerprint is stale'; end if;
  end if;
  select count(*)::integer n,coalesce(sum(wins),0)::integer wins,coalesce(sum(losses),0)::integer losses,
    count(*) filter(where person_id is null or person_id::text <> athlete_key)::integer bad_keys
  into totals from public.wrestler_model_ratings where model_id = new.id;
  if totals.n <> new.wrestlers_rated or totals.wins <> new.matches_rated or
     totals.losses <> new.matches_rated or totals.bad_keys <> 0 then
    raise exception 'Person model rating rows fail activation reconciliation';
  end if;
  return new;
end $$;

-- Guarded rollback: the caller names the model it expects to replace. Only an archived model
-- with complete reconciled output qualifies; stale source coverage is expected and documented.
create function private.rollback_rating_model(target uuid, expected_current uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  t public.rating_models%rowtype;
  history_n integer;
begin
  lock table public.rating_models in share row exclusive mode;
  if (select count(*) from public.rating_models where status = 'active') <> 1
     or not exists (select 1 from public.rating_models where id = expected_current and status = 'active') then
    raise exception 'Expected current model is not the sole active model';
  end if;
  select * into t from public.rating_models where id = target for update;
  if not found or t.status <> 'archived' or target = expected_current then
    raise exception 'Rollback target must be a different archived model';
  end if;
  select count(*) into history_n from public.wrestler_rating_history where model_id = target;
  if (select count(*) from public.wrestler_model_ratings where model_id = target) <> t.wrestlers_rated
     or history_n = 0 then
    raise exception 'Rollback target output is incomplete';
  end if;
  perform set_config('matnotes.rollback_target', target::text, true);
  perform private.activate_rating_model(target);
  perform set_config('matnotes.rollback_target', '', true);
  if (select count(*) from public.rating_models where status = 'active') <> 1
     or not exists (select 1 from public.rating_models where id = target and status = 'active')
     or not exists (select 1 from public.rating_models where id = expected_current and status = 'archived') then
    raise exception 'Rollback post-check failed';
  end if;
end $$;
revoke all on function private.rollback_rating_model(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function private.import_usa_bracketing_verified(payload jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  e jsonb; m jsonb; raw jsonb;
  prior public.matches%rowtype;
  prior_e private.usa_bracketing_bout_evidence%rowtype;
  match_uuid uuid; inserted integer := 0;
  win text; lose text; winner_team text; loser_team text; raw_method text; mapped_method text;
  package text; source_date date;
begin
  if jsonb_typeof(payload) is distinct from 'array'
     or jsonb_array_length(payload) < 1 or jsonb_array_length(payload) > 100 then
    raise exception 'Expected 1..100 reviewed source bouts';
  end if;
  -- New source rows carry no assignment; identities are added by the release pipeline.
  lock table public.matches in share row exclusive mode;
  for e in select value from jsonb_array_elements(payload) loop
    m := e->'match'; raw := e->'raw';
    if m is null or raw is null or e->>'bout_id' is null
       or m->>'source_file' is null or m->>'event_date' is null
       or m->>'winner_name' is null or m->>'loser_name' is null
       or raw->>'division' is null or raw->>'bout_id' <> e->>'bout_id'
       or raw->>'event_id' <> e->>'event_id'
       or raw->>'source_file' <> m->>'source_file'
       or not (raw->>'raw_row_sha256' = e->>'raw_hash'
          or (raw->>'raw_row_sha256' = ''
              and e->>'pack' in ('collector','melbourne')
              and e->>'hash_basis'='canonical_review_manifest_row_sha256'
              and e->>'raw_hash' ~ '^[a-f0-9]{64}$'))
       or raw->>'archive_pack' <> e->>'pack'
       or raw->>'source_row_original' <> (m->>'source_row')
       or raw->>'weight_class_original' <> m->>'weight_class'
       or raw->>'result_raw_original' <> m->>'result' then
      raise exception 'USA provenance mismatch or incomplete record';
    end if;
    if not (coalesce(nullif(raw->>'division',''),raw->>'weight_class_original') ~* '(^|[^0-9])((6|8|10|12|14)U|U(6|8|10|12|14))([^0-9]|$)')
       or coalesce(nullif(raw->>'division',''),raw->>'weight_class_original') ~* '(16U|18U|Junior|Adult|Masters|High School|Varsity)'
       then raise exception 'Non-youth or ambiguous source division %', coalesce(nullif(raw->>'division',''),raw->>'weight_class_original'); end if;
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
    winner_team := case when raw->>'winner_side_original'='1' then raw->>'participant1_team_original' else raw->>'participant2_team_original' end;
    loser_team := case when raw->>'winner_side_original'='1' then raw->>'participant2_team_original' else raw->>'participant1_team_original' end;
    if m->>'winner_team' is distinct from winner_team or m->>'loser_team' is distinct from loser_team then
      raise exception 'Original team mismatch';
    end if;
    raw_method := raw->>'method_raw_original';
    mapped_method := case raw_method when 'Dec' then 'DEC' when 'SV' then 'DEC' when 'TB' then 'DEC' else raw_method end;
    if raw_method not in ('F','TF','Dec','MD','SV','TB')
       or m->>'win_type' <> mapped_method then
      raise exception 'Unverified or non-contested outcome %', raw_method;
    end if;
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
end; $$;
revoke all on function private.import_usa_bracketing_verified(jsonb)
  from public, anon, authenticated, service_role;

-- Dedicated CI login. No password is set here: the owner sets it once (docs/RELEASE_PIPELINE.md).
do $role$ begin
  if not exists (select 1 from pg_roles where rolname = 'matnotes_release') then
    create role matnotes_release login noinherit bypassrls;
  end if;
end $role$;
alter role matnotes_release set statement_timeout = '15min';
alter role matnotes_release set lock_timeout = '30s';
alter role matnotes_release set idle_in_transaction_session_timeout = '5min';
grant usage on schema public, private to matnotes_release;
grant select on all tables in schema public to matnotes_release;
grant select on public.club_aliases to matnotes_release;
grant select, insert on private.import_sources, private.import_runs, private.import_run_events to matnotes_release;
grant update (status, plan, plan_sha256, report, updated_at) on private.import_runs to matnotes_release;
grant select, insert on private.usa_bracketing_bout_evidence to matnotes_release;
grant select on private.match_cohort_appearances to matnotes_release;
grant insert on public.matches, public.rating_models, public.wrestler_model_ratings,
  public.wrestler_rating_history, public.wrestler_people, public.identity_decisions,
  public.identity_assignment_batches to matnotes_release;
grant update (status) on public.rating_models to matnotes_release;
grant maintain on public.matches, public.wrestler_aliases, public.wrestler_people,
  public.source_identity_current_rows, public.rating_models, public.wrestler_model_ratings,
  public.wrestler_rating_history to matnotes_release;
-- Production verification reads through the same invoker functions the app calls: grant exactly
-- the functions and private relations the app's anon role can already use (nothing more).
do $reads$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
  loop execute format('grant execute on function %s to matnotes_release', f.sig); end loop;
  for f in select c.oid::regclass rel from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relkind in ('r','v','m') and has_table_privilege('anon', c.oid, 'select')
  loop execute format('grant select on %s to matnotes_release', f.rel); end loop;
end $reads$;
grant execute on function private.apply_identity_batch(uuid, jsonb), private.activate_rating_model(uuid),
  private.rollback_rating_model(uuid, uuid), private.import_usa_bracketing_verified(jsonb) to matnotes_release;

commit;
