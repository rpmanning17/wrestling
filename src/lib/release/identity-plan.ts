/** Conservative identity plan for one imported source file (docs/RELEASE_PIPELINE.md).
 * Same rule as the owner-authorized USA release (supabase/audits/usa_identity_release_20261109.sql):
 * - link: exactly one historical person with the exact full name (case/space-insensitive) and at
 *   least two of that name's bouts within 730 days, 15 lb and two age groups of this appearance;
 * - new: a name never assigned before, grouped by name plus known club alias, with bounded age and
 *   weight (or one unteamed event); never merged across clubs;
 * - held: everything else, including both sides of a bout resolving to one person.
 * Identical names alone never link. Owner overrides are explicit and recorded separately.
 */
import { createHash } from "node:crypto";

export const IDENTITY_PLAN_SQL = `
with new_sides as (
  select m.id::text source_id, m.source_file, m.source_row, k.kind source_kind,
    case when k.kind='match_winner' then m.winner_name else m.loser_name end recorded_name,
    case when k.kind='match_winner' then m.winner_team else m.loser_team end team_raw,
    m.event_date, m.event_name, m.weight_class
  from public.matches m cross join (values ('match_winner'),('match_loser')) k(kind)
  where m.source_file = any($1::text[])
), base as (
  select s.*, lower(trim(s.recorded_name)) nk, lower(trim(coalesce(s.team_raw,''))) team,
    (regexp_match(s.weight_class,'([0-9]+)(?:-[0-9]+)?$'))[1]::numeric wt,
    (regexp_match(s.weight_class,'(6|8|10|12|14)U','i'))[1]::int age
  from new_sides s
), old_sides as (
  select lower(trim(a.recorded_name)) nk, a.person_id, m.event_date,
    (regexp_match(m.weight_class,'([0-9]+)$'))[1]::numeric wt,
    (regexp_match(m.weight_class,'(6|8|10|12|14)U','i'))[1]::int age
  from public.source_identity_current_rows a join public.matches m on a.source_id = m.id::text
  where a.source_kind in ('match_winner','match_loser') and a.person_id is not null
    and m.source_file <> all($1::text[]) and lower(trim(a.recorded_name)) in (select nk from base)
), old_names as (
  select nk, count(distinct person_id)::int num_people, min(person_id::text) one_person from old_sides group by nk
), linked as (
  select b.*, onm.num_people, onm.one_person,
    (select count(*) from old_sides o where o.nk = b.nk and b.wt is not null and o.wt is not null
      and abs(b.wt - o.wt) <= 15 and abs(b.event_date - o.event_date) < 730
      and (o.age is null or b.age is null or abs(o.age - b.age) <= 2))::int compatible
  from base b left join old_names onm on onm.nk = b.nk
), keyed as (
  select l.*, coalesce(ca.club_key, 'raw:' || l.team) club_key
  from linked l left join public.club_aliases ca on ca.alias_key = l.team and ca.relationship = 'alias'
), groups as (
  select nk, club_key, min(recorded_name) display_name,
    (max(age) - min(age) <= 2 and max(wt) - min(wt) <= 35
     and (bool_and(team <> '') or (count(distinct event_date::text || '|' || event_name) = 1 and max(wt) - min(wt) <= 15))) eligible
  from keyed where num_people is null group by nk, club_key
), resolved as (
  select k.source_id, k.source_file, k.source_row, k.source_kind, k.recorded_name, k.compatible, coalesce(k.num_people, 0) num_people,
    case when k.num_people = 1 and k.compatible >= 2 then 'link'
         when k.num_people is null and g.eligible then 'new' else 'held' end resolution,
    case when k.num_people = 1 and k.compatible >= 2 then k.one_person
         when k.num_people is null and g.eligible then 'new:' || k.nk || '|' || k.club_key end identity_key,
    case when k.num_people is null and g.eligible then g.display_name end new_display_name
  from keyed k left join groups g on g.nk = k.nk and g.club_key = k.club_key
)
select r.source_id, r.source_file, r.source_row, r.source_kind, r.recorded_name, r.compatible, r.num_people,
  case when self_match then 'held' else r.resolution end resolution,
  case when self_match then null else r.identity_key end identity_key,
  case when self_match then null else r.new_display_name end new_display_name
from resolved r cross join lateral (select exists (select 1 from resolved o where o.source_id = r.source_id
  and o.source_kind <> r.source_kind and r.identity_key is not null and o.identity_key = r.identity_key) self_match) s
order by r.source_file collate "C", r.source_row, r.source_kind`;

export type PlanRow = {
  source_id: string; source_file: string; source_row: number; source_kind: "match_winner" | "match_loser"; recorded_name: string;
  compatible: number; num_people: number; resolution: "link" | "new" | "held" | "owner_hold" | "owner_person";
  identity_key: string | null; new_display_name: string | null;
};
export type IdentityOverride = { source_file?: string; source_row: number; side: "winner" | "loser"; action: "hold" | "person"; person_id?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Owner decisions supplied in the run request; applied after the rule, never inferred. */
export function applyOverrides(rows: PlanRow[], overrides: IdentityOverride[] = []): PlanRow[] {
  const out = rows.map(r => ({ ...r }));
  for (const o of overrides) {
    const kind = o.side === "winner" ? "match_winner" : o.side === "loser" ? "match_loser" : null;
    const row = out.find(r => r.source_row === o.source_row && r.source_kind === kind && (!o.source_file || r.source_file === o.source_file));
    if (!row) throw new Error(`Override targets no imported side: row ${o.source_row} ${o.side}`);
    if (o.action === "hold") Object.assign(row, { resolution: "owner_hold", identity_key: null, new_display_name: null });
    else if (o.action === "person" && o.person_id && UUID.test(o.person_id)) {
      Object.assign(row, { resolution: "owner_person", identity_key: o.person_id, new_display_name: null });
    } else throw new Error("Invalid identity override");
  }
  return out;
}

/** Stable digest over everything except database row UUIDs (which differ between dry and real runs). */
export function planDigest(rows: PlanRow[]) {
  const canonical = rows.map(r => [r.source_file, r.source_row, r.source_kind, r.recorded_name, r.resolution, r.identity_key,
    r.new_display_name, r.compatible, r.num_people]);
  return createHash("sha256").update(JSON.stringify(["identity-plan-v1", canonical])).digest("hex");
}

export function planSummary(rows: PlanRow[]) {
  const by = (k: PlanRow["resolution"]) => rows.filter(r => r.resolution === k).length;
  return { sides: rows.length, link: by("link"), new: by("new"), held: by("held"), owner_hold: by("owner_hold"),
    owner_person: by("owner_person"), new_people: new Set(rows.filter(r => r.resolution === "new").map(r => r.identity_key)).size };
}
