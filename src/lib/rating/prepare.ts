import type { RatingConfig } from "./config";
import {
  classifyMethod,
  isPlaceholderName,
  parseAgeGroup,
  parseBracketWeight,
  scoringMargin,
  type MethodKind,
} from "./outcomes";

/** A row of public.matches as read by the rating pipeline. */
export type RawMatch = {
  id: string;
  event_date: string;
  event_name: string;
  weight_class: string;
  round?: string | null;
  winner_name: string;
  winner_team?: string | null;
  loser_name: string;
  loser_team?: string | null;
  result?: string | null;
  win_type: string;
  city?: string | null;
};

export type AliasRow = { alias_key: string; canonical_key: string; canonical_name: string };
export type MatchIdentityAssignment = { matchId: string; side: "winner" | "loser"; personId: string | null };

/** A contested bout normalised for rating. Winner and loser are canonical identity keys. */
export type RatedMatch = {
  id: string;
  date: string;
  day: number;
  eventId: string;
  eventName: string;
  eventStartDay: number;
  winnerKey: string;
  winnerName: string;
  winnerTeam: string;
  loserKey: string;
  loserName: string;
  loserTeam: string;
  method: MethodKind;
  margin: number | null;
  weightClass: string;
  bracketWeight: number | null;
  ageGroup: string | null;
  round: string;
};

export type ExclusionReason =
  | "invalid_date"
  | "missing_name"
  | "placeholder_opponent"
  | "self_match"
  | "non_contested_method"
  | "unrecognized_method"
  | "duplicate_row"
  | "unresolved_identity";

export type ExclusionReport = {
  total: number;
  rated: number;
  excluded: number;
  byReason: Record<ExclusionReason, number>;
  /** Count of each excluded method kind, e.g. forfeit: 12. */
  excludedMethods: Record<string, number>;
  /** Raw win_type strings that could not be classified, with counts. Review and extend outcomes.ts. */
  unrecognizedWinTypes: Record<string, number>;
  /** Raw win_type -> kind -> count, for every row, so classification can be audited. */
  methodCounts: Record<string, { kind: MethodKind; count: number }>;
  aliasesApplied: number;
  /** Rows whose weight_class yielded no numeric bracket weight (e.g. HWT labels). */
  noBracketWeight: number;
  /** Rows where an age group could be read from the weight-class label. */
  ageGroupParsed: number;
};

/** SQL-compatible identity key: lower(trim(name)). Do not collapse inner whitespace; the DB does not. */
export const identityKey = (name: string) => name.trim().toLowerCase();

export const dayNumber = (isoDate: string) => Math.floor(Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10))) / 86_400_000);
export const dayToIso = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value.slice(0, 10)));
const normalizeEvent = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function resolveAliasMap(aliases: AliasRow[]) {
  const direct = new Map(aliases.map((alias) => [alias.alias_key.trim().toLowerCase(), { key: alias.canonical_key.trim().toLowerCase(), name: alias.canonical_name }]));
  const resolve = (key: string) => {
    let current = { key, name: "" };
    for (let depth = 0; depth < 5; depth += 1) {
      const next = direct.get(current.key);
      if (!next || next.key === current.key) break;
      current = next;
    }
    return current;
  };
  return { resolve, size: direct.size };
}

