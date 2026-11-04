/**
 * Read-only experiment: does continuous skill drift improve predictions for developing wrestlers?
 *
 *   pnpm ratings:recency-backtest
 *   pnpm ratings:recency-backtest --input export.json --drifts 50,100,150,200
 *   pnpm ratings:recency-backtest --config config/ratings.production.json
 *
 * Starts from the EXACT production configuration. Tunes the drift candidates on older
 * events, selects at most one, and evaluates that one on untouched newer events.
 * This script does NOT calculate/persist models or activate anything in Supabase.
 */
import { writeFileSync } from "node:fs";
import { compareModels, runBacktest, type BacktestReport, type ModelReport, type PairedComparison } from "../../src/lib/rating/backtest";
import { resolveConfig, type RatingConfig } from "../../src/lib/rating/config";
import { chooseWindows } from "../../src/lib/rating/grid";
import { Glicko2Model } from "../../src/lib/rating/models";
import { prepareMatches } from "../../src/lib/rating/prepare";
import { loadConfig, loadInputs, parseArgs, todayIso } from "./common";

const MIN_LOG_LOSS_GAIN = 0.002;
const MAX_ECE_INCREASE = 0.005;

type Comparison = { drift: number; model: ModelReport; comparison: PairedComparison; acceptable: boolean };

function explain(candidate: ModelReport, baseline: ModelReport, comparison: PairedComparison) {
  const calibrated = (candidate.overall.ece ?? 1) <= (baseline.overall.ece ?? 0) + MAX_ECE_INCREASE;
  return {
    acceptable: comparison.significantlyBetter && comparison.deltaLogLoss <= -MIN_LOG_LOSS_GAIN && calibrated,
    calibrated,
  };
}

function runWindow(
  matches: ReturnType<typeof prepareMatches>["matches"],
  baseline: RatingConfig,
  drifts: number[],
  from: string,
  until?: string,
): BacktestReport {
  const models = [
    new Glicko2Model(baseline, "production"),
    ...drifts.map((drift) => new Glicko2Model(
      resolveConfig({ ...baseline, recency: { ...baseline.recency, skillDriftRdPerYear: drift } }),
      `drift-${drift}`,
    )),
  ];
  return runBacktest(matches, models, { periodDays: baseline.period.days, evaluateFrom: from, evaluateUntil: until ?? null });
}

