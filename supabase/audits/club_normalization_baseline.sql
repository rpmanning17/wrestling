-- Read-only baseline: run before and after the reviewed club alias migration.
-- Checksums cover complete rows; compare only results produced by this same query.
select 'matches' as object_name, count(*) as row_count,
  md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by id),'')) as checksum
from public.matches t
union all
select 'club_aliases', count(*),
  md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by alias_key),''))
from public.club_aliases t
union all
select 'wrestler_model_ratings', count(*),
  md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by model_id,athlete_key),''))
from public.wrestler_model_ratings t
union all
select 'wrestler_rating_history', count(*),
  md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by to_jsonb(t)::text),''))
from public.wrestler_rating_history t
union all
select 'rating_models', count(*),
  md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by id),''))
from public.rating_models t
union all
select 'wrestler_strength_current', count(*),
  md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by athlete_key),''))
from public.wrestler_strength_current t;

-- Club participation counts are wrestler appearances, not unique matches.
select season, count(*) as clubs, sum(wrestlers) as roster_memberships,
  sum(bouts) as participations, sum(wins) as wins, sum(losses) as losses,
  sum(in_house_bouts) as in_house_participations
from public.club_rankings_current where season='ALL' group by season;

-- Raw contested audit includes blank team labels, as in the approved projection.
with resolved as (
  select coalesce(a.club_key, 'raw:' || regexp_replace(lower(trim(m.winner_team)), '[^a-z0-9]+', ' ', 'g')) as winner_club,
    coalesce(b.club_key, 'raw:' || regexp_replace(lower(trim(m.loser_team)), '[^a-z0-9]+', ' ', 'g')) as loser_club
  from public.matches m
  left join public.club_aliases a on a.alias_key=regexp_replace(lower(trim(m.winner_team)), '[^a-z0-9]+', ' ', 'g')
  left join public.club_aliases b on b.alias_key=regexp_replace(lower(trim(m.loser_team)), '[^a-z0-9]+', ' ', 'g')
  where upper(trim(m.win_type)) in ('F','DEC','MD','TF')
    and lower(trim(m.winner_name))<>lower(trim(m.loser_name))
)
select count(*) as contested_matches,
  count(*) filter(where winner_club=loser_club) as in_house_matches
from resolved;

