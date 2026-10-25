begin;

create table public.matches (
 id uuid primary key default gen_random_uuid(),
 event_date date not null,
 season text not null check (char_length(season) between 1 and 20),
 event_name text not null check (char_length(event_name) between 1 and 160),
 city text not null default '' check (char_length(city) <= 100),
 state text not null default '' check (char_length(state) <= 10),
 weight_class text not null check (char_length(weight_class) between 1 and 40),
 round text not null default '' check (char_length(round) <= 80),
 winner_name text not null check (char_length(winner_name) between 1 and 100),
 winner_team text not null default '' check (char_length(winner_team) <= 160),
 loser_name text not null check (char_length(loser_name) between 1 and 100),
 loser_team text not null default '' check (char_length(loser_team) <= 160),
 result text not null default '' check (char_length(result) <= 80),
 win_type text not null check (char_length(win_type) between 1 and 20),
 source_file text check (source_file is null or char_length(source_file) <= 160),
 source_row integer check (source_row is null or source_row > 1),
 search_text text generated always as (
  lower(
   coalesce(winner_name, '') || ' ' ||
   coalesce(loser_name, '') || ' ' ||
   coalesce(winner_team, '') || ' ' ||
   coalesce(loser_team, '') || ' ' ||
   coalesce(event_name, '')
  )
 ) stored,
 created_at timestamptz not null default now(),
 constraint matches_source_unique unique (source_file, source_row)
);

alter table public.matches enable row level security;

revoke all on public.matches from public, authenticated;
grant select, insert, update, delete on public.matches to anon;

create policy "Personal app can read matches"
 on public.matches for select to anon
 using ((select private.personal_app_request_is_valid()));

create policy "Personal app can add matches"
 on public.matches for insert to anon
 with check ((select private.personal_app_request_is_valid()));

create policy "Personal app can update matches"
 on public.matches for update to anon
 using ((select private.personal_app_request_is_valid()))
 with check ((select private.personal_app_request_is_valid()));

create policy "Personal app can delete matches"
 on public.matches for delete to anon
 using ((select private.personal_app_request_is_valid()));

create index matches_event_date_idx on public.matches (event_date desc);
create index matches_season_event_date_idx on public.matches (season, event_date desc);

drop table public.results;

commit;
