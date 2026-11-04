/** Read-only canonical recovery calculation. Full output is private; never commit it. */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { calculateRatings } from "../../src/lib/rating/engine";
import { periodPolicyLabel } from "../../src/lib/rating/config";
import { prepareMatches } from "../../src/lib/rating/prepare";
import { serializeRatingRows, serializeHistoryRows, roundPersisted } from "../../src/lib/rating/persistence";
import { assertSameFormula } from "../../src/lib/rating/recovery";
import { configHash, inputFingerprint, loadConfig, loadInputs, parseArgs, sha256 } from "./common";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const asOfDate = args.values.get("as-of");
  const out = args.values.get("out");
  if (!asOfDate || !out) throw new Error("Explicit --as-of and private --out required");
  const config = loadConfig({ ...args, values: new Map(args.values).set("config", "config/ratings.recovery-20261104.json") });
  const production = loadConfig({ ...args, values: new Map(args.values).set("config", "config/ratings.production.json") });
  assertSameFormula(production, config);
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "src/lib/rating", "scripts/ratings", "config/ratings.production.json", "config/ratings.recovery-20261104.json"], { encoding: "utf8" });
  if (dirty.trim()) throw new Error("Commit the reviewed calculation sources before recording provenance");
  const inputs = await loadInputs(args);
  const prepared = prepareMatches(inputs.matches, inputs.aliases, config);
  const result = calculateRatings(prepared.matches, config, { asOfDate, recordHistory: true });
  const reference = calculateRatings(prepareMatches(inputs.matches, inputs.aliases, production).matches,
    production, { asOfDate, recordHistory: true });
  const rows = serializeRatingRows(result, "PENDING");
  const history = serializeHistoryRows(result, "PENDING");
  if (JSON.stringify(rows) !== JSON.stringify(serializeRatingRows(reference, "PENDING")) ||
      JSON.stringify(history) !== JSON.stringify(serializeHistoryRows(reference, "PENDING"))) {
    throw new Error("Recovery serialized output differs from production formula");
  }
  const report = prepared.report;
  const model = {
    model_version: config.modelVersion, status: "building", config, config_hash: configHash(config),
    input_fingerprint: inputFingerprint(inputs), code_version: `${commit}/glicko2-engine-1`,
    as_of_date: asOfDate, match_cutoff: result.matchCutoff, first_match_date: result.firstMatchDate,
    rating_period_policy: periodPolicyLabel(config), rating_period_days: config.period.days,
    uncertainty_k: config.uncertainty.k, provisional_rd: config.uncertainty.provisionalRd,
    established_rd: config.uncertainty.establishedRd, recency_policy: config.recency.policy,
    dominance_enabled: config.dominance.enabled, matches_total: report.total, matches_rated: report.rated,
    matches_excluded: { byReason: report.byReason, excludedMethods: report.excludedMethods, unrecognizedWinTypes: report.unrecognizedWinTypes },
    wrestlers_rated: rows.length, quality_threshold: roundPersisted(result.qualityThreshold, 2),
    label: "Canonical engine recovery — unchanged production formula",
    notes: "Owner-approved provenance-only replacement for interrupted chat run a957ed42-8ee2-4792-944d-5f63a0b4ce72. Numerical settings unchanged; full serialized output equals production formula. Original run preserved. No experimental skill drift.",
  };
  const verification = {
    productionConfigHash: configHash(production), ratings: rows.length, history: history.length,
    ratingPayloadSha256: sha256(JSON.stringify(rows)), historyPayloadSha256: sha256(JSON.stringify(history)),
    wins: rows.reduce((n, r) => n + r.wins, 0), losses: rows.reduce((n, r) => n + r.losses, 0),
    exactProductionSerialization: true,
  };
  writeFileSync(out, JSON.stringify({ model, rows, history, verification }));
  console.log(JSON.stringify({ model, verification }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
