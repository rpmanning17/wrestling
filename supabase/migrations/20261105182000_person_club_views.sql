begin;

-- A wrestler's club is the team recorded on each bout. Roster aggregation uses
-- resolved person IDs; unknown sides cannot inflate a different person's record.
create view public.person_club_roster_current with (security_invoker = true) as
with participations as (
  select replace(m.season,'–','-') season,m.winner_team team,m.winner_person_id person_id,1 won
  from public.person_matches m
  where upper(trim(m.win_type)) in ('F','DEC','MD','TF')
    and m.winner_person_id is not null and m.loser_person_id is not null
    and m.winner_person_id <> m.loser_person_id
  union all
  select replace(m.season,'–','-'),m.loser_team,m.loser_person_id,0
  from public.person_matches m
  where upper(trim(m.win_type)) in ('F','DEC','MD','TF')
    and m.winner_person_id is not null and m.loser_person_id is not null
    and m.winner_person_id <> m.loser_person_id
), normalized as (
  select p.season,
    coalesce(a.club_key,'raw:'||regexp_replace(lower(trim(p.team)),'[^a-z0-9]+',' ','g')) club_key,
    coalesce(a.canonical_name,trim(p.team)) club_name,p.person_id,p.won
  from participations p
  left join public.club_aliases a
    on a.alias_key=regexp_replace(lower(trim(p.team)),'[^a-z0-9]+',' ','g')
  where nullif(trim(p.team),'') is not null
), scoped as (
  select 'ALL'::text season,club_key,club_name,person_id,won from normalized
  union all select season,club_key,club_name,person_id,won from normalized
)
select s.season,s.club_key,max(s.club_name) club_name,s.person_id::text athlete_key,
  p.display_name athlete_name,count(*)::int bouts,sum(s.won)::int wins,
  (count(*)-sum(s.won))::int losses,
  r.rating,r.rating_deviation,r.conservative_score,r.sos_expected_win_pct,
  r.avg_opponent_rating,r.rating_status
from scoped s
join public.wrestler_people p on p.id=s.person_id
left join public.person_rating_current r on r.person_id=s.person_id
group by s.season,s.club_key,s.person_id,p.display_name,r.rating,r.rating_deviation,
  r.conservative_score,r.sos_expected_win_pct,r.avg_opponent_rating,r.rating_status;

create view public.person_club_rankings_current with (security_invoker = true) as
with participation as (
  select replace(m.season,'–','-') season,m.winner_team team,m.loser_team opponent_team,
    m.winner_person_id person_id,m.loser_person_id opponent_id,1 won
  from public.person_matches m where upper(trim(m.win_type)) in ('F','DEC','MD','TF')
    and m.winner_person_id is not null and m.loser_person_id is not null
    and m.winner_person_id <> m.loser_person_id
  union all
  select replace(m.season,'–','-'),m.loser_team,m.winner_team,m.loser_person_id,m.winner_person_id,0
  from public.person_matches m where upper(trim(m.win_type)) in ('F','DEC','MD','TF')
    and m.winner_person_id is not null and m.loser_person_id is not null
    and m.winner_person_id <> m.loser_person_id
), resolved as (
  select p.season,p.person_id,p.opponent_id,p.won,
    coalesce(a.club_key,'raw:'||regexp_replace(lower(trim(p.team)),'[^a-z0-9]+',' ','g')) club_key,
    coalesce(a.canonical_name,trim(p.team)) club_name,
    coalesce(o.club_key,'raw:'||regexp_replace(lower(trim(p.opponent_team)),'[^a-z0-9]+',' ','g')) opponent_club_key
  from participation p
  left join public.club_aliases a on a.alias_key=regexp_replace(lower(trim(p.team)),'[^a-z0-9]+',' ','g')
  left join public.club_aliases o on o.alias_key=regexp_replace(lower(trim(p.opponent_team)),'[^a-z0-9]+',' ','g')
  where nullif(trim(p.team),'') is not null
), scoped as (
  select 'ALL'::text season,club_key,club_name,opponent_club_key,person_id,opponent_id,won from resolved
  union all select season,club_key,club_name,opponent_club_key,person_id,opponent_id,won from resolved
), roster as (
  select distinct season,club_key,person_id from scoped
), rated_roster as (
  select r.season,r.club_key,r.person_id,p.conservative_score,p.rating_deviation,
    row_number() over(partition by r.season,r.club_key order by p.conservative_score desc nulls last) power_rank
  from roster r left join public.person_rating_current p on p.person_id=r.person_id
), roster_summary as (
  select season,club_key,count(*)::int wrestlers,count(conservative_score)::int rated_wrestlers,
    round(avg(conservative_score)::numeric,1) avg_conservative,
    round(percentile_cont(0.5) within group(order by conservative_score)::numeric,1) median_conservative,
    round(avg(conservative_score) filter(where power_rank<=5)::numeric,1) top_five_conservative,
    round(avg(rating_deviation)::numeric,1) avg_rating_deviation
  from rated_roster group by season,club_key
), rated as (
  select s.*,opponent.rating opponent_rating from scoped s
  left join public.person_rating_current opponent on opponent.person_id=s.opponent_id
), bouts as (
  select season,club_key,max(club_name) club_name,count(*)::int bouts,
    count(*) filter(where won=1)::int wins,count(*) filter(where won=0)::int losses,
    count(*) filter(where club_key=opponent_club_key)::int in_house_bouts,
    round(avg(opponent_rating)::numeric,1) avg_opponent_rating,
    avg(1.0::double precision/(1.0+power(10.0::double precision,
      (opponent_rating::double precision-1500.0)/400.0)))::numeric schedule_expected_win_pct
  from rated group by season,club_key
)
select b.season,b.club_key,b.club_name,b.bouts,b.wins,b.losses,
  r.wrestlers,r.rated_wrestlers,r.avg_conservative,r.median_conservative,
  r.top_five_conservative,r.avg_rating_deviation,b.avg_opponent_rating,
  b.in_house_bouts,b.schedule_expected_win_pct
from bouts b join roster_summary r on r.season=b.season and r.club_key=b.club_key;

revoke all on public.person_club_roster_current,public.person_club_rankings_current from public,authenticated;
grant select on public.person_club_roster_current,public.person_club_rankings_current to anon,service_role;
commit;
