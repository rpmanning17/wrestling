begin;

create table public.wrestler_aliases (
  alias_key text primary key check (char_length(alias_key) between 1 and 160),
  alias_name text not null check (char_length(alias_name) between 1 and 100),
  canonical_key text not null check (char_length(canonical_key) between 1 and 160),
  canonical_name text not null check (char_length(canonical_name) between 1 and 100),
  reason text not null check (char_length(reason) between 1 and 500),
  confidence text not null check (confidence in ('confirmed', 'strong', 'moderate', 'limited')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.wrestler_aliases is
  'Reviewed spelling aliases that map raw imported names to one canonical wrestler identity.';

alter table public.wrestler_aliases enable row level security;

revoke all on public.wrestler_aliases from public, authenticated;
grant select on public.wrestler_aliases to anon;
grant select, insert, update, delete on public.wrestler_aliases to service_role;

create policy "Personal app can read wrestler aliases"
  on public.wrestler_aliases for select to anon
  using ((select private.personal_app_request_is_valid()));

create index wrestler_aliases_canonical_idx
  on public.wrestler_aliases (canonical_key);

alter table public.tournament_observations
  add column source_athlete_name text;

update public.tournament_observations
set source_athlete_name = athlete_name
where source_athlete_name is null;

alter table public.tournament_observations
  alter column source_athlete_name set not null;

comment on column public.tournament_observations.source_athlete_name is
  'The wrestler name exactly as extracted from the source; athlete_name may be canonicalized after identity review.';

insert into public.wrestler_aliases (
  alias_key, alias_name, canonical_key, canonical_name, reason, confidence
)
values (
  'grayson piaseck',
  'Grayson Piaseck',
  'grayson piasecki',
  'Grayson Piasecki',
  'User-confirmed identity. Piasecki appears in two earlier tournaments and both spellings share club, weight class, event, and an opponent at the Fall Championships.',
  'confirmed'
);

update public.matches
set winner_name = 'Grayson Piasecki'
where lower(trim(winner_name)) = 'grayson piaseck';

update public.matches
set loser_name = 'Grayson Piasecki'
where lower(trim(loser_name)) = 'grayson piaseck';

update public.tournament_entries
set athlete_name = 'Grayson Piasecki'
where lower(trim(athlete_name)) = 'grayson piaseck';

update public.tournament_observations
set athlete_name = 'Grayson Piasecki',
    identity_resolution = 'exact_existing',
    notes = case
      when lower(trim(source_athlete_name)) = 'grayson piaseck'
        then 'User-confirmed alias of Grayson Piasecki. Original source label preserved in source_athlete_name. Division and bracket labels are eligibility/class evidence, not exact birth year or body weight.'
      else 'User-confirmed canonical identity for the Grayson Piaseck alias review. Division and bracket labels are eligibility/class evidence, not exact birth year or body weight.'
    end,
    updated_at = now()
where lower(trim(athlete_name)) in ('grayson piaseck', 'grayson piasecki');

update public.wrestler_notes
set wrestler_key = 'grayson piasecki',
    wrestler_name = 'Grayson Piasecki',
    updated_at = now()
where wrestler_key = 'grayson piaseck'
   or lower(trim(wrestler_name)) = 'grayson piaseck';

select private.refresh_wrestler_evidence();

commit;
