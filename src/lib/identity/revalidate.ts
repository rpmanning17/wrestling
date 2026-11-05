import type { IdentitySnapshot } from "./audit";

export type ProposedLink = { keys: [string, string]; authority: "owner_confirmed" | "agent_inferred";
  caseId?: string; evidenceHash?: string };
export type CheckedLink = ProposedLink & { sharedClubs: number; sharedOpponents: number;
  status: "accepted" | "held"; reason: string };

const key = (value: string) => value.trim().toLowerCase();
const clubKey = (value: string) => key(value).replace(/[^a-z0-9]+/g, " ");
const eventKey = (date: string, event: string, city: string, state: string) =>
  JSON.stringify([date, key(event), key(city), key(state)]);

type Seen = { clubs: Set<string>; opponents: Set<string>; days: Map<string, Array<{
  event: string; state: string; club: string; bracket: number | null
}>> };
const empty = (): Seen => ({ clubs: new Set(), opponents: new Set(), days: new Map() });
const bracket = (value: string) => {
  const match = /^(\d{2,3})(?:\s*(?:lb|lbs))?$/i.exec(value.trim());
  return match ? Number(match[1]) : null;
};

/** Recheck agent links against current source evidence and every member of a merged group. */
export function revalidateLinks(snapshot: IdentitySnapshot, proposals: ProposedLink[], separated: string[][] = []) {
  const wrestlerAliases = new Map(snapshot.aliases.map(a => [key(a.alias_key), key(a.canonical_key)]));
  const canonical = (name: string) => wrestlerAliases.get(key(name)) ?? key(name);
  const clubAliases = new Map(snapshot.clubs.map(c => [c.alias_key, c.club_key]));
  const people = new Map<string, Seen>();
  const get = (name: string) => {
    const k = canonical(name);
    const value = people.get(k) ?? empty();
    people.set(k, value);
    return value;
  };
  for (const row of snapshot.matches) {
    for (const [name, team, opponent] of [[row[7], row[8], row[9]], [row[9], row[10], row[7]]]) {
      const person = get(name);
      const club = clubAliases.get(clubKey(team)) ?? `raw:${clubKey(team)}`;
      if (club !== "raw:") person.clubs.add(club);
      person.opponents.add(canonical(opponent));
      const day = person.days.get(row[1]) ?? [];
      day.push({ event: eventKey(row[1], row[2], row[3], row[4]), state: key(row[4]), club,
        bracket: bracket(row[5]) });
      person.days.set(row[1], day);
    }
  }

  const groupOf = new Map<string, Set<string>>();
  const group = (k: string) => groupOf.get(k) ?? new Set([k]);
  const distinct = separated.map(labels => new Set(labels.map(canonical)));
  const conflict = (a: string, b: string) => {
    if (a === b) return null;
    const left = people.get(a), right = people.get(b);
    if (!left || !right) return null;
    if (left.opponents.has(b) || right.opponents.has(a)) return "direct opponents";
    for (const [day, leftRows] of left.days) {
      const rightRows = right.days.get(day);
      if (!rightRows) continue;
      for (const x of leftRows) for (const y of rightRows) {
        if (x.event === y.event || x.club === y.club || x.club === "raw:" || y.club === "raw:") continue;
        const states = x.state && y.state && x.state !== y.state;
        const weights = x.bracket && y.bracket && Math.max(x.bracket, y.bracket) / Math.min(x.bracket, y.bracket) >= 1.6;
        if (states || weights) return `contradictory context on ${day}`;
      }
    }
    return null;
  };
  const sorted = [...proposals].sort((a, b) => Number(a.authority !== "owner_confirmed") - Number(b.authority !== "owner_confirmed") ||
    a.keys.join("|").localeCompare(b.keys.join("|")));
  const checked: CheckedLink[] = [];
  for (const proposal of sorted) {
    const [a, b] = proposal.keys.map(canonical);
    const left = people.get(a), right = people.get(b);
    const sharedClubs = left && right ? [...left.clubs].filter(c => right.clubs.has(c)).length : 0;
    const sharedOpponents = left && right ? [...left.opponents].filter(o => right.opponents.has(o)).length : 0;
    const first = group(a), second = group(b);
    let reason = "";
    if (!left || !right) reason = "source name absent";
    else if (proposal.authority === "agent_inferred" && !(sharedClubs >= 1 && sharedOpponents >= 1 || sharedOpponents >= 2))
      reason = "current evidence does not meet inference rule";
    else if ([...first].some(x => [...second].some(y => distinct.some(s => s.has(x) && s.has(y)))))
      reason = "confirmed separation across identity groups";
    else if (first !== second) {
      outer: for (const x of first) for (const y of second) {
        reason = conflict(x, y) ?? "";
        if (reason) break outer;
      }
    }
    if (!reason) {
      const merged = new Set([...first, ...second]);
      for (const member of merged) groupOf.set(member, merged);
    }
    checked.push({ ...proposal, sharedClubs, sharedOpponents, status: reason ? "held" : "accepted", reason });
  }
  return { checked, groups: [...new Set(groupOf.values())].map(g => [...g].sort()) };
}
