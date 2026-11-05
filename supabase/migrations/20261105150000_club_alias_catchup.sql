-- Finite, reviewed aliases missing from the 2026-11-04 club normalization.
-- Keep every source team label and bout; only derived club views change.
begin;
set local lock_timeout = '5s';
lock table public.club_aliases in share row exclusive mode;

create temporary table club_alias_catchup_plan (
  source_name text not null,
  alias_key text primary key,
  club_key text not null,
  canonical_name text not null,
  relationship text not null
) on commit drop;

insert into club_alias_catchup_plan values
  ('FL Scorpions Wresting Club', 'fl scorpions wresting club', 'florida-scorpions', 'Florida Scorpions', 'alias'),
  ('FL Scorpions Wrestling Club', 'fl scorpions wrestling club', 'florida-scorpions', 'Florida Scorpions', 'alias'),
  ('Florida scorpion', 'florida scorpion', 'florida-scorpions', 'Florida Scorpions', 'alias'),
  ('Florida Scorpions Black', 'florida scorpions black', 'florida-scorpions', 'Florida Scorpions', 'team'),
  ('Florida Scorpions Black - Paid', 'florida scorpions black paid', 'florida-scorpions', 'Florida Scorpions', 'team'),
  ('Florida Scorpions Gold', 'florida scorpions gold', 'florida-scorpions', 'Florida Scorpions', 'team'),
  ('Florida Scorpions Gold - Paid', 'florida scorpions gold paid', 'florida-scorpions', 'Florida Scorpions', 'team'),
  ('Florida Scorpions Wrestling Cl', 'florida scorpions wrestling cl', 'florida-scorpions', 'Florida Scorpions', 'alias'),
  ('Scorpions', 'scorpions', 'florida-scorpions', 'Florida Scorpions', 'alias'),
  ('Scorpions FL', 'scorpions fl', 'florida-scorpions', 'Florida Scorpions', 'alias'),
  ('Scorpions Florida', 'scorpions florida', 'florida-scorpions', 'Florida Scorpions', 'alias'),
  ('Scorpions Florida Wrestling', 'scorpions florida wrestling', 'florida-scorpions', 'Florida Scorpions', 'alias'),
  ('Scorpions Florida wrestling club', 'scorpions florida wrestling club', 'florida-scorpions', 'Florida Scorpions', 'alias'),
  ('Scorpions Wrestling Club', 'scorpions wrestling club', 'florida-scorpions', 'Florida Scorpions', 'alias'),
  ('Kongkrete Grey', 'kongkrete grey', 'kongkrete-wrestling-academy', 'KONGKRETE WRESTLING ACADEMY', 'team'),
  ('Kongkrete Kids Club', 'kongkrete kids club', 'kongkrete-wrestling-academy', 'KONGKRETE WRESTLING ACADEMY', 'program'),
  ('Kongkrete Red', 'kongkrete red', 'kongkrete-wrestling-academy', 'KONGKRETE WRESTLING ACADEMY', 'team'),
  ('Kongkrete Wreseling Academy', 'kongkrete wreseling academy', 'kongkrete-wrestling-academy', 'KONGKRETE WRESTLING ACADEMY', 'alias'),
  ('River Springs', 'river springs', 'river-springs', 'River Springs', 'alias'),
  ('Riversprings', 'riversprings', 'river-springs', 'River Springs', 'alias'),
  ('South Broward', 'south broward', 'south-broward-high-school', 'South Broward High School', 'alias'),
  ('South Broward Bulldogs', 'south broward bulldogs', 'south-broward-high-school', 'South Broward High School', 'team'),
  ('South Broward High School', 'south broward high school', 'south-broward-high-school', 'South Broward High School', 'alias'),
  ('South Broward High School - Girls', 'south broward high school girls', 'south-broward-high-school', 'South Broward High School', 'team'),
  ('South Broward High School Wres', 'south broward high school wres', 'south-broward-high-school', 'South Broward High School', 'alias'),
  ('Well Trained', 'well trained', 'well-trained', 'Well Trained', 'alias'),
  ('Well Trained Wrestling Club', 'well trained wrestling club', 'well-trained', 'Well Trained', 'alias');

do $$
begin
  if (select count(*) from club_alias_catchup_plan) <> 27 then
    raise exception 'Unexpected club catch-up plan count';
  end if;
  if exists (select 1 from club_alias_catchup_plan where alias_key <>
    regexp_replace(lower(trim(source_name)), '[^a-z0-9]+', ' ', 'g')) then
    raise exception 'Club catch-up alias key differs from database normalizer';
  end if;
  if exists (select 1 from club_alias_catchup_plan p join public.club_aliases a using(alias_key)) then
    raise exception 'Club catch-up alias already exists; review before replay';
  end if;
  if not exists (select 1 from public.club_aliases where alias_key = 'florida scorpions'
    and club_key = 'florida-scorpions' and canonical_name = 'Florida Scorpions') or
    not exists (select 1 from public.club_aliases where alias_key = 'kongkrete wrestling academy'
    and club_key = 'kongkrete-wrestling-academy'
    and canonical_name = 'KONGKRETE WRESTLING ACADEMY') then
    raise exception 'Existing canonical club mapping changed; review before applying catch-up';
  end if;
end $$;

create table private.club_alias_catchup_20261105_inserted
  (like public.club_aliases including defaults including constraints);
alter table private.club_alias_catchup_20261105_inserted add primary key (alias_key);
alter table private.club_alias_catchup_20261105_inserted enable row level security;
revoke all on private.club_alias_catchup_20261105_inserted
  from public, anon, authenticated, service_role;

with inserted as (
  insert into public.club_aliases (alias_key, club_key, canonical_name, relationship)
  select alias_key, club_key, canonical_name, relationship from club_alias_catchup_plan
  returning *
)
insert into private.club_alias_catchup_20261105_inserted select * from inserted;

do $$ begin
  if (select count(*) from private.club_alias_catchup_20261105_inserted) <> 27 then
    raise exception 'Unexpected club catch-up insertion count';
  end if;
end $$;
commit;
