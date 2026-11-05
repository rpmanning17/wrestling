/** Independent offline integrity checks over the immutable private plan and rating export. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { classifyMethod, CONTESTED_BY_DEFAULT } from "../../src/lib/rating/outcomes";
import type { IdentitySnapshot } from "../../src/lib/identity/audit";
import type { PlannedAssignment } from "../../src/lib/identity/plan";

const directory = process.argv[2];
if (!directory) throw new Error("Private identity directory required");
const read = (name: string) => JSON.parse(readFileSync(path.join(directory, name), "utf8"));
const source = read("identity-source-snapshot.json") as IdentitySnapshot;
const plan = read("identity-417-assignment-plan.json") as { sourceChecksum: string;
  people: Array<{ id: string; displayName: string }>; assignments: PlannedAssignment[];
  decisions: Array<{ id: string; authority: string }> };
const export_ = read("identity-417-rating-candidate.json") as { model: { config: unknown;
  identity_scheme: string; assignment_fingerprint: string; matches_rated: number };
  rows: Array<{ athlete_key: string; person_id: string; match_count: number; wins: number; losses: number;
    rating: number; avg_opponent_rating: number | null; sos_expected_win_pct: number | null }>;
  history: unknown[]; verification: { sourceChecksum: string; sourceMatches: number;
    rated: number; excluded: number; byReason: Record<string, number>; assignmentFingerprint: string } };
if (source.source_checksum !== plan.sourceChecksum || source.source_checksum !== export_.verification.sourceChecksum)
  throw new Error("Source checksum mismatch");
if (export_.model.identity_scheme !== "person_uuid" ||
  export_.model.assignment_fingerprint !== export_.verification.assignmentFingerprint)
  throw new Error("Candidate identity metadata mismatch");
const assignment = new Map(plan.assignments.map(a => [`${a.sourceKind}:${a.sourceId}`, a]));
if (assignment.size !== plan.assignments.length || plan.assignments.length !== source.matches.length * 2 +
  source.entries.length + source.observations.length) throw new Error("Appearance plan incomplete or duplicated");
const people = new Set(plan.people.map(p => p.id));
const decisions = new Set(plan.decisions.map(d => d.id));
for (const item of plan.assignments) {
  if (item.personId && !people.has(item.personId) || !decisions.has(item.decisionId))
    throw new Error("Assignment points to missing person or decision");
}
const ratedRows = new Map(export_.rows.map(row => [row.athlete_key, row]));
if (ratedRows.size !== export_.rows.length || export_.rows.some(row => row.person_id !== row.athlete_key))
  throw new Error("Candidate rating keys are not unique person IDs");
const bouts = new Map<string, { wins: number; losses: number; opponents: string[] }>();
const bump = (id: string, won: boolean, opponent: string) => {
  const row = bouts.get(id) ?? { wins: 0, losses: 0, opponents: [] };
  if (won) row.wins++; else row.losses++;
  row.opponents.push(opponent);
  bouts.set(id, row);
};
let rated = 0, unresolvedContested = 0, administrative = 0, unknownMethod = 0, selfResults = 0;
const pairCounts = new Map<string, number>();
for (const row of source.matches) {
  const winner = assignment.get(`match_winner:${row[0]}`);
  const loser = assignment.get(`match_loser:${row[0]}`);
  if (!winner || !loser || winner.recordedName !== row[7] || loser.recordedName !== row[9])
    throw new Error("Original source side does not match assignment");
  const method = classifyMethod(row[12], row[11]);
  if (method === "unknown") { unknownMethod++; continue; }
  if (!CONTESTED_BY_DEFAULT.includes(method)) { administrative++; continue; }
  if (!winner.personId || !loser.personId) { unresolvedContested++; continue; }
  if (winner.personId === loser.personId) { selfResults++; continue; }
  rated++;
  bump(winner.personId, true, loser.personId);
  bump(loser.personId, false, winner.personId);
  const pair = [winner.personId, loser.personId].sort().join("|");
  pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
}
if (rated !== export_.model.matches_rated || rated !== export_.verification.rated ||
  administrative !== export_.verification.byReason.non_contested_method ||
  unknownMethod !== export_.verification.byReason.unrecognized_method ||
  unresolvedContested !== export_.verification.byReason.unresolved_identity ||
  selfResults !== export_.verification.byReason.self_match)
  throw new Error("Independent outcome reconciliation differs from rating preparation");
if (bouts.size !== ratedRows.size) throw new Error("Rated person population differs from bout history");
let recordMismatches = 0, sosMismatches = 0;
for (const [id, expected] of bouts) {
  const actual = ratedRows.get(id);
  if (!actual || actual.wins !== expected.wins || actual.losses !== expected.losses ||
    actual.match_count !== expected.wins + expected.losses) { recordMismatches++; continue; }
  const opponents = expected.opponents.map(opponent => ratedRows.get(opponent)?.rating);
  if (opponents.some(value => value == null)) throw new Error("Rated opponent missing");
  const mean = opponents.reduce<number>((sum, value) => sum + value!, 0) / opponents.length;
  const sos = opponents.reduce<number>((sum, value) => sum + 1 / (1 + 10 ** ((value! - 1500) / 400)), 0) /
    opponents.length;
  if (actual.avg_opponent_rating == null || actual.sos_expected_win_pct == null ||
    Math.abs(actual.avg_opponent_rating - mean) > 0.02 ||
    Math.abs(actual.sos_expected_win_pct - sos) > 0.00002) sosMismatches++;
}
if (recordMismatches || sosMismatches) throw new Error(`Rating record/SOS mismatches: ${recordMismatches}/${sosMismatches}`);
const repeatedPairs = [...pairCounts.values()].filter(count => count > 1).length;
const owner = read("confirmed-identity-decisions.json");
const aaron = owner.decisions.find((d: { kind: string }) => d.kind === "confirmed_distinct_people");
const aaronIds = aaron.groups.map((g: { personId: string }) => g.personId);
if (new Set(aaronIds).size !== 2 || aaronIds.some((id: string) => !ratedRows.has(id)))
  throw new Error("Confirmed same-name split lacks independent ratings");
const bermudez = owner.decisions.find((d: { kind: string }) => d.kind === "source_evidenced_distinct_people");
const nameToId = new Map(source.matches.flatMap(row => [
  [row[7].toLowerCase(), assignment.get(`match_winner:${row[0]}`)?.personId],
  [row[9].toLowerCase(), assignment.get(`match_loser:${row[0]}`)?.personId],
] as Array<[string, string | null | undefined]>));
const bermudezIds = bermudez.nameLabels.map((name: string) => nameToId.get(name.toLowerCase()));
if (new Set(bermudezIds).size !== 3 || bermudezIds.some((id: string) => !id || !ratedRows.has(id)))
  throw new Error("Source-evidenced separate wrestlers were combined");
const summary = { sourceChecksum: source.source_checksum, sourceRows: source.matches.length,
  appearances: plan.assignments.length, assigned: plan.assignments.filter(a => a.personId).length,
  unresolved: plan.assignments.filter(a => !a.personId).length, rated, administrative, unknownMethod,
  unresolvedContested, selfResults, ratedPeople: ratedRows.size, historyPoints: export_.history.length,
  repeatedPairs, recordMismatches, sosMismatches, ownerSplitRatings: aaronIds.length,
  sourceEvidencedSeparateRatings: bermudezIds.length, assignmentFingerprint: export_.model.assignment_fingerprint };
const output = path.join(directory, "identity-417-candidate-validation.json");
writeFileSync(output, JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ output, ...summary }));
