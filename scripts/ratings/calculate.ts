/**
 * Batch rating calculation: reads matches, rates them with the configured model, and (unless
 * --dry-run) stores a NEW versioned model. Nothing existing is modified or deleted.
 *
 *   pnpm ratings:calculate --dry-run                      # calculate and print, write nothing
 *   pnpm ratings:calculate                                # write a candidate model
 *   pnpm ratings:calculate --activate                     # ...and make it the model the website uses
 *   pnpm ratings:calculate --input export.json --dry-run  # offline, from { matches, aliases } JSON
 *
 * Options: --config overrides.json  --as-of YYYY-MM-DD  --cutoff YYYY-MM-DD  --out summary.json  --force
 * Reads use the website's personal-app credentials. Writing requires SUPABASE_SERVICE_ROLE_KEY in your
 * local environment (never commit it, never put it in a NEXT_PUBLIC_ variable).
 */
import { writeFileSync } from "node:fs";
import { calculateRatings } from "../../src/lib/rating/engine";
import { periodPolicyLabel } from "../../src/lib/rating/config";
import { prepareMatches } from "../../src/lib/rating/prepare";
import { serializeRatingRows, serializeHistoryRows } from "../../src/lib/rating/persistence";
import { chunk, configHash, inputFingerprint, loadConfig, loadInputs, parseArgs, todayIso, writeClient } from "./common";

const CODE_VERSION = "glicko2-engine-1";
const round = (value: number | null, digits: number) => (value == null ? null : Number(value.toFixed(digits)));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args);
  const asOfDate = args.values.get("as-of") ?? todayIso();
  const cutoff = args.values.get("cutoff") ?? null;
  const inputs = await loadInputs(args);
  const { matches, report } = prepareMatches(inputs.matches, inputs.aliases, config);
  const fingerprint = inputFingerprint(inputs);
  const hash = configHash(config);

  console.log(`Source: ${inputs.source}`);
  console.log(`Matches read: ${report.total.toLocaleString()}  rated: ${report.rated.toLocaleString()}  excluded: ${report.excluded.toLocaleString()}`);
  console.log("Exclusions:", JSON.stringify(report.byReason));
  if (Object.keys(report.excludedMethods).length) console.log("Excluded methods:", JSON.stringify(report.excludedMethods));
  if (Object.keys(report.unrecognizedWinTypes).length) console.log("UNRECOGNIZED win_type values (review src/lib/rating/outcomes.ts):", JSON.stringify(report.unrecognizedWinTypes));
  console.log(`Bracket weight unreadable: ${report.noBracketWeight}  age group readable from weight label: ${report.ageGroupParsed}`);

  const result = calculateRatings(matches, config, { asOfDate, matchCutoff: cutoff, recordHistory: true });
  const byStatus = result.players.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.status]: (acc[p.status] ?? 0) + 1 }), {});
  console.log(`Wrestlers rated: ${result.players.length.toLocaleString()}  status: ${JSON.stringify(byStatus)}`);
  console.log(`Matches through: ${result.matchCutoff}  as of: ${asOfDate}  quality threshold: ${result.qualityThreshold.toFixed(0)} (pool ${result.qualityPoolSize})`);
  console.log("Top 10 by conservative score:");
  for (const p of result.players.slice(0, 10)) {
    console.log(`  ${p.name.padEnd(28)} ${p.rating.toFixed(0)} ± ${p.rd.toFixed(0)}  cons ${p.conservative.toFixed(0)}  ${p.wins}-${p.losses}  ${p.status}`);
  }

  const summary = { source: inputs.source, config, configHash: hash, inputFingerprint: fingerprint, asOfDate, report, wrestlers: result.players.length, byStatus, matchCutoff: result.matchCutoff };
  if (args.values.get("out")) writeFileSync(args.values.get("out")!, JSON.stringify(summary, null, 2));
  if (args.flags.has("dry-run")) { console.log("Dry run: nothing was written."); return; }

  const db = writeClient();
  const existing = await db.from("rating_models").select("id,status").eq("config_hash", hash).eq("input_fingerprint", fingerprint).eq("as_of_date", asOfDate).limit(5);
  if (existing.error) throw new Error(existing.error.message);
  const same = (existing.data ?? [])[0];
  if (same && !args.flags.has("force")) {
    console.log(`An identical calculation already exists (model ${same.id}, ${same.status}). Nothing written. Use --force only after changing config or inputs.`);
    if (args.flags.has("activate") && same.status !== "active") await activate(db, same.id);
    return;
  }

  const inserted = await db.from("rating_models").insert({
    model_version: config.modelVersion,
    status: "building",
    config,
    config_hash: hash,
    input_fingerprint: fingerprint,
    code_version: CODE_VERSION,
    as_of_date: asOfDate,
    match_cutoff: result.matchCutoff,
    first_match_date: result.firstMatchDate,
    rating_period_policy: periodPolicyLabel(config),
    rating_period_days: config.period.days,
    uncertainty_k: config.uncertainty.k,
    provisional_rd: config.uncertainty.provisionalRd,
    established_rd: config.uncertainty.establishedRd,
    recency_policy: config.recency.policy,
    dominance_enabled: config.dominance.enabled,
    matches_total: report.total,
    matches_rated: report.rated,
    matches_excluded: { byReason: report.byReason, excludedMethods: report.excludedMethods, unrecognizedWinTypes: report.unrecognizedWinTypes },
    wrestlers_rated: result.players.length,
    quality_threshold: round(result.qualityThreshold, 2),
  }).select("id").single();
  if (inserted.error) throw new Error(`Creating model failed: ${inserted.error.message}`);
  const modelId = inserted.data.id as string;
  console.log(`Created model ${modelId} (building)`);

  try {
    const rows = serializeRatingRows(result, modelId);
    for (const part of chunk(rows, 500)) {
      const { error } = await db.from("wrestler_model_ratings").insert(part);
      if (error) throw new Error(`Writing ratings failed: ${error.message}`);
    }
    const history = serializeHistoryRows(result, modelId);
    for (const part of chunk(history, 1000)) {
      const { error } = await db.from("wrestler_rating_history").insert(part);
      if (error) throw new Error(`Writing history failed: ${error.message}`);
    }
    const done = await db.from("rating_models").update({ status: "candidate" }).eq("id", modelId);
    if (done.error) throw new Error(done.error.message);
    console.log(`Stored ${rows.length} ratings and ${history.length} history points. Model is now a candidate.`);
  } catch (error) {
    await db.from("rating_models").delete().eq("id", modelId); // cascades to partial rows
    throw error;
  }

  if (args.flags.has("activate")) await activate(db, modelId);
  else console.log(`Not active yet. Activate with: pnpm ratings:calculate --activate (same inputs) or SQL: select private.activate_rating_model('${modelId}');`);
}

async function activate(db: ReturnType<typeof writeClient>, modelId: string) {
  const previous = await db.from("rating_models").select("id").eq("status", "active");
  if (previous.error) throw new Error(previous.error.message);
  const previousIds = (previous.data ?? []).map((row) => row.id as string);
  if (previousIds.length) {
    const archive = await db.from("rating_models").update({ status: "archived" }).in("id", previousIds);
    if (archive.error) throw new Error(archive.error.message);
  }
  const promote = await db.from("rating_models").update({ status: "active" }).eq("id", modelId);
  if (promote.error) {
    if (previousIds.length) await db.from("rating_models").update({ status: "active" }).in("id", previousIds); // restore
    throw new Error(`Activation failed, previous model restored: ${promote.error.message}`);
  }
  console.log(`Model ${modelId} is now active.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
