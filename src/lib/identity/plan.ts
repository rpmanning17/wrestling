import { createHash } from "node:crypto";
import type { IdentitySnapshot } from "./audit";
import type { CheckedLink } from "./revalidate";

export type SourceSide = { matchId: string; side: "winner" | "loser"; recordedName?: string;
  recordedTeam?: string; sourceFile?: string | null; sourceRow?: number | null; date?: string; bracket?: string };
export type ConfirmedMerge = { kind: "confirmed_same_person"; personId: string; nameLabels: string[];
  sourceAppearances: SourceSide[]; caseId?: string; evidenceHash?: string };
export type ConfirmedSplit = { kind: "confirmed_distinct_people"; normalizedName: string;
  groups: Array<{ personId: string; label: string; sourceAppearances: SourceSide[] }>;
  caseId?: string; evidenceHash?: string };
export type SourceError = { kind: "likely_source_error"; sourceMatchId: string; caseId?: string; evidenceHash?: string };
export type PlanDecision = ConfirmedMerge | ConfirmedSplit | SourceError |
  { kind: "source_evidenced_distinct_people"; nameLabels: string[]; caseId?: string; evidenceHash?: string };
export type PlannedAssignment = { sourceKind: "match_winner" | "match_loser" | "tournament_entry" | "tournament_observation";
  sourceId: string; recordedName: string; personId: string | null;
  authority: "owner_confirmed" | "agent_inferred" | "source_evidenced" | "administrative" | "unresolved";
  decisionId: string };
export type PlannedDecision = { id: string; authority: "owner_confirmed" | "agent_inferred" | "administrative" | "source_evidenced";
  disposition: "same_person" | "separate_people" | "unresolved" | "source_error";
  sourceChecksum: string; evidenceHash: string | null; evidence: Record<string, unknown>; rationale: string };

