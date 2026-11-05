/** Reuses the validated cohort vote and tier formulas with person-keyed source rows. */
import { readFileSync, writeFileSync } from "node:fs";

const source = readFileSync("supabase/migrations/20261104143500_cohort_tiers_and_rating_clarity.sql", "utf8");
const cohortStart = source.indexOf("create or replace view public.wrestler_cohort_current");
const strengthStart = source.indexOf("create or replace view public.wrestler_strength_current");
const clubsStart = source.indexOf("-- Existing club aggregate", strengthStart);
if (cohortStart < 0 || strengthStart < 0 || clubsStart < 0) throw new Error("Validated cohort source view changed");
const raw = `with raw as (
  select e.person_id::text athlete_key,e.athlete_name,e.team,e.event_date,e.event_name,e.age_group,
    e.bracket_weight_lbs,e.weigh_in_lbs,4 as source_rank
  from public.person_tournament_entries e where e.person_id is not null
  union all
  select o.person_id::text,o.athlete_name,o.team,o.event_date,o.event_name,o.age_group,
    coalesce(o.bracket_weight_lbs,substring(o.bracket_weight_label from '([0-9]+(?:[.][0-9]+)?)[^0-9]*$')::numeric),null,3
  from public.person_tournament_observations o
  where o.person_id is not null and o.identity_resolution in ('exact_existing','new_identity')
  union all
  select coalesce(entry.person_id,
      case when lower(trim(e.athlete_name))=lower(trim(m.winner_name)) then m.winner_person_id end,
      case when lower(trim(e.athlete_name))=lower(trim(m.loser_name)) then m.loser_person_id end)::text,
    e.athlete_name,e.team,e.event_date,e.event_name,e.age_group,e.bracket_weight_lbs,null,2
  from public.wrestler_evidence e
  left join public.person_tournament_entries entry on entry.id=e.source_entry_id
  left join public.person_matches m on m.id=e.source_match_id
  where coalesce(entry.person_id,
      case when lower(trim(e.athlete_name))=lower(trim(m.winner_name)) then m.winner_person_id end,
      case when lower(trim(e.athlete_name))=lower(trim(m.loser_name)) then m.loser_person_id end) is not null
  union all
  select p.person_id::text,p.name,p.team,m.event_date,m.event_name,
    (regexp_match(m.weight_class, '(?<![0-9])(6|8|10|12|14|16|18) ?[uU](?![a-zA-Z])'))[1] || 'U',
    substring(m.weight_class from '([0-9]+(?:[.][0-9]+)?)[^0-9]*$')::numeric,null,1
  from public.person_matches m cross join lateral
    (values (m.winner_name,m.winner_team,m.winner_person_id),
            (m.loser_name,m.loser_team,m.loser_person_id)) p(name,team,person_id)
  where p.person_id is not null
), canonical as (
  select r.athlete_key,p.display_name athlete_name,r.team,r.event_date,
    regexp_replace(lower(trim(r.event_name)), '\\s+', ' ', 'g') event_name,
    r.age_group,r.bracket_weight_lbs,r.weigh_in_lbs,r.source_rank
  from raw r join public.wrestler_people p on p.id=r.athlete_key::uuid
  where trim(r.event_name)<>''
), dates as (`;
const cohort = source.slice(cohortStart, strengthStart).replace(/with raw as \([\s\S]*?^\), canonical as \([\s\S]*?^\), dates as \(/m, () => raw)
  .replaceAll("public.wrestler_cohort_current", "public.person_cohort_current");
if (!cohort.includes("public.person_cohort_current") || cohort.includes("public.wrestler_aliases")) throw new Error("Cohort replacement failed");
const strength = source.slice(strengthStart, clubsStart)
  .replaceAll("public.wrestler_strength_current", "public.person_strength_current")
  .replaceAll("public.wrestler_cohort_current", "public.person_cohort_current")
  .replaceAll("public.wrestler_rating_current", "public.person_rating_current");
const sql = `begin;\n${cohort}\n${strength}\nrevoke all on public.person_cohort_current,public.person_strength_current from public,authenticated;\ngrant select on public.person_cohort_current,public.person_strength_current to anon,service_role;\ncommit;\n`;
writeFileSync("supabase/migrations/20261105181000_person_cohort_views.sql", sql);
