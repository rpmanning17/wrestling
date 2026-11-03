import type { RatingConfig } from "./config";
import { Glicko2Model, CoinFlipModel, EloModel, LegacyHeuristicModel, WinRateModel } from "./models";
import { dayNumber, dayToIso, type RatedMatch } from "./prepare";
import { walkForward, type HistoryView, type WalkModel } from "./walk";

export type CalibrationBin = { lo: number; hi: number; n: number; meanPredicted: number | null; observedRate: number | null };

export type ModelMetrics = {
  n: number;
  accuracy: number | null;
  logLoss: number | null;
  brier: number | null;
  /** Expected calibration error over ten equal-width probability bins, both orientations of every match. */
  ece: number | null;
  calibration: CalibrationBin[];
};

export type SegmentThresholds = {
  /** Fewer prior games than this for either wrestler (and not both unseen) = "newcomer involved". */
  newcomerBelow: number;
  /** At least this many prior games for BOTH wrestlers = "established". */
  establishedAtLeast: number;
  /** Either wrestler last seen more than this many days before the event started = "returning". */
  returningAfterDays: number;
};

export const DEFAULT_SEGMENTS: SegmentThresholds = { newcomerBelow: 5, establishedAtLeast: 15, returningAfterDays: 180 };

export type BacktestOptions = {
  periodDays: number;
  /** Only events starting on/after this date are scored; earlier ones still train the models. */
  evaluateFrom?: string | null;
  /** Events starting on/after this date are not scored (they still never influence earlier predictions). */
  evaluateUntil?: string | null;
  /** Used when evaluateFrom is not given: score events starting this many days after the first match. */
  warmupDays?: number;
  segments?: SegmentThresholds;
};

export type ModelReport = {
  name: string;
  /** False for models whose outputs are not probabilities; only accuracy is meaningful for them. */
  probabilistic: boolean;
  overall: ModelMetrics;
  /** Matches where at least one wrestler already had a recorded game. */
  informative: ModelMetrics;
  segments: Record<string, ModelMetrics>;
  /** Per-event log-loss sums, used for the paired bootstrap. */
  eventLoss: Map<string, { ll: number; n: number }>;
};

export type BacktestReport = {
  periodDays: number;
  evaluateFrom: string | null;
  firstMatchDate: string | null;
  lastMatchDate: string | null;
  matches: number;
  scored: number;
  warmupSkipped: number;
  events: number;
  eventsScored: number;
  models: ModelReport[];
};

class Accumulator {
  n = 0;
  correct = 0;
  logLossSum = 0;
  brierSum = 0;
  bins = Array.from({ length: 10 }, () => ({ n: 0, sumP: 0, sumY: 0 }));

  add(p: number) {
    const clipped = Math.min(1 - 1e-6, Math.max(1e-6, p));
    this.n += 1;
    this.correct += p > 0.5 ? 1 : p === 0.5 ? 0.5 : 0;
    this.logLossSum += -Math.log(clipped);
    this.brierSum += (1 - p) ** 2;
    const addBin = (probability: number, outcome: number) => {
      const bin = this.bins[Math.min(9, Math.floor(probability * 10))];
      bin.n += 1; bin.sumP += probability; bin.sumY += outcome;
    };
    addBin(p, 1);
    addBin(1 - p, 0);
  }

  metrics(): ModelMetrics {
    const total = this.bins.reduce((sum, bin) => sum + bin.n, 0);
    const calibration = this.bins.map((bin, index) => ({
      lo: index / 10,
      hi: (index + 1) / 10,
      n: bin.n,
      meanPredicted: bin.n ? bin.sumP / bin.n : null,
      observedRate: bin.n ? bin.sumY / bin.n : null,
    }));
    const ece = total ? this.bins.reduce((sum, bin) => sum + (bin.n ? (bin.n / total) * Math.abs(bin.sumP / bin.n - bin.sumY / bin.n) : 0), 0) : null;
    return {
      n: this.n,
      accuracy: this.n ? this.correct / this.n : null,
      logLoss: this.n ? this.logLossSum / this.n : null,
      brier: this.n ? this.brierSum / this.n : null,
      ece,
      calibration,
    };
  }
}

