import { compareModels, runBacktest, standardModels, type BacktestReport, type ModelReport, type PairedComparison } from "./backtest";
import { resolveConfig, type RatingConfig, type RatingConfigOverrides } from "./config";
import { Glicko2Model } from "./models";
import { dayToIso, prepareMatches, type AliasRow, type RawMatch, type RatedMatch } from "./prepare";

export type Variant = {
  id: string;
  dimension: string;
  label: string;
  overrides: RatingConfigOverrides;
  /** Policy variants change which matches count or how identities merge. They are reported, never auto-adopted. */
  policy?: boolean;
  experimental?: boolean;
};

/**
 * One-factor-at-a-time variants around the baseline. A full factorial grid would overfit ~30k matches:
 * each dimension is tuned separately, the winners are combined once, and the combination is judged on
 * events that were NOT used for tuning.
 */
export function defaultVariants(): Variant[] {
  const v: Variant[] = [{ id: "baseline", dimension: "baseline", label: "Baseline Glicko-2 (7-day periods, τ 0.5, binary outcomes)", overrides: {} }];
  for (const days of [1, 3, 14, 30]) v.push({ id: `period-${days}`, dimension: "period", label: `Rating period ${days} day${days === 1 ? "" : "s"}`, overrides: { period: { days } } });
  for (const tau of [0.3, 0.75, 1.0, 1.2]) v.push({ id: `tau-${tau}`, dimension: "tau", label: `System constant τ ${tau}`, overrides: { glicko: { tau } } });
  for (const rd of [200, 250]) v.push({ id: `initial-rd-${rd}`, dimension: "initialRd", label: `Newcomer starting RD ${rd}`, overrides: { glicko: { initialRd: rd } } });
  for (const sigma of [0.03, 0.09]) v.push({ id: `initial-vol-${sigma}`, dimension: "initialVolatility", label: `Initial volatility ${sigma}`, overrides: { glicko: { initialVolatility: sigma } } });
  v.push({ id: "predictor-opponent-rd", dimension: "predictor", label: "Forecast with opponent RD only", overrides: { predictor: "opponent_rd" } });
  v.push({ id: "dominance-dec-0.9", dimension: "dominance", experimental: true, label: "Decision wins score 0.90", overrides: { dominance: { enabled: true, winnerScore: { decision: 0.9 } } } });
  v.push({ id: "dominance-dec-0.8", dimension: "dominance", experimental: true, label: "Decision wins score 0.80", overrides: { dominance: { enabled: true, winnerScore: { decision: 0.8 } } } });
  v.push({ id: "dominance-graded", dimension: "dominance", experimental: true, label: "Graded: decision .85, major .93, tech .98, fall 1", overrides: { dominance: { enabled: true, winnerScore: { decision: 0.85, major_decision: 0.93, tech_fall: 0.98, fall: 1 } } } });
  v.push({ id: "dominance-margin", dimension: "dominance", experimental: true, label: "Decision margin interpolates .75→1 over 8 points", overrides: { dominance: { enabled: true, margin: { enabled: true, capPoints: 8, decisionMin: 0.75 } } } });
  v.push({ id: "outcomes-include-default-dq", dimension: "outcomes", policy: true, label: "Also count defaults and disqualifications", overrides: { outcomes: { contested: ["decision", "major_decision", "tech_fall", "fall", "default", "disqualification"] } } });
  v.push({ id: "aliases-off", dimension: "matching", policy: true, label: "Ignore the alias table", overrides: { matching: { aliasPolicy: "none" } } });
  return v;
}

export type GridWindows = { evaluateFrom: string; splitDate: string };

/** Hold out the last `holdout` share of scorable events (by start date) for confirmation. */
export function chooseWindows(matches: RatedMatch[], warmupDays = 60, holdout = 0.3): GridWindows {
  const starts = [...new Map(matches.map((m) => [m.eventId, m.eventStartDay])).values()].sort((a, b) => a - b);
  const first = starts[0] ?? 0;
  const evaluable = starts.filter((d) => d >= first + warmupDays);
  const splitIndex = Math.min(evaluable.length - 1, Math.floor(evaluable.length * (1 - holdout)));
  return { evaluateFrom: dayToIso(first + warmupDays), splitDate: dayToIso(evaluable[Math.max(0, splitIndex)] ?? first + warmupDays) };
}

export type VariantRun = { variant: Variant; config: RatingConfig; report: BacktestReport; glicko: ModelReport; matches: RatedMatch[] };

export function runVariant(raw: RawMatch[], aliases: AliasRow[], variant: Variant, window: { evaluateFrom: string; evaluateUntil?: string | null }, withBaselines = false): VariantRun {
  const config = resolveConfig({ ...variant.overrides, modelVersion: `glicko2-${variant.id}` });
  const { matches } = prepareMatches(raw, aliases, config);
  const models = withBaselines ? standardModels(config, "glicko2") : [new Glicko2Model(config, "glicko2")];
  const report = runBacktest(matches, models as never, { periodDays: config.period.days, evaluateFrom: window.evaluateFrom, evaluateUntil: window.evaluateUntil ?? null });
  return { variant, config, report, glicko: report.models[0], matches };
}

export type GridOptions = {
  /** Minimum log-loss gain (nats per match) before a change is called meaningful. A policy choice, not a statistic. */
  minImprovement?: number;
  /** An experimental dominance variant must also not worsen expected calibration error by more than this. */
  eceTolerance?: number;
  bootstrapIterations?: number;
};

