begin;

create index tournament_observations_resolved_entry_idx
  on public.tournament_observations (resolved_entry_id)
  where resolved_entry_id is not null;

commit;
