begin;

alter table public.tournament_entries
  rename column birth_year_start to division_birth_year_start;

alter table public.tournament_entries
  rename column birth_year_end to division_birth_year_end;

alter table public.tournament_entries
  rename constraint tournament_entries_birth_year_order
  to tournament_entries_division_birth_year_order;

commit;
