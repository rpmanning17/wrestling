begin;
create table public.results (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 athlete text not null check(length(athlete) between 1 and 100),
 opponent text not null check(length(opponent) between 1 and 100),
 event_name text not null check(length(event_name) between 1 and 160),
 event_date date not null,
 season text not null check(length(season) between 1 and 20),
 division text not null check(length(division) between 1 and 80),
 outcome text not null check(outcome in ('Win','Loss','Draw')),
 method text not null default '' check(length(method)<=80),
 source_url text check(source_url is null or (source_url like 'https://%' and length(source_url)<=2048)),
 created_at timestamptz not null default now()
);
alter table public.results enable row level security;
revoke all on public.results from anon;
grant select,insert,update,delete on public.results to authenticated;
create policy owner_only on public.results for all to authenticated
 using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create index results_owner_date on public.results(owner_id,event_date desc);
create index results_owner_season on public.results(owner_id,season);
commit;