function metric(model: ModelReport) {
  const m = model.overall;
  return `${m.n.toLocaleString()} | ${m.accuracy?.toFixed(4) ?? "n/a"} | ${m.logLoss?.toFixed(5) ?? "n/a"} | ${m.brier?.toFixed(5) ?? "n/a"} | ${m.ece?.toFixed(5) ?? "n/a"}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args.values.get("config") ?? "config/ratings.production.json";
  const configArgs = { ...args, values: new Map(args.values).set("config", file) };
  const baseline = loadConfig(configArgs);
  if ((baseline.recency.skillDriftRdPerYear ?? 0) !== 0) {
    throw new Error("The reference configuration must have zero skill drift.");
  }

  const drifts = (args.values.get("drifts") ?? "50,100,150,200").split(",").map((v) => Number(v.trim()));
  if (!drifts.length || new Set(drifts).size !== drifts.length ||
      drifts.some((v) => !Number.isFinite(v) || v <= 0 || v > 350)) {
    throw new Error("--drifts must be a comma-separated list of unique RD values in (0, 350].");
  }

  const inputs = await loadInputs(args);
  const { matches, report: prep } = prepareMatches(inputs.matches, inputs.aliases, baseline);
  if (!matches.length) throw new Error("Cannot backtest an empty contested-match dataset.");
  const windows = chooseWindows(matches);
  const iterations = Number(args.values.get("iterations") ?? "1000");
  if (!Number.isInteger(iterations) || iterations < 100 || iterations > 10000) {
    throw new Error("--iterations must be between 100 and 10000.");
  }
  const tune = runWindow(matches, baseline, drifts, windows.evaluateFrom, windows.splitDate);
  const reference = tune.models[0];
  const evaluations: Comparison[] = drifts.map((drift, i) => {
    const model = tune.models[i + 1];
    const comparison = compareModels(model, reference, iterations);
    return { drift, model, comparison, acceptable: explain(model, reference, comparison).acceptable };
  });
  const selected = evaluations.filter((v) => v.acceptable)
    .sort((a, b) => a.comparison.deltaLogLoss - b.comparison.deltaLogLoss)[0] ?? null;

  const confirm = runWindow(matches, baseline, selected ? [selected.drift] : [], windows.splitDate);
  const confirmationComparison = selected ? compareModels(confirm.models[1], confirm.models[0], iterations) : null;
  const confirmationPasses = selected != null && confirmationComparison != null &&
    explain(confirm.models[1], confirm.models[0], confirmationComparison).acceptable;
  const lines = [
    "# Youth-rating recency experiment — NOT a production adoption",
    "",
    `Generated ${todayIso()} from ${inputs.source}; reference \`${file}\`.`,
    `Input matches: ${prep.total.toLocaleString()}; rated matches: ${prep.rated.toLocaleString()}.`,
    `Walk-forward event tuning: [${windows.evaluateFrom}, ${windows.splitDate}); untouched confirmation: from ${windows.splitDate}.`,
    "",
    "Experimental parameter: additional annual random-walk RD (points per sqrt(year)).",
    "This increases uncertainty about evolving ability even between regular appearances. It does NOT",
    "multiply individual bout weights, impose a hard expiration, or imply a literal 12-month half-life.",
    "All candidates retain production daily periods and decision-0.8 outcomes.",
    "",
    `Adoption gate: paired event-bootstrap 95% log-loss interval entirely below 0, mean improvement ≥ ${MIN_LOG_LOSS_GAIN}, ECE increase ≤ ${MAX_ECE_INCREASE}.`,
    "Candidates are selected only on tuning matches; the confirmation window is not used for selection.",
    "",
    "## Tuning",
    "",
    "| Model | Bouts | Accuracy | Log loss | Brier | ECE | Δ log loss vs production | 95% CI | Eligible |",
    "|---|---:|---:|---:|---:|---:|---:|---|:---:|",
    `| Production | ${metric(reference)} | — | — | Reference |`,
    ...evaluations.map((e) => `| Drift ${e.drift} | ${metric(e.model)} | ${e.comparison.deltaLogLoss.toFixed(5)} | [${e.comparison.ci95.map((v) => v.toFixed(5)).join(", ")}] | ${e.acceptable ? "yes" : "no"} |`),
    "",
    `Tuning-selected candidate: ${selected ? `drift ${selected.drift}` : "none"}.`,
    "",
    "## Untouched confirmation",
    "",
    "| Model | Bouts | Accuracy | Log loss | Brier | ECE |",
    "|---|---:|---:|---:|---:|---:|",
    `| Production | ${metric(confirm.models[0])} |`,
    ...(selected ? [`| Drift ${selected.drift} | ${metric(confirm.models[1])} |`] : []),
    "",
    confirmationComparison
      ? `Paired difference: ${confirmationComparison.deltaLogLoss.toFixed(5)}; 95% CI [${confirmationComparison.ci95.map((v) => v.toFixed(5)).join(", ")}]; ${confirmationComparison.events} events.`
      : "No candidate met the tuning gate; production configuration remains preferred.",
    "",
    `**Decision: ${confirmationPasses ? "candidate merits a separate review" : "keep production unchanged"}**. No data or live model was altered.`,
    "",
    "## Limitations",
    "",
    "- Only ~2 years of imported bouts: cannot validate a three- or four-year cutoff or long-term development effects.",
    "- Age division can be ambiguous; do not treat bracket labels as exact age or bodyweight.",
    "- Match/network identity errors and event coverage affect all comparisons.",
    "- Re-running tuning after seeing confirmation metrics requires a NEW untouched holdout period.",
    "",
  ];
  const out = args.values.get("out") ?? "docs/RECENCY_EXPERIMENT_REPORT.md";
  writeFileSync(out, lines.join("\n"));
  if (args.values.get("json")) writeFileSync(args.values.get("json")!, JSON.stringify({
    inputs: { total: prep.total, rated: prep.rated },
    windows, selectedDrift: selected?.drift ?? null,
    tuning: evaluations.map(({ drift, model, comparison, acceptable }) => ({ drift, metrics: model.overall, comparison, acceptable })),
    confirmation: { baseline: confirm.models[0].overall, candidate: selected ? confirm.models[1].overall : null, comparison: confirmationComparison, passes: !!confirmationPasses },
  }, null, 2));
  console.log(`Report: ${out}; held-out decision: ${confirmationPasses ? "review candidate, do not auto-activate" : "keep production unchanged"}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
