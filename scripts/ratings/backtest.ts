/**
 * Chronological, leakage-free backtest and tuning.
 *
 *   pnpm ratings:backtest                       # read matches from Supabase (read-only), write docs/BACKTEST_REPORT.md
 *   pnpm ratings:backtest --input export.json   # offline
 *
 * Options: --out path.md  --json path.json  --iterations 1000  --min-improvement 0.002  --store
 * --store saves the summary to public.rating_backtest_runs (needs SUPABASE_SERVICE_ROLE_KEY locally).
 */
import { writeFileSync } from "node:fs";
import { resolveConfig } from "../../src/lib/rating/config";
import { defaultVariants, tuneAndConfirm } from "../../src/lib/rating/grid";
import { prepareMatches } from "../../src/lib/rating/prepare";
import { formatBacktestReport } from "../../src/lib/rating/report";
import { configHash, loadInputs, parseArgs, todayIso, writeClient } from "./common";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputs = await loadInputs(args);
  const baselineConfig = resolveConfig();
  const { report: prep } = prepareMatches(inputs.matches, inputs.aliases, baselineConfig);
  console.log(`Read ${prep.total.toLocaleString()} matches; ${prep.rated.toLocaleString()} rateable. Running ${defaultVariants().length} variants...`);

  const result = tuneAndConfirm(inputs.matches, inputs.aliases, defaultVariants(), {
    bootstrapIterations: Number(args.values.get("iterations") ?? 1000),
    minImprovement: Number(args.values.get("min-improvement") ?? 0.002),
  });
  const markdown = formatBacktestReport(result, prep, { generatedOn: todayIso(), source: inputs.source });
  const out = args.values.get("out") ?? "docs/BACKTEST_REPORT.md";
  writeFileSync(out, markdown);
  console.log(`Wrote ${out}`);
  console.log(`Recommendation: ${result.confirmation.recommendation} — ${result.confirmation.reason}`);

  const summary = {
    windows: result.windows,
    recommendation: result.confirmation.recommendation,
    adopted: result.adoptedVariants.map((v) => v.id),
    baseline: result.confirmation.baseline.glicko.overall,
    candidate: result.confirmation.candidate.glicko.overall,
    comparison: result.confirmation.comparison,
  };
  if (args.values.get("json")) writeFileSync(args.values.get("json")!, JSON.stringify(summary, null, 2));
  if (args.flags.has("store")) {
    const db = writeClient();
    const { error } = await db.from("rating_backtest_runs").insert({
      config_hash: configHash(baselineConfig), scope: "confirmation",
      evaluate_from: result.windows.splitDate, metrics: summary, notes: `source ${inputs.source}`,
    });
    if (error) throw new Error(error.message);
    console.log("Stored summary in rating_backtest_runs.");
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
