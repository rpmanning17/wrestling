import type { ModelMetrics } from "./backtest";
import type { GridResult } from "./grid";
import type { ExclusionReport } from "./prepare";

const pct = (value: number | null, digits = 1) => (value == null ? "–" : `${(value * 100).toFixed(digits)}%`);
const num = (value: number | null, digits = 4) => (value == null ? "–" : value.toFixed(digits));

const metricRow = (label: string, m: ModelMetrics) => `| ${label} | ${m.n.toLocaleString()} | ${pct(m.accuracy)} | ${num(m.logLoss)} | ${num(m.brier)} | ${num(m.ece, 3)} |`;
const METRIC_HEADER = "| | Matches | Accuracy | Log loss | Brier | ECE |\n|---|---:|---:|---:|---:|---:|";

export function formatBacktestReport(result: GridResult, prep: ExclusionReport, meta: { generatedOn: string; source: string }): string {
  const { confirmation, windows, tuning, adoptedVariants, settings } = result;
  const lines: string[] = [];
  const push = (...text: string[]) => lines.push(...text);

  push(
    "# Rating backtest report",
    "",
    `Generated ${meta.generatedOn} from ${meta.source} by \`pnpm ratings:backtest\`. This file is machine-generated; do not edit by hand.`,
    "",
    "## Protocol",
    "",
    "- Walk-forward: events are scored in date order. Every match in an event is predicted from ratings that contain **only matches in earlier rating periods**; no result from the same event, or later, is visible, including day two of a multi-day event.",
    "- Alias table is applied retrospectively (a reviewed identity merge, not an outcome signal); the `aliases-off` variant measures the effect.",
    `- Tuning window: events from ${windows.evaluateFrom} up to (not including) ${windows.splitDate}. Confirmation window: events from ${windows.splitDate} onward, **not used to choose any setting**.`,
    `- Adoption rule: a change is adopted only if its paired-bootstrap 95% interval (resampling whole events) is entirely below baseline, the gain is at least ${settings.minImprovement} log loss per match, and (for dominance variants) calibration error does not worsen by more than ${settings.eceTolerance}. Policy variants are reported but never adopted automatically.`,
    "",
    "## Data and exclusions",
    "",
    `Rows read: ${prep.total.toLocaleString()}. Rated: ${prep.rated.toLocaleString()}. Excluded: ${prep.excluded.toLocaleString()}.`,
    "",
    "| Reason | Rows |",
    "|---|---:|",
    ...Object.entries(prep.byReason).map(([reason, n]) => `| ${reason} | ${n.toLocaleString()} |`),
    "",
    Object.keys(prep.excludedMethods).length ? `Excluded non-contested methods: ${Object.entries(prep.excludedMethods).map(([k, n]) => `${k} ${n}`).join(", ")}.` : "No non-contested methods were present.",
    Object.keys(prep.unrecognizedWinTypes).length ? `**Unrecognised win_type values (excluded; classify them in src/lib/rating/outcomes.ts):** ${Object.entries(prep.unrecognizedWinTypes).map(([k, n]) => `${k} ×${n}`).join(", ")}.` : "All win_type values were recognised.",
    "",
    `Scored in the confirmation window: ${confirmation.baseline.report.scored.toLocaleString()} matches in ${confirmation.baseline.report.eventsScored} events (${confirmation.baseline.report.warmupSkipped.toLocaleString()} earlier matches used only for warm-up).`,
    "",
    "## Model comparison (confirmation window)",
    "",
    METRIC_HEADER,
  );
  for (const model of confirmation.baselinesReport.models) push(metricRow(model.probabilistic ? model.name : `${model.name} (not a probability)`, model.overall));
  push(metricRow(`candidate: ${confirmation.candidate.variant.label}`, confirmation.candidate.glicko.overall));
  push(
    "",
    `Candidate minus baseline Glicko-2 log loss: ${num(confirmation.comparison.deltaLogLoss)} (95% interval ${num(confirmation.comparison.ci95[0])} to ${num(confirmation.comparison.ci95[1])}, ${confirmation.comparison.events} events). Negative is better.`,
    "",
    `**Recommendation: ${confirmation.recommendation === "adopt_candidate" ? "adopt the candidate" : "keep baseline Glicko-2"}.** ${confirmation.reason}.`,
    "",
    "## Calibration (baseline Glicko-2, confirmation window)",
    "",
    "Each match contributes two points (winner at p, loser at 1−p), so the table is symmetric.",
    "",
    "| Predicted | Matches | Mean predicted | Observed win rate |",
    "|---|---:|---:|---:|",
    ...confirmation.baseline.glicko.overall.calibration.map((bin) => `| ${bin.lo.toFixed(1)}–${bin.hi.toFixed(1)} | ${bin.n.toLocaleString()} | ${pct(bin.meanPredicted)} | ${pct(bin.observedRate)} |`),
    "",
    "## Segments (baseline Glicko-2, confirmation window)",
    "",
    "Newcomer = either wrestler has fewer than 5 prior recorded bouts. Established = both have 15 or more. Weight/age context compares the match's bracket with each wrestler's most recent earlier bracket; `unknown` means that information was unavailable (age is only known when the weight-class label carries an age group).",
    "",
    METRIC_HEADER,
    ...Object.entries(confirmation.baseline.glicko.segments).map(([name, metrics]) => metricRow(name, metrics)),
    "",
    "## Tuning sweep (tuning window, one factor at a time)",
    "",
    "| Variant | Log loss | Accuracy | ECE | Δ log loss vs baseline (95% interval) | Adopted | Note |",
    "|---|---:|---:|---:|---|:---:|---|",
    ...tuning.map((row) => `| ${row.variant.experimental ? "⚗ " : ""}${row.variant.label} | ${num(row.glickoLogLoss)} | ${pct(row.accuracy)} | ${num(row.ece, 3)} | ${row.vsBaseline ? `${num(row.vsBaseline.deltaLogLoss)} (${num(row.vsBaseline.ci95[0])} to ${num(row.vsBaseline.ci95[1])})` : "reference"} | ${row.adopted ? "yes" : "no"} | ${row.reason} |`),
    "",
    "⚗ = experimental dominance variant. Adopted changes: " + (adoptedVariants.length ? adoptedVariants.map((v) => v.id).join(", ") : "none") + ".",
    "",
    "## Limitations",
    "",
    "- Ratings are fitted on the same events used for scoring only through the walk-forward process; the tuning/confirmation split limits, but cannot eliminate, selection effects.",
    "- Same-name wrestlers are one identity in this database; the report cannot detect two different people sharing a name.",
    "- The 2025 season is absent from the imported data, so predictions after that gap rely on long-inactive ratings and measure the inactivity policy as much as the rating model.",
  );
  return lines.join("\n") + "\n";
}
