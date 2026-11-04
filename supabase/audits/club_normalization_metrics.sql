-- Independent raw-participation check against every current club/season summary.
-- Keeps repeated wrestler pairs and opposite results; they are distinct raw rows.
with ratings as materialized (select athlete_key,rating from public.wrestler_rating_current),
participants as materialized (
 select scope.season,
 coalesce(a.club_key,'raw:'||regexp_replace(lower(trim(p.team)),'[^a-z0-9]+',' ','g')) club_key,
 coalesce(w.canonical_key,lower(trim(p.athlete))) athlete_key,
 coalesce(o.canonical_key,lower(trim(p.opponent))) opponent_key,p.won
 from public.matches m
 cross join lateral(values(m.winner_name,m.winner_team,m.loser_name,1),
   (m.loser_name,m.loser_team,m.winner_name,0)) p(athlete,team,opponent,won)
 cross join lateral(values('ALL'::text),(replace(m.season,'–','-'))) scope(season)
 left join public.club_aliases a on a.alias_key=regexp_replace(lower(trim(p.team)),'[^a-z0-9]+',' ','g')
 left join public.wrestler_aliases w on w.alias_key=lower(trim(p.athlete))
 left join public.wrestler_aliases o on o.alias_key=lower(trim(p.opponent))
 where upper(trim(m.win_type)) in ('F','DEC','MD','TF')
   and lower(trim(m.winner_name))<>lower(trim(m.loser_name))
   and nullif(trim(p.team),'') is not null and nullif(trim(p.athlete),'') is not null
),
expected as (
 select p.season,p.club_key,count(*) bouts,sum(won) wins,count(*)-sum(won) losses,
   count(distinct p.athlete_key) wrestlers,
   round(avg(r.rating)::numeric,1) avg_opponent_rating,
   avg(1.0::double precision/(1.0+power(10.0::double precision,
     (r.rating::double precision-1500.0)/400.0))) schedule_expected_win_pct
 from participants p left join ratings r on r.athlete_key=p.opponent_key
 group by p.season,p.club_key
),
actual as materialized(select * from public.club_rankings_current)
select count(*) checked_club_seasons,
 count(*) filter(where (e.bouts,e.wins,e.losses,e.wrestlers,e.avg_opponent_rating)
   is distinct from (a.bouts,a.wins,a.losses,a.wrestlers,a.avg_opponent_rating)
   or (e.schedule_expected_win_pct is null)<>(a.schedule_expected_win_pct is null)
   or abs(e.schedule_expected_win_pct-a.schedule_expected_win_pct)>1e-12
   or e.club_key is null or a.club_key is null) mismatches
from expected e full join actual a using(season,club_key);

