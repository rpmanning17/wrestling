begin;

-- Canonical team names are event-specific labels, not permanent athlete affiliations.
create table public.club_aliases (
  alias_key text primary key,
  club_key text not null,
  canonical_name text not null,
  relationship text not null default 'alias' check (relationship in ('alias','team','program')),
  created_at timestamptz not null default now()
);
alter table public.club_aliases enable row level security;
revoke all on public.club_aliases from public, anon, authenticated;
grant select on public.club_aliases to anon;
grant select, insert, update, delete on public.club_aliases to service_role;
create policy "Personal app can read club aliases" on public.club_aliases
  for select to anon using ((select private.personal_app_request_is_valid()));

-- Only explicitly verified aliases. Spartan RTC remains separate from Lake Highland Prep.
insert into public.club_aliases (alias_key,club_key,canonical_name,relationship) values
 ('alpha', 'alpha-wrestling-club', 'Alpha Wrestling Club', 'alias'),
 ('alpha wc', 'alpha-wrestling-club', 'Alpha Wrestling Club', 'alias'),
 ('alpha wrestling club', 'alpha-wrestling-club', 'Alpha Wrestling Club', 'alias'),
 ('lhp', 'lake-highland-prep', 'Lake Highland Prep', 'alias'),
 ('lake highland prep', 'lake-highland-prep', 'Lake Highland Prep', 'alias'),
 ('spartan rtc', 'spartan-rtc', 'Spartan RTC', 'program'),
 ('spartanrtc', 'spartan-rtc', 'Spartan RTC', 'program'),
 ('spartan rtc lhp', 'spartan-rtc', 'Spartan RTC', 'program'),
 ('spartanrtc lhp', 'spartan-rtc', 'Spartan RTC', 'program'),
 ('natjwa', 'natjwa', 'NATJWA', 'alias'),
 ('natjwa gold', 'natjwa', 'NATJWA', 'team'),
 ('natjwa black', 'natjwa', 'NATJWA', 'team'),
 ('longwood wrestling club', 'longwood-wrestling-club', 'Longwood Wrestling Club', 'alias');

-- Current rated roster quality plus event-attributed contested results.
-- Historical seasons show performance in that season but roster quality is based
-- on the CURRENT rating model (never mislabel it as a historical rating).
create view public.club_rankings_current with (security_invoker = true) as
with participant_results as (
  select replace(m.season, '–', '-') as season, m.winner_name athlete_name,
    m.loser_name opponent_name, m.winner_team team, m.loser_team opponent_team,
    1::int as won
  from public.matches m where upper(trim(m.win_type)) in ('F','DEC','MD','TF')
  union all
  select replace(m.season, '–', '-') as season, m.loser_name athlete_name,
    m.winner_name opponent_name, m.loser_team team, m.winner_team opponent_team,
    0::int as won
  from public.matches m where upper(trim(m.win_type)) in ('F','DEC','MD','TF')
),
resolved as (
  select p.season, p.won,
    coalesce(a.club_key, 'raw:' || regexp_replace(lower(trim(p.team)), '[^a-z0-9]+', ' ', 'g')) as club_key,
    coalesce(a.canonical_name, trim(p.team)) as club_name,
    coalesce(opp_alias.club_key, 'raw:' || regexp_replace(lower(trim(p.opponent_team)), '[^a-z0-9]+', ' ', 'g')) as opponent_club_key,
    coalesce(athlete_alias.canonical_key, lower(trim(p.athlete_name))) as athlete_key,
    coalesce(rival_alias.canonical_key, lower(trim(p.opponent_name))) as opponent_key
  from participant_results p
  left join public.club_aliases a on a.alias_key = regexp_replace(lower(trim(p.team)), '[^a-z0-9]+', ' ', 'g')
  left join public.club_aliases opp_alias on opp_alias.alias_key = regexp_replace(lower(trim(p.opponent_team)), '[^a-z0-9]+', ' ', 'g')
  left join public.wrestler_aliases athlete_alias on athlete_alias.alias_key = lower(trim(p.athlete_name))
  left join public.wrestler_aliases rival_alias on rival_alias.alias_key = lower(trim(p.opponent_name))
  where nullif(trim(p.team), '') is not null and nullif(trim(p.athlete_name), '') is not null
),
scoped as (
  select 'ALL'::text as season, club_key, club_name, opponent_club_key, athlete_key, opponent_key, won from resolved
  union all
  select season, club_key, club_name, opponent_club_key, athlete_key, opponent_key, won from resolved
),
roster as (
  select distinct season, club_key, athlete_key from scoped
),
rated_roster as (
  select r.season,r.club_key,r.athlete_key,
    wr.conservative_score,wr.rating_deviation,
    row_number() over(partition by r.season,r.club_key order by wr.conservative_score desc nulls last) as power_rank
  from roster r left join public.wrestler_rating_current wr on wr.athlete_key=r.athlete_key
),
roster_summary as (
  select season,club_key,
    count(*)::int as wrestlers,
    count(conservative_score)::int as rated_wrestlers,
    round(avg(conservative_score)::numeric,1) as avg_conservative,
    round(percentile_cont(0.5) within group (order by conservative_score)::numeric,1) as median_conservative,
    round(avg(conservative_score) filter(where power_rank<=5)::numeric,1) as top_five_conservative,
    round(avg(rating_deviation)::numeric,1) as avg_rating_deviation
  from rated_roster group by season,club_key
),
bout_summary as (
  select s.season,s.club_key,max(s.club_name) as display_name,
    count(*)::int as bouts,
    count(*) filter(where s.won=1)::int as wins,
    count(*) filter(where s.won=0)::int as losses,
    count(*) filter(where s.club_key=s.opponent_club_key)::int as in_house_bouts,
    round(avg(opp.rating)::numeric,1) as avg_opponent_rating
  from scoped s
  left join public.wrestler_rating_current opp on opp.athlete_key=s.opponent_key
  group by s.season,s.club_key
)
select b.season,b.club_key,b.display_name as club_name,b.bouts,b.wins,b.losses,
  r.wrestlers,r.rated_wrestlers,r.avg_conservative,r.median_conservative,
  r.top_five_conservative,r.avg_rating_deviation,b.avg_opponent_rating,b.in_house_bouts