export function segmentLabels(match: RatedMatch, history: HistoryView, thresholds: SegmentThresholds): Record<string, string> {
  const gw = history.games(match.winnerKey);
  const gl = history.games(match.loserKey);
  const most = Math.max(gw, gl);
  const least = Math.min(gw, gl);
  const experience = most === 0 ? "both_unseen" : least < thresholds.newcomerBelow ? "newcomer_involved" : least >= thresholds.establishedAtLeast ? "both_established" : "developing";

  const bucket = (weight: number) => Math.floor(weight / 10);
  const weights = [history.lastBracketWeight(match.winnerKey), history.lastBracketWeight(match.loserKey)];
  const weight = match.bracketWeight == null || weights.some((w) => w == null)
    ? "weight_unknown"
    : weights.every((w) => bucket(w!) === bucket(match.bracketWeight!)) ? "same_weight_band" : "cross_weight_band";

  const ages = [history.lastAgeGroup(match.winnerKey), history.lastAgeGroup(match.loserKey)];
  const age = match.ageGroup == null || ages.some((a) => a == null)
    ? "age_unknown"
    : ages.every((a) => a === match.ageGroup) ? "same_age_group" : "cross_age_group";

  const lastDays = [history.lastDay(match.winnerKey), history.lastDay(match.loserKey)];
  const returning = lastDays.some((d) => d != null && match.eventStartDay - d > thresholds.returningAfterDays) ? "returning_after_gap" : "recently_active";

  return { experience, weight, age, activity: returning };
}

export function runBacktest(matches: RatedMatch[], models: ReadonlyArray<WalkModel<unknown> & { calibrated?: boolean }>, options: BacktestOptions): BacktestReport {
  const ordered = [...matches].sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
  const firstDay = ordered[0]?.day ?? null;
  const evaluateFromDay = options.evaluateFrom
    ? dayNumber(options.evaluateFrom)
    : firstDay == null ? null : firstDay + (options.warmupDays ?? 60);
  const evaluateUntilDay = options.evaluateUntil ? dayNumber(options.evaluateUntil) : null;
  const thresholds = options.segments ?? DEFAULT_SEGMENTS;

  const overall = new Map<string, Accumulator>();
  const informative = new Map<string, Accumulator>();
  const segments = new Map<string, Map<string, Accumulator>>();
  const eventLoss = new Map<string, Map<string, { ll: number; n: number }>>();
  const acc = (map: Map<string, Accumulator>, key: string) => { let a = map.get(key); if (!a) { a = new Accumulator(); map.set(key, a); } return a; };

  let scored = 0;
  let warmupSkipped = 0;
  const allEvents = new Set<string>();
  const scoredEvents = new Set<string>();

  walkForward(ordered, models, {
    periodDays: options.periodDays,
    onPrediction: ({ match, p, history }) => {
      allEvents.add(match.eventId);
      if (evaluateFromDay != null && match.eventStartDay < evaluateFromDay) { warmupSkipped += 1; return; }
      if (evaluateUntilDay != null && match.eventStartDay >= evaluateUntilDay) return;
      scored += 1;
      scoredEvents.add(match.eventId);
      const labels = segmentLabels(match, history, thresholds);
      const isInformative = labels.experience !== "both_unseen";
      for (const model of models) {
        const probability = p[model.name];
        if (probability == null) continue;
        acc(overall, model.name).add(probability);
        if (isInformative) acc(informative, model.name).add(probability);
        const segmentMap = segments.get(model.name) ?? new Map<string, Accumulator>();
        segments.set(model.name, segmentMap);
        for (const [dimension, label] of Object.entries(labels)) acc(segmentMap, `${dimension}:${label}`).add(probability);
        const perEvent = eventLoss.get(match.eventId) ?? new Map<string, { ll: number; n: number }>();
        eventLoss.set(match.eventId, perEvent);
        const entry = perEvent.get(model.name) ?? { ll: 0, n: 0 };
        entry.ll += -Math.log(Math.min(1 - 1e-6, Math.max(1e-6, probability)));
        entry.n += 1;
        perEvent.set(model.name, entry);
      }
    },
  });

  const emptyMetrics = () => new Accumulator().metrics();
  const reports: ModelReport[] = models.map((model) => {
    const perEvent = new Map<string, { ll: number; n: number }>();
    for (const [eventId, byModel] of eventLoss) { const entry = byModel.get(model.name); if (entry) perEvent.set(eventId, entry); }
    return {
      name: model.name,
      probabilistic: model.calibrated !== false,
      overall: overall.get(model.name)?.metrics() ?? emptyMetrics(),
      informative: informative.get(model.name)?.metrics() ?? emptyMetrics(),
      segments: Object.fromEntries([...(segments.get(model.name) ?? new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, (value as Accumulator).metrics()])),
      eventLoss: perEvent,
    };
  });

  return {
    periodDays: options.periodDays,
    evaluateFrom: evaluateFromDay == null ? null : dayToIso(evaluateFromDay),
    firstMatchDate: ordered[0]?.date ?? null,
    lastMatchDate: ordered.at(-1)?.date ?? null,
    matches: ordered.length,
    scored,
    warmupSkipped,
    events: allEvents.size,
    eventsScored: scoredEvents.size,
    models: reports,
  };
}