export type GridResult = {
  windows: GridWindows;
  tuning: Array<{ variant: Variant; glickoLogLoss: number | null; ece: number | null; accuracy: number | null; vsBaseline: PairedComparison | null; adopted: boolean; reason: string }>;
  baselineTuning: VariantRun;
  adoptedVariants: Variant[];
  candidateConfig: RatingConfig;
  confirmation: {
    baseline: VariantRun;
    candidate: VariantRun;
    comparison: PairedComparison;
    baselinesReport: BacktestReport;
    recommendation: "adopt_candidate" | "keep_baseline";
    reason: string;
  };
  settings: Required<GridOptions>;
};

function mergeOverrides(variants: Variant[]): RatingConfigOverrides {
  return variants.reduce<RatingConfigOverrides>((acc, variant) => deepMerge(acc, variant.overrides), {});
}

function deepMerge<T extends Record<string, unknown>>(a: T, b: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const current = out[key];
    out[key] = value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" ? deepMerge(current as Record<string, unknown>, value as Record<string, unknown>) : value;
  }
  return out as T;
}

export function tuneAndConfirm(raw: RawMatch[], aliases: AliasRow[], variants: Variant[] = defaultVariants(), options: GridOptions = {}): GridResult {
  const settings = { minImprovement: options.minImprovement ?? 0.002, eceTolerance: options.eceTolerance ?? 0.005, bootstrapIterations: options.bootstrapIterations ?? 1000 };
  const baselineVariant = variants.find((variant) => variant.id === "baseline")!;
  const baselinePrepared = prepareMatches(raw, aliases, resolveConfig()).matches;
  const windows = chooseWindows(baselinePrepared);

  const tuningWindow = { evaluateFrom: windows.evaluateFrom, evaluateUntil: windows.splitDate };
  const baselineTuning = runVariant(raw, aliases, baselineVariant, tuningWindow);

  const tuning: GridResult["tuning"] = [];
  const bestByDimension = new Map<string, { variant: Variant; delta: number }>();
  for (const variant of variants) {
    const run = variant.id === "baseline" ? baselineTuning : runVariant(raw, aliases, variant, tuningWindow);
    const comparison = variant.id === "baseline" ? null : compareModels(run.glicko, baselineTuning.glicko, settings.bootstrapIterations);
    let adopted = false;
    let reason = variant.id === "baseline" ? "reference" : "";
    if (comparison) {
      const meaningful = comparison.significantlyBetter && comparison.deltaLogLoss <= -settings.minImprovement;
      const calibrationOk = (run.glicko.overall.ece ?? 1) <= (baselineTuning.glicko.overall.ece ?? 0) + settings.eceTolerance;
      if (variant.policy) reason = "policy choice: reported only, never adopted automatically";
      else if (!meaningful) reason = comparison.significantlyBetter ? `gain ${(-comparison.deltaLogLoss).toFixed(4)} is below the ${settings.minImprovement} threshold` : "no significant improvement over baseline";
      else if (variant.experimental && !calibrationOk) reason = "improves log loss but worsens calibration beyond tolerance";
      else { adopted = true; reason = "significant, meaningful gain on the tuning window"; }
      if (adopted) {
        const best = bestByDimension.get(variant.dimension);
        if (!best || comparison.deltaLogLoss < best.delta) bestByDimension.set(variant.dimension, { variant, delta: comparison.deltaLogLoss });
      }
    }
    tuning.push({ variant, glickoLogLoss: run.glicko.overall.logLoss, ece: run.glicko.overall.ece, accuracy: run.glicko.overall.accuracy, vsBaseline: comparison, adopted: false, reason });
  }
  const adoptedVariants = [...bestByDimension.values()].map((entry) => entry.variant);
  for (const row of tuning) row.adopted = adoptedVariants.some((variant) => variant.id === row.variant.id);

  const candidateVariant: Variant = { id: "candidate", dimension: "combined", label: adoptedVariants.length ? `Combined: ${adoptedVariants.map((v) => v.id).join(" + ")}` : "Baseline (nothing adopted)", overrides: mergeOverrides(adoptedVariants) };
  const confirmWindow = { evaluateFrom: windows.splitDate, evaluateUntil: null };
  const baselineConfirm = runVariant(raw, aliases, baselineVariant, confirmWindow, true);
  const candidateConfirm = runVariant(raw, aliases, candidateVariant, confirmWindow);
  const comparison = compareModels(candidateConfirm.glicko, baselineConfirm.glicko, settings.bootstrapIterations);
  const calibrationOk = (candidateConfirm.glicko.overall.ece ?? 1) <= (baselineConfirm.glicko.overall.ece ?? 0) + settings.eceTolerance;
  const adopt = adoptedVariants.length > 0 && comparison.significantlyBetter && comparison.deltaLogLoss <= -settings.minImprovement && calibrationOk;
  const reason = !adoptedVariants.length
    ? "no variant cleared the tuning-window bar; baseline Glicko-2 stays"
    : adopt ? "the combined change also wins on held-out events"
    : !comparison.significantlyBetter ? "the tuning gain did not hold up on held-out events (interval includes zero)"
    : comparison.deltaLogLoss > -settings.minImprovement ? "held-out gain is below the meaningful-improvement threshold"
    : "held-out calibration is worse than baseline";

  return {
    windows,
    tuning,
    baselineTuning,
    adoptedVariants,
    candidateConfig: candidateConfirm.config,
    confirmation: { baseline: baselineConfirm, candidate: candidateConfirm, comparison, baselinesReport: baselineConfirm.report, recommendation: adopt ? "adopt_candidate" : "keep_baseline", reason },
    settings,
  };
}
