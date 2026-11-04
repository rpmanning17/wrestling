begin;
-- Resolve each literal team label once; records, roster, SOS and caller security unchanged.
create or replace view public.club_rankings_current with (security_invoker = true) as
with active_ratings as materialized (select * from public.wrestler_rating_current),
team_labels as materialized (
  select distinct p.team from public.matches m
  cross join lateral (values (m.winner_team),(m.loser_team)) p(team)
), team_keys as materialized (
  select team,regexp_replace(lower(trim(team)), '[^a-z0-9]+', ' ', 'g') as alias_key from team_labels
), team_identities as materialized (
  select t.team,coalesce(a.club_key,'raw:'||t.alias_key) as club_key,
    coalesce(a.canonical_name,trim(t.team)) as club_name
  from team_keys t left join public.club_aliases a on a.alias_key=t.alias_key
), participant_results as (
  select replace(m.season, '–', '-') as season, m.winner_name athlete_name,
    m.loser_name opponent_name, m.winner_team team, m.loser_team opponent_team,
    1::int as won
  from public.matches m where upper(trim(m.win_type)) in ('F','DEC','MD','TF') and lower(trim(m.winner_name)) <> lower(trim(m.loser_name))
  union all
  select replace(m.season, '–', '-') as season, m.loser_name athlete_name,
    m.winner_name opponent_name, m.loser_team team, m.winner_team opponent_team,
    0::int as won
  from public.matches m where upper(trim(m.win_type)) in ('F','DEC','MD','TF') and lower(trim(m.winner_name)) <> lower(trim(m.loser_name))
),
resolved as (
  select p.season, p.won,
    a.club_key as club_key,
    a.club_name as club_name,
    opp_alias.club_key as opponent_club_key,
    coalesce(athlete_alias.canonical_key, lower(trim(p.athlete_name))) as athlete_key,
    coalesce(rival_alias.canonical_key, lower(trim(p.opponent_name))) as opponent_key
  from participant_results p
  left join team_identities a on a.team=p.team
  left join team_identities opp_alias on opp_alias.team=p.opponent_team
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
  from roster r left join active_ratings wr on wr.athlete_key=r.athlete_key
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
rated_participants as materialized (
  select s.*,opp.rating as opponent_rating from scoped s
  left join active_ratings opp on opp.athlete_key=s.opponent_key
),
bout_summary as (
  select s.season,s.club_key,max(s.club_name) as display_name,
    count(*)::int as bouts,
    count(*) filter(where s.won=1)::int as wins,
    count(*) filter(where s.won=0)::int as losses,
    count(*) filter(where s.club_key=s.opponent_club_key)::int as in_house_bouts,
    round(avg(s.opponent_rating)::numeric,1) as avg_opponent_rating,
    avg(1.0::double precision / (1.0 + power(10.0::double precision, (s.opponent_rating::double precision-1500.0)/400.0)))::numeric as schedule_expected_win_pct
  from rated_participants s
  group by s.season,s.club_key
)
select b.season,b.club_key,b.display_name as club_name,b.bouts,b.wins,b.losses,
  r.wrestlers,r.rated_wrestlers,r.avg_conservative,r.median_conservative,
  r.top_five_conservative,r.avg_rating_deviation,b.avg_opponent_rating,b.in_house_bouts,b.schedule_expected_win_pct
from bout_summary b join roster_summary r on r.season=b.season and r.club_key=b.club_key;
commit;