/** Standard comparison set: the configured Glicko-2 model plus simple baselines. */
export function standardModels(config: RatingConfig, glickoName = "glicko2"): Array<WalkModel<unknown> & { calibrated?: boolean }> {
  return [
    new Glicko2Model(config, glickoName),
    new EloModel(),
    new WinRateModel(),
    new LegacyHeuristicModel(),
    new CoinFlipModel(),
  ] as Array<WalkModel<unknown> & { calibrated?: boolean }>;
}

// ---------------------------------------------------------------------------------------------
// Paired comparison
// ---------------------------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type PairedComparison = {
  candidate: string;
  baseline: string;
  events: number;
  matches: number;
  /** candidate − baseline mean log loss per match. Negative means the candidate is better. */
  deltaLogLoss: number;
  ci95: [number, number];
  /** True only if the whole 95% interval is below zero. */
  significantlyBetter: boolean;
};

/**
 * Paired cluster bootstrap over events: matches inside a tournament are correlated, so whole events are
 * resampled together. Both models must have been scored on the same events.
 */
export function compareModels(candidate: ModelReport, baseline: ModelReport, iterations = 1000, seed = 20261103): PairedComparison {
  const ids = [...candidate.eventLoss.keys()].filter((id) => baseline.eventLoss.has(id));
  const rows = ids.map((id) => ({ c: candidate.eventLoss.get(id)!, b: baseline.eventLoss.get(id)! }));
  const matches = rows.reduce((sum, row) => sum + row.c.n, 0);
  const point = (selected: typeof rows) => {
    let c = 0; let b = 0; let n = 0;
    for (const row of selected) { c += row.c.ll; b += row.b.ll; n += row.c.n; }
    return n ? (c - b) / n : 0;
  };
  const random = mulberry32(seed);
  const draws: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const sample = Array.from({ length: rows.length }, () => rows[Math.floor(random() * rows.length)]);
    draws.push(point(sample));
  }
  draws.sort((a, b) => a - b);
  const ci95: [number, number] = [draws[Math.floor(iterations * 0.025)] ?? 0, draws[Math.ceil(iterations * 0.975) - 1] ?? 0];
  return {
    candidate: candidate.name,
    baseline: baseline.name,
    events: rows.length,
    matches,
    deltaLogLoss: point(rows),
    ci95,
    significantlyBetter: rows.length > 1 && ci95[1] < 0,
  };
}