from bout_summary b join roster_summary r on r.season=b.season and r.club_key=b.club_key;

revoke all on public.club_rankings_current from public, authenticated;
grant select on public.club_rankings_current to anon;

-- Per-event club roster; does not imply permanent club affiliation.
create view public.club_roster_current with (security_invoker = true) as
with participations as (
  select season,winner_team as team,winner_name as athlete_name,1 as won
  from public.matches where upper(trim(win_type)) in ('F','DEC','MD','TF')
  union all
  select season,loser_team as team,loser_name as athlete_name,0 as won
  from public.matches where upper(trim(win_type)) in ('F','DEC','MD','TF')
), normalized as (
  select replace(p.season,'–','-') as season,
    coalesce(a.club_key,'raw:' || regexp_replace(lower(trim(p.team)),'[^a-z0-9]+',' ','g')) as club_key,
    coalesce(a.canonical_name,trim(p.team)) as club_name,
    coalesce(w.canonical_key,lower(trim(p.athlete_name))) as athlete_key,
    coalesce(w.canonical_name,trim(p.athlete_name)) as athlete_name,p.won
  from participations p
  left join public.club_aliases a on a.alias_key=regexp_replace(lower(trim(p.team)),'[^a-z0-9]+',' ','g')
  left join public.wrestler_aliases w on w.alias_key=lower(trim(p.athlete_name))
  where nullif(trim(p.team),'') is not null and nullif(trim(p.athlete_name),'') is not null
), scoped as (
  select 'ALL'::text as season,club_key,club_name,athlete_key,athlete_name,won from normalized
  union all
  select season,club_key,club_name,athlete_key,athlete_name,won from normalized
)
select s.season,s.club_key,max(s.club_name) as club_name,s.athlete_key,
  max(s.athlete_name) as athlete_name,count(*)::int as bouts,
  sum(s.won)::int as wins,(count(*)-sum(s.won))::int as losses,
  wr.rating,wr.rating_deviation,wr.conservative_score,wr.sos_expected_win_pct,
  wr.avg_opponent_rating,wr.rating_status
from scoped s
left join public.wrestler_rating_current wr on wr.athlete_key=s.athlete_key
group by s.season,s.club_key,s.athlete_key,wr.rating,wr.rating_deviation,
  wr.conservative_score,wr.sos_expected_win_pct,wr.avg_opponent_rating,wr.rating_status;

revoke all on public.club_roster_current from public, authenticated;
grant select on public.club_roster_current to anon;
commit;
