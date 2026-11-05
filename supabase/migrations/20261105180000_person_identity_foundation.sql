begin;

-- Source rows retain their recorded names. A decision can be reversed by recording
-- another assignment revision; prior revisions and decisions remain inspectable.
create table public.wrestler_people (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 1 and 100),
  created_at timestamptz not null default now()
);

create table public.identity_decisions (
  id uuid primary key default gen_random_uuid(),
  authority text not null check (authority in ('owner_confirmed', 'agent_inferred', 'source_evidenced', 'administrative')),
  disposition text not null check (disposition in ('same_person', 'separate_people', 'unresolved', 'source_error', 'rollback')),
  evidence_hash text check (evidence_hash is null or evidence_hash ~ '^[a-f0-9]{64}$'),
  evidence jsonb not null default '{}'::jsonb,
  source_checksum text not null,
  rationale text not null check (char_length(rationale) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.identity_assignment_batches (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.identity_decisions(id),
  reverts_batch_id uuid references public.identity_assignment_batches(id),
  created_at timestamptz not null default now(),
  unique (reverts_batch_id)
);

create table public.source_identity_assignments (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.identity_assignment_batches(id),
  source_kind text not null check (source_kind in ('match_winner', 'match_loser', 'tournament_entry', 'tournament_observation')),
  decision_id uuid not null references public.identity_decisions(id),
  recorded_name text not null,
  match_id uuid references public.matches(id),
  entry_id bigint references public.tournament_entries(id),
  observation_id bigint references public.tournament_observations(id),
  person_id uuid references public.wrestler_people(id),
  revision integer not null check (revision > 0),
  created_at timestamptz not null default now(),
  constraint assignment_one_source check (
    (source_kind in ('match_winner', 'match_loser') and match_id is not null and entry_id is null and observation_id is null)
    or (source_kind = 'tournament_entry' and entry_id is not null and match_id is null and observation_id is null)
    or (source_kind = 'tournament_observation' and observation_id is not null and match_id is null and entry_id is null)
  ),
  unique (source_kind, match_id, revision),
  unique (source_kind, entry_id, revision),
  unique (source_kind, observation_id, revision),
  unique (batch_id, source_kind, match_id),
  unique (batch_id, source_kind, entry_id),
  unique (batch_id, source_kind, observation_id)
);

create index source_assignments_person_idx on public.source_identity_assignments (person_id);
create index source_assignments_match_idx on public.source_identity_assignments (match_id, source_kind, revision desc);
create index source_assignments_entry_idx on public.source_identity_assignments (entry_id, revision desc);
create index source_assignments_observation_idx on public.source_identity_assignments (observation_id, revision desc);

create table public.source_identity_current_rows (
  source_kind text not null check (source_kind in ('match_winner', 'match_loser', 'tournament_entry', 'tournament_observation')),
  source_id text not null,
  recorded_name text not null,
  person_id uuid references public.wrestler_people(id),
  revision integer not null check (revision > 0),
  batch_id uuid not null references public.identity_assignment_batches(id),
  created_at timestamptz not null default now(),
  primary key (source_kind, source_id)
);
create index source_identity_current_person_idx on public.source_identity_current_rows (person_id, source_kind)
  where person_id is not null;

create view public.source_identity_current with (security_invoker = true) as
select source_kind, source_id, recorded_name, person_id, revision, batch_id, created_at
from public.source_identity_current_rows;

-- The expected revision is a compare-and-swap guard. Rollback uses the same
-- function with a new batch and the prior person_id (or null).
create function private.assign_source_identity(
  target_batch uuid, target_kind text, target_source text,
  target_person uuid, expected_revision integer, expected_name text, target_decision uuid
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  latest integer;
  source_match uuid;
  source_entry bigint;
  source_observation bigint;
begin
  if exists (select 1 from public.rating_models where status='active' and identity_scheme='person_uuid') then
    raise exception 'Archive active person model before changing identity assignments';
  end if;
  if target_kind in ('match_winner', 'match_loser') then
    source_match := target_source::uuid;
    if not exists (select 1 from public.matches where id = source_match and
      case when target_kind = 'match_winner' then winner_name else loser_name end = expected_name)
      then raise exception 'Match source name changed or match missing'; end if;
  elsif target_kind = 'tournament_entry' then
    source_entry := target_source::bigint;
    if not exists (select 1 from public.tournament_entries where id = source_entry and athlete_name = expected_name)
      then raise exception 'Entry source name changed or entry missing'; end if;
  elsif target_kind = 'tournament_observation' then
    source_observation := target_source::bigint;
    if not exists (select 1 from public.tournament_observations where id = source_observation and athlete_name = expected_name)
      then raise exception 'Observation source name changed or observation missing'; end if;
  else
    raise exception 'Invalid source kind';
  end if;
  -- Serialize revisions for one source, including its first assignment.
  perform pg_advisory_xact_lock(hashtextextended(target_kind || ':' || target_source, 0));
  select coalesce(max(revision), 0) into latest
  from public.source_identity_assignments
  where source_kind = target_kind and match_id is not distinct from source_match
    and entry_id is not distinct from source_entry
    and observation_id is not distinct from source_observation;
  if latest <> expected_revision then raise exception 'Stale assignment revision: expected %, found %', expected_revision, latest; end if;
  insert into public.source_identity_assignments
    (batch_id, decision_id, source_kind, recorded_name, match_id, entry_id, observation_id, person_id, revision)
  values (target_batch, target_decision, target_kind, expected_name, source_match, source_entry, source_observation, target_person, latest + 1);
  insert into public.source_identity_current_rows
    (source_kind, source_id, recorded_name, person_id, revision, batch_id)
  values (target_kind, target_source, expected_name, target_person, latest + 1, target_batch)
  on conflict (source_kind, source_id) do update set
    recorded_name = excluded.recorded_name, person_id = excluded.person_id,
    revision = excluded.revision, batch_id = excluded.batch_id, created_at = now();
  return latest + 1;
end $$;
revoke all on function private.assign_source_identity(uuid, text, text, uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function private.assign_source_identity(uuid, text, text, uuid, integer, text, uuid) to service_role;

-- Initial and corrective imports use bounded, atomic batches. A committed retry
-- succeeds only if the entire current batch is identical to its original write.
create function private.apply_identity_batch(target_batch uuid, payload jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  n integer;
  existing integer;
begin
  if exists (select 1 from public.rating_models where status='active' and identity_scheme='person_uuid') then
    raise exception 'Archive active person model before changing identity assignments';
  end if;
  if jsonb_typeof(payload) <> 'array' or jsonb_array_length(payload) not between 1 and 1000 then
    raise exception 'Identity batch must contain 1..1000 assignments';
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
revoke all on function private.apply_identity_batch(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.apply_identity_batch(uuid,jsonb) to service_role;

-- Legacy notes are unattributed until evidence identifies their owner.
alter table public.wrestler_notes add column person_id uuid references public.wrestler_people(id);
create index wrestler_notes_person_idx on public.wrestler_notes (person_id) where person_id is not null;

alter table public.wrestler_people enable row level security;
alter table public.identity_decisions enable row level security;
alter table public.identity_assignment_batches enable row level security;
alter table public.source_identity_assignments enable row level security;
alter table public.source_identity_current_rows enable row level security;
revoke all on public.wrestler_people, public.identity_decisions, public.identity_assignment_batches,
  public.source_identity_assignments, public.source_identity_current_rows, public.source_identity_current from public, anon, authenticated;
grant select on public.wrestler_people, public.source_identity_assignments, public.source_identity_current_rows,
  public.source_identity_current to anon, service_role;
grant select on public.identity_decisions, public.identity_assignment_batches to service_role;
grant insert, update, delete on public.wrestler_people to service_role;
grant insert on public.identity_decisions, public.identity_assignment_batches to service_role;
create policy "Personal app can read people" on public.wrestler_people for select to anon
  using ((select private.personal_app_request_is_valid()));
create policy "Personal app can read source assignments" on public.source_identity_assignments for select to anon
  using ((select private.personal_app_request_is_valid()));
create policy "Personal app can read current source assignments" on public.source_identity_current_rows for select to anon
  using ((select private.personal_app_request_is_valid()));

alter table public.rating_models add column identity_scheme text not null default 'name_key'
  check (identity_scheme in ('name_key', 'person_uuid'));
alter table public.rating_models add column assignment_fingerprint text
  check (assignment_fingerprint is null or assignment_fingerprint ~ '^[a-f0-9]{64}$');
alter table public.rating_models add constraint person_model_requires_assignment_fingerprint
  check (identity_scheme <> 'person_uuid' or assignment_fingerprint is not null);
alter table public.wrestler_model_ratings add column person_id uuid references public.wrestler_people(id);
alter table public.wrestler_rating_history add column person_id uuid references public.wrestler_people(id);
create index wrestler_model_ratings_person_idx on public.wrestler_model_ratings (person_id, model_id)
  where person_id is not null;

create function private.guard_person_rating_activation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  totals record;
begin
  if new.status <> 'active' or new.identity_scheme <> 'person_uuid' then return new; end if;
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
  select count(*)::integer n,coalesce(sum(wins),0)::integer wins,coalesce(sum(losses),0)::integer losses,
    count(*) filter(where person_id is null or person_id::text <> athlete_key)::integer bad_keys
  into totals from public.wrestler_model_ratings where model_id = new.id;
  if totals.n <> new.wrestlers_rated or totals.wins <> new.matches_rated or
     totals.losses <> new.matches_rated or totals.bad_keys <> 0 then
    raise exception 'Person model rating rows fail activation reconciliation';
  end if;
  return new;
end $$;
create trigger guard_person_rating_activation
  before insert or update of status on public.rating_models
  for each row execute function private.guard_person_rating_activation();

create view public.person_matches with (security_invoker = true) as
select m.*, winner.person_id as winner_person_id, loser.person_id as loser_person_id
from public.matches m
left join public.source_identity_current_rows winner
  on winner.source_kind = 'match_winner' and winner.source_id = m.id::text
left join public.source_identity_current_rows loser
  on loser.source_kind = 'match_loser' and loser.source_id = m.id::text;
create view public.person_tournament_entries with (security_invoker = true) as
select e.*, assignment.person_id
from public.tournament_entries e
left join public.source_identity_current_rows assignment
  on assignment.source_kind = 'tournament_entry' and assignment.source_id = e.id::text;
create view public.person_tournament_observations with (security_invoker = true) as
select o.*, assignment.person_id
from public.tournament_observations o
left join public.source_identity_current_rows assignment
  on assignment.source_kind = 'tournament_observation' and assignment.source_id = o.id::text;
create view public.person_rating_current with (security_invoker = true) as
select rating.*, model.model_version, model.as_of_date
from public.rating_models model
join public.wrestler_model_ratings rating on rating.model_id = model.id
where model.status = 'active' and model.identity_scheme = 'person_uuid';
revoke all on public.person_matches, public.person_tournament_entries,
  public.person_tournament_observations, public.person_rating_current from public, anon, authenticated;
grant select on public.person_matches, public.person_tournament_entries,
  public.person_tournament_observations, public.person_rating_current to anon, service_role;

commit;
