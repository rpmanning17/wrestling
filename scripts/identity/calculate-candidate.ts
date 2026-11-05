/** Offline person-keyed Glicko-2 candidate. Writes only to the supplied private directory. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { calculateRatings } from "../../src/lib/rating/engine";
import { resolveConfig, periodPolicyLabel } from "../../src/lib/rating/config";
import { serializeHistoryRows, serializeRatingRows, roundPersisted } from "../../src/lib/rating/persistence";
import { assertSameFormula } from "../../src/lib/rating/recovery";
import { prepareMatches, type MatchIdentityAssignment, type RawMatch } from "../../src/lib/rating/prepare";
import { configHash, inputFingerprint, sha256 } from "../ratings/common";
import type { IdentitySnapshot } from "../../src/lib/identity/audit";
import type { PlannedAssignment } from "../../src/lib/identity/plan";

const directory = process.argv[2];
const asOfDate = process.argv[3];
if (!directory || !asOfDate || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate) ||
  new Date(asOfDate).toISOString().slice(0, 10) !== asOfDate) throw new Error("Use private directory and ISO as-of date");
const read = (name: string) => JSON.parse(readFileSync(path.join(directory, name), "utf8"));
const snapshot = read("identity-source-snapshot.json") as IdentitySnapshot;
const plan = read("identity-417-assignment-plan.json") as { sourceChecksum: string;
  people: Array<{ id: string; displayName: string }>;
  assignments: PlannedAssignment[] };
if (snapshot.source_checksum !== plan.sourceChecksum || snapshot.matches.length !== 67736) throw new Error("Source snapshot differs from reviewed assignment plan");
if (plan.assignments.length !== snapshot.matches.length * 2 + snapshot.entries.length + snapshot.observations.length)
  throw new Error("Assignment plan does not cover every source appearance");
const raw: RawMatch[] = snapshot.matches.map(row => ({ id: row[0], event_date: row[1], event_name: row[2],
  city: row[3], weight_class: row[5], round: row[6], winner_name: row[7], winner_team: row[8],
  loser_name: row[9], loser_team: row[10], result: row[11], win_type: row[12] }));
const assignmentRows = plan.assignments.filter(a => a.sourceKind === "match_winner" || a.sourceKind === "match_loser");
const assignments: MatchIdentityAssignment[] = assignmentRows.map(a => ({ matchId: a.sourceId,
  side: a.sourceKind === "match_winner" ? "winner" : "loser", personId: a.personId }));
const production = resolveConfig(JSON.parse(readFileSync("config/ratings.production.json", "utf8")));
const config = resolveConfig({ ...JSON.parse(readFileSync("config/ratings.production.json", "utf8")),
  modelVersion: "glicko2-daily-dec08-person-identity-v1" });
assertSameFormula(production, config);
const prepared = prepareMatches(raw, snapshot.aliases, config, assignments);
const result = calculateRatings(prepared.matches, config, { asOfDate, recordHistory: true });
const display = new Map(plan.people.map(p => [p.id, p.displayName]));
for (const player of result.players) {
  const name = display.get(player.key);
  if (!name) throw new Error(`Rated person absent from plan: ${player.key}`);
  player.name = name;
}
const rows = serializeRatingRows(result, "PENDING").map(row => ({ ...row, person_id: row.athlete_key }));
const history = serializeHistoryRows(result, "PENDING").map(row => ({ ...row, person_id: row.athlete_key }));
const assignmentFingerprint = sha256([...plan.assignments]
  .sort((a, b) => a.sourceKind < b.sourceKind ? -1 : a.sourceKind > b.sourceKind ? 1
    : a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0)
  .map(a => [a.sourceKind, a.sourceId, Buffer.from(a.recordedName, "utf8").toString("hex"),
    a.personId ?? ""].join("\u001f")).join("\n"));
const sourceRatingInputFingerprint = inputFingerprint({ matches: raw, aliases: snapshot.aliases, source: "private-snapshot" });
const inputHash = createHash("sha256").update(JSON.stringify(["person-rating-input-v1",
  sourceRatingInputFingerprint, assignmentFingerprint])).digest("hex");
const model = {
  model_version: config.modelVersion, status: "building", identity_scheme: "person_uuid",
  assignment_fingerprint: assignmentFingerprint, config, config_hash: configHash(config),
  input_fingerprint: inputHash, code_version: "person-identity-v1", as_of_date: asOfDate,
  match_cutoff: result.matchCutoff, first_match_date: result.firstMatchDate,
  rating_period_policy: periodPolicyLabel(config), rating_period_days: config.period.days,
  uncertainty_k: config.uncertainty.k, provisional_rd: config.uncertainty.provisionalRd,
  established_rd: config.uncertainty.establishedRd, recency_policy: config.recency.policy,
  dominance_enabled: config.dominance.enabled, matches_total: prepared.report.total,
  matches_rated: prepared.report.rated,
  matches_excluded: { byReason: prepared.report.byReason, excludedMethods: prepared.report.excludedMethods,
    unrecognizedWinTypes: prepared.report.unrecognizedWinTypes },
  wrestlers_rated: rows.length, quality_threshold: roundPersisted(result.qualityThreshold, 2),
  label: "Person identity candidate — unchanged production Glicko-2 formula",
  notes: "Offline person-keyed candidate. Validate source and assignment fingerprints and guarded checks before promotion. Activation separately authorized.",
};
const verification = { sourceChecksum: snapshot.source_checksum, sourceRatingInputFingerprint, assignmentFingerprint,
  ratingPayloadSha256: sha256(JSON.stringify(rows)), historyPayloadSha256: sha256(JSON.stringify(history)),
  sourceMatches: raw.length, ...prepared.report, ratedPeople: rows.length, historyPoints: history.length,
  wins: rows.reduce((n, row) => n + row.wins, 0), losses: rows.reduce((n, row) => n + row.losses, 0) };
if (verification.wins !== prepared.report.rated || verification.losses !== prepared.report.rated)
  throw new Error("Rated bout totals do not reconcile to both sides");
const output = path.join(directory, "identity-417-rating-candidate.json");
writeFileSync(output, JSON.stringify({ model, rows, history, verification }) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ output, sourceMatches: raw.length, ratedMatches: prepared.report.rated,
  exclusions: prepared.report.byReason, ratedPeople: rows.length, historyPoints: history.length,
  assignmentFingerprint, sourceRatingInputFingerprint }));