const key = (value: string) => value.trim().toLowerCase();
const idFor = (value: string) => {
  const hex = createHash("sha256").update(`mat-notes-person-v1:${value}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "89ab"[parseInt(hex[16], 16) & 3];
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const appearanceKey = (id: string, side: "winner" | "loser") => `match_${side}:${id}`;
const event = (date: string, name: string, city: string, state: string) =>
  JSON.stringify([date, key(name), key(city), key(state)]);

/** Builds an immutable offline plan. Source names and records are only read. */
export function buildIdentityPlan(snapshot: IdentitySnapshot, links: CheckedLink[], decisions: PlanDecision[]) {
  if (!snapshot.source_checksum) throw new Error("Source checksum required");
  const accepted = links.filter(link => link.status === "accepted");
  const parent = new Map<string, string>();
  const root = (value: string): string => {
    const k = key(value);
    const next = parent.get(k);
    return next ? root(next) : k;
  };
  for (const link of accepted) {
    const [a, b] = link.keys.map(root);
    if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
  }
  const aliases = new Map(snapshot.aliases.map(a => [key(a.alias_key), key(a.canonical_key)]));
  const canonical = (name: string) => root(aliases.get(key(name)) ?? name);
  const source = new Map<string, { name: string; team: string; file: string | null; row: number | null;
    date: string; bracket: string }>();
  for (const row of snapshot.matches) {
    for (const [side, name, team] of [["winner", row[7], row[8]], ["loser", row[9], row[10]]] as const) {
      source.set(appearanceKey(row[0], side), { name, team, file: row[13], row: row[14], date: row[1], bracket: row[5] });
    }
  }
  const explicit = new Map<string, string>();
  const ownerScopedKeys = new Set<string>();
  const splitKeys = new Set<string>();
  const splitIds = new Set<string>();
  const fixedIds = new Map<string, string>();
  const sourceErrors = new Set<string>();
  const sourceEvidenceKeys = new Map<string, { caseId?: string; evidenceHash?: string }>();
  const put = (appearance: SourceSide, personId: string) => {
    const ref = appearanceKey(appearance.matchId, appearance.side);
    const actual = source.get(ref);
    if (!actual) throw new Error(`Confirmed appearance missing: ${ref}`);
    if (appearance.recordedName && appearance.recordedName !== actual.name ||
      appearance.recordedTeam && appearance.recordedTeam !== actual.team ||
      appearance.sourceFile && appearance.sourceFile !== actual.file ||
      appearance.sourceRow && appearance.sourceRow !== actual.row ||
      appearance.date && appearance.date !== actual.date ||
      appearance.bracket && appearance.bracket !== actual.bracket)
      throw new Error(`Confirmed appearance changed: ${ref}`);
    if (explicit.has(ref) && explicit.get(ref) !== personId) throw new Error(`Conflicting owner assignments: ${ref}`);
    explicit.set(ref, personId);
  };
  for (const decision of decisions) {
    if (decision.kind === "confirmed_same_person") {
      for (const name of decision.nameLabels) ownerScopedKeys.add(key(name));
      const group = canonical(decision.nameLabels[0]);
      const existing = fixedIds.get(group);
      if (existing && existing !== decision.personId) throw new Error(`Two owner IDs in one group: ${group}`);
      fixedIds.set(group, decision.personId);
      for (const appearance of decision.sourceAppearances) put(appearance, decision.personId);
    } else if (decision.kind === "confirmed_distinct_people") {
      splitKeys.add(key(decision.normalizedName));
      for (const group of decision.groups) {
        splitIds.add(group.personId);
        for (const appearance of group.sourceAppearances) put(appearance, group.personId);
      }
    } else if (decision.kind === "likely_source_error") sourceErrors.add(decision.sourceMatchId);
    else if (decision.kind === "source_evidenced_distinct_people")
      for (const name of decision.nameLabels) sourceEvidenceKeys.set(key(name), decision);
  }
  const groups = new Map<string, Set<string>>();
  for (const link of accepted) for (const member of link.keys) {
    const group = canonical(member);
    const members = groups.get(group) ?? new Set<string>();
    members.add(key(member));
    groups.set(group, members);
  }
  const person = (name: string) => fixedIds.get(canonical(name)) ?? idFor(canonical(name));
  const assignments: PlannedAssignment[] = [];
  const recordedDecisions = new Map<string, PlannedDecision>();
  const ownerById = new Map<string, ConfirmedMerge | ConfirmedSplit>();
  for (const decision of decisions) {
    if (decision.kind === "confirmed_same_person") ownerById.set(decision.personId, decision);
    if (decision.kind === "confirmed_distinct_people") for (const group of decision.groups) ownerById.set(group.personId, decision);
  }
  const decisionFor = (authority: PlannedAssignment["authority"], personId: string | null,
    name: string, reason: string): PlannedDecision => {
    const group = canonical(name);
    const decisionKey = authority === "owner_confirmed" ? `owner:${personId}`
      : authority === "agent_inferred" ? `agent:${group}`
        : authority === "source_evidenced" ? `source-distinct:${group}`
        : authority === "unresolved" ? `unresolved:${reason}` : "baseline-name-key";
    const prior = recordedDecisions.get(decisionKey);
    if (prior) return prior;
    const owner = personId ? ownerById.get(personId) : undefined;
    const related = accepted.filter(link => link.keys.some(member => canonical(member) === group));
    const sourceEvidence = sourceEvidenceKeys.get(key(name));
    const evidenceHash = authority === "owner_confirmed" ? owner?.evidenceHash ?? null
      : authority === "source_evidenced" ? sourceEvidence?.evidenceHash ?? null
      : authority === "agent_inferred" ? hash(related.map(link => link.evidenceHash).sort()) : null;
    const decision: PlannedDecision = {
      id: idFor(`decision:${decisionKey}`),
      authority: authority === "unresolved" ? "administrative" : authority,
      disposition: authority === "unresolved" ? reason === "source_error" ? "source_error" : "unresolved"
        : splitIds.has(personId ?? "") || authority === "source_evidenced" ? "separate_people" : "same_person",
      sourceChecksum: snapshot.source_checksum!, evidenceHash,
      evidence: authority === "owner_confirmed" ? { caseId: owner?.caseId ?? null, personId }
        : authority === "source_evidenced" ? { caseId: sourceEvidence?.caseId ?? null, nameKey: key(name) }
        : authority === "agent_inferred" ? { links: related.map(link => ({ caseId: link.caseId,
          evidenceHash: link.evidenceHash, keys: link.keys })) } : { scope: reason },
      rationale: authority === "owner_confirmed" ? "Owner-confirmed source appearance decision"
        : authority === "source_evidenced" ? "Repeated direct contests show distinct wrestlers"
        : authority === "agent_inferred" ? "Agent-inferred group: shared club and opponent or two shared opponents; whole-group conflicts checked"
          : authority === "unresolved" ? `Source appearance held: ${reason}`
            : "Baseline normalized source-name bucket; identity is provisional without a reviewed link",
    };
    recordedDecisions.set(decisionKey, decision);
    return decision;
  };
  const display = new Map<string, Map<string, { events: Set<string>; appearances: number }>>();
  const add = (sourceKind: PlannedAssignment["sourceKind"], sourceId: string, name: string,
    eventId: string, opts: { ambiguous?: boolean; sourceError?: boolean } = {}) => {
    const ref = `${sourceKind}:${sourceId}`;
    const explicitId = explicit.get(ref);
    const k = key(name);
    const reason = opts.ambiguous ? "ambiguous_observation" : opts.sourceError ? "source_error"
      : splitKeys.has(k) && !explicitId ? "same_name_split_scope"
        : ownerScopedKeys.has(k) && !explicitId ? "owner_review_scope" : "";
    const held = Boolean(reason);
    const personId = held ? null : explicitId ?? person(name);
    const authority: PlannedAssignment["authority"] = held ? "unresolved" : explicitId ? "owner_confirmed"
      : sourceEvidenceKeys.has(k) ? "source_evidenced"
        : (groups.get(canonical(name))?.size ?? 0) > 1 ? "agent_inferred" : "administrative";
    const decision = decisionFor(authority, personId, name, reason);
    assignments.push({ sourceKind, sourceId, recordedName: name, personId, authority, decisionId: decision.id });
    if (!personId) return;
    const labels = display.get(personId) ?? new Map();
    const count = labels.get(name) ?? { events: new Set<string>(), appearances: 0 };
    count.events.add(eventId);
    count.appearances++;
    labels.set(name, count);
    display.set(personId, labels);
  };
  for (const row of snapshot.matches) {
    const eventId = event(row[1], row[2], row[3], row[4]);
    add("match_winner", row[0], row[7], eventId, { sourceError: sourceErrors.has(row[0]) });
    add("match_loser", row[0], row[9], eventId, { sourceError: sourceErrors.has(row[0]) });
  }
  for (const row of snapshot.entries) add("tournament_entry", String(row.id), row.athlete_name,
    event(row.event_date, row.event_name, row.city ?? "", row.state ?? ""));
  for (const row of snapshot.observations) add("tournament_observation", String(row.id), row.athlete_name,
    event(row.event_date, row.event_name, row.city ?? "", row.state ?? ""),
    { ambiguous: row.identity_resolution === "ambiguous" || row.identity_resolution === "placeholder" });
  const names = [...display].map(([id, labels]) => {
    const variants = [...labels].sort((a, b) => b[1].events.size - a[1].events.size ||
      b[1].appearances - a[1].appearances || a[0].localeCompare(b[0]));
    return { id, displayName: variants[0][0], variants: variants.map(([name]) => name) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return { sourceChecksum: snapshot.source_checksum, people: names,
    decisions: [...recordedDecisions.values()].sort((a, b) => a.id.localeCompare(b.id)), assignments,
    counts: { people: names.length, assigned: assignments.filter(a => a.personId).length,
      unresolved: assignments.filter(a => !a.personId).length,
      ownerConfirmed: assignments.filter(a => a.authority === "owner_confirmed").length,
      agentInferred: assignments.filter(a => a.authority === "agent_inferred").length } };
}
