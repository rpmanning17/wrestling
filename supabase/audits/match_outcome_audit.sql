-- Read-only audit of how match outcomes are represented in public.matches.
-- Run in the Supabase SQL editor BEFORE trusting the first rating calculation, then record the
-- findings in docs/STATUS.md and extend src/lib/rating/outcomes.ts if any win_type is unrecognised.
-- Nothing here writes data.

-- 1. Distinct win_type values and how often each occurs (the rating model classifies these in outcomes.ts).
select win_type, count(*) as bouts
from public.matches
group by win_type
order by bouts desc;

-- 2. Rows with no usable score text, by win_type.
select win_type, count(*) filter (where btrim(result) = '') as blank_result, count(*) as bouts
from public.matches
group by win_type
order by bouts desc;

-- 3. Placeholder or self-referential participants.
select count(*) filter (where lower(btrim(winner_name)) = lower(btrim(loser_name))) as self_matches,
       count(*) filter (where lower(btrim(winner_name)) in ('bye', 'unknown', '') or lower(btrim(loser_name)) in ('bye', 'unknown', '')) as placeholder_names
from public.matches;

-- 4. Possible duplicate bouts (same date, event, weight class, round, participants) that were not
--    collapsed on import. The rating pipeline drops exact duplicates; review these before relying on them.
select event_date, event_name, weight_class, round,
       lower(btrim(winner_name)) as winner_key, lower(btrim(loser_name)) as loser_key, count(*) as copies
from public.matches
group by 1, 2, 3, 4, 5, 6
having count(*) > 1
order by copies desc, event_date desc
limit 100;

-- 5. Same normalised name appearing on more than one club: possible different people sharing a name.
--    The rating model cannot tell them apart (identity key = lower(trim(name))).
with appearances as (
  select lower(btrim(winner_name)) as athlete_key, nullif(btrim(winner_team), '') as team from public.matches
  union all
  select lower(btrim(loser_name)), nullif(btrim(loser_team), '') from public.matches
)
select athlete_key, count(distinct team) as clubs
from appearances
where team is not null
group by athlete_key
having count(distinct team) > 1
order by clubs desc
limit 100;

-- 6. Bouts per season and the date coverage (the README notes a 2025 gap).
select season, count(*) as bouts, min(event_date) as first_date, max(event_date) as last_date
from public.matches
group by season
order by first_date;

-- 7. Weight-class labels whose bracket weight cannot be parsed (excluded from weight-context segments).
select weight_class, count(*) as bouts
from public.matches
where substring(weight_class from '([0-9]+(?:\.[0-9]+)?)\D*$') is null
group by weight_class
order by bouts desc
limit 50;