export function prepareMatches(
  raw: RawMatch[], aliases: AliasRow[], config: RatingConfig,
  identityAssignments?: MatchIdentityAssignment[],
): { matches: RatedMatch[]; report: ExclusionReport } {
  const alias = config.matching.aliasPolicy === "retrospective" ? resolveAliasMap(aliases) : resolveAliasMap([]);
  const assigned = identityAssignments && new Map(identityAssignments.map((a) => [`${a.matchId}:${a.side}`, a.personId]));
  const contested = new Set<MethodKind>(config.outcomes.contested);
  const report: ExclusionReport = {
    total: raw.length,
    rated: 0,
    excluded: 0,
    byReason: { invalid_date: 0, missing_name: 0, placeholder_opponent: 0, self_match: 0, non_contested_method: 0, unrecognized_method: 0, duplicate_row: 0, unresolved_identity: 0 },
    excludedMethods: {},
    unrecognizedWinTypes: {},
    methodCounts: {},
    aliasesApplied: 0,
    noBracketWeight: 0,
    ageGroupParsed: 0,
  };
  const exclude = (reason: ExclusionReason) => { report.byReason[reason] += 1; report.excluded += 1; };

  const seen = new Set<string>();
  const staged: Omit<RatedMatch, "eventId" | "eventStartDay">[] = [];

  for (const row of raw) {
    const winType = String(row.win_type ?? "");
    const method = classifyMethod(winType, row.result);
    const methodLabel = winType.trim().toUpperCase() || "(blank)";
    const entry = report.methodCounts[methodLabel] ?? { kind: method, count: 0 };
    entry.count += 1;
    report.methodCounts[methodLabel] = entry;

    if (!isIsoDate(String(row.event_date ?? ""))) { exclude("invalid_date"); continue; }
    const winnerName = String(row.winner_name ?? "").trim();
    const loserName = String(row.loser_name ?? "").trim();
    if (!winnerName || !loserName) { exclude("missing_name"); continue; }
    if (isPlaceholderName(winnerName) || isPlaceholderName(loserName)) { exclude("placeholder_opponent"); continue; }
    if (method === "unknown") {
      report.unrecognizedWinTypes[methodLabel] = (report.unrecognizedWinTypes[methodLabel] ?? 0) + 1;
      exclude("unrecognized_method");
      continue;
    }
    if (!contested.has(method)) {
      report.excludedMethods[method] = (report.excludedMethods[method] ?? 0) + 1;
      exclude("non_contested_method");
      continue;
    }

    const winnerId = assigned?.get(`${row.id}:winner`);
    const loserId = assigned?.get(`${row.id}:loser`);
    if (assigned && (!winnerId || !loserId)) { exclude("unresolved_identity"); continue; }
    const winner = assigned ? { key: winnerId!, name: "" } : alias.resolve(identityKey(winnerName));
    const loser = assigned ? { key: loserId!, name: "" } : alias.resolve(identityKey(loserName));
    if (!assigned && winner.name) report.aliasesApplied += 1;
    if (!assigned && loser.name) report.aliasesApplied += 1;
    if (winner.key === loser.key) { exclude("self_match"); continue; }

    const date = String(row.event_date).slice(0, 10);
    if (config.matching.dedupeExactRows) {
      // Identity changes must not make two distinct recorded pairings collide in the
      // legacy exact-row deduper. Preserve its source-name signature for person runs.
      const signature = [date, normalizeEvent(String(row.event_name ?? "")), row.weight_class, row.round ?? "",
        assigned ? identityKey(winnerName) : winner.key, assigned ? identityKey(loserName) : loser.key,
        row.result ?? "", methodLabel].join("|");
      if (seen.has(signature)) { exclude("duplicate_row"); continue; }
      seen.add(signature);
    }

    const bracketWeight = parseBracketWeight(row.weight_class);
    if (bracketWeight == null) report.noBracketWeight += 1;
    const ageGroup = parseAgeGroup(row.weight_class, row.event_name);
    if (ageGroup) report.ageGroupParsed += 1;

    staged.push({
      id: row.id,
      date,
      day: dayNumber(date),
      eventName: String(row.event_name ?? ""),
      winnerKey: winner.key,
      winnerName: winner.name || winnerName,
      winnerTeam: String(row.winner_team ?? "").trim(),
      loserKey: loser.key,
      loserName: loser.name || loserName,
      loserTeam: String(row.loser_team ?? "").trim(),
      method,
      margin: scoringMargin(method, row.result),
      weightClass: String(row.weight_class ?? ""),
      bracketWeight,
      ageGroup,
      round: String(row.round ?? ""),
    });
  }

  report.rated = staged.length;
  return { matches: assignEvents(staged, config.matching.eventGapDays), report };
}

/**
 * Groups matches into event occurrences: same normalised event name, split wherever consecutive
 * match dates are more than `gapDays` apart (the same event held in different years or seasons).
 * An event's start day is the date of its earliest match. Predictions use only matches that finished
 * before that start day.
 */
function assignEvents(staged: Omit<RatedMatch, "eventId" | "eventStartDay">[], gapDays: number): RatedMatch[] {
  const byName = new Map<string, Omit<RatedMatch, "eventId" | "eventStartDay">[]>();
  for (const match of staged) {
    const key = normalizeEvent(match.eventName);
    const list = byName.get(key);
    if (list) list.push(match); else byName.set(key, [match]);
  }
  const out: RatedMatch[] = [];
  for (const [name, list] of byName) {
    list.sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
    let start = list[0].day;
    let previous = list[0].day;
    for (const match of list) {
      if (match.day - previous > gapDays) start = match.day;
      previous = match.day;
      out.push({ ...match, eventId: `${name}@${dayToIso(start)}`, eventStartDay: start });
    }
  }
  return out.sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
}
