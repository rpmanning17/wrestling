/** Read-only calculation and summary. Candidate persistence uses the reviewed
 * connector export workflow in docs/RATING_OPERATIONS.md. No database writes.
 */
import { writeFileSync } from "node:fs";
import { calculateRatings } from "../../src/lib/rating/engine";
import { prepareMatches } from "../../src/lib/rating/prepare";
import { configHash, inputFingerprint, loadConfig, loadInputs, parseArgs, todayIso } from "./common";


async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.flags.has("dry-run") || args.flags.has("activate") || args.flags.has("force")) {
    throw new Error("Calculation is read-only: pass --dry-run. For resumable candidate writes use recovery-export.ts and guarded administrator batches; see docs/RATING_OPERATIONS.md. --activate and --force are disabled.");
  }
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

}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
