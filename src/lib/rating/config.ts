import type { Glicko2Params } from "@/lib/rating/glicko2";
import type { MethodKind } from "@/lib/rating/outcomes";

/**
 * Everything that can change a rating result lives here, so a model version is fully described by
 * (code version, config, input fingerprint, as-of date, match cutoff) and can be recomputed exactly.
 */
export type DominanceConfig = {
  /** Experimental. Off by default; enable only if a backtest shows a meaningful, calibrated gain. */
  enabled: boolean;
  /** Score credited to the winner per method (loser receives 1 − score). Baseline Glicko-2 is all 1. */
  winnerScore: { decision: number; major_decision: number; tech_fall: number; fall: number };
  /** Optional: for decisions with a parseable margin, interpolate between decisionMin and the decision score. */
  margin: { enabled: boolean; capPoints: number; decisionMin: number } | null;
};

export type RatingConfig = {
  /** Human-readable family name, e.g. "glicko2-baseline". Stored with each calculated model. */
  modelVersion: string;
  glicko: Glicko2Params;
  period: {
    /** Rating period length in days. Games in a period are treated as simultaneous (Glicko-2). */
    days: number;
  };
  /** The documented recency policy. Only one policy exists today; the field is stored for provenance. */
  recency: {
    policy: "glicko2_inactivity_rd_growth";
    /** Optional experimental random-walk skill drift, in Glicko RD points per sqrt(year).
     * Zero/absent preserves the validated production model and its config fingerprint.
     * Added to variance each rating period, whether or not matches occur.
     */
    skillDriftRdPerYear?: number;
  };
  uncertainty: {
    /** Conservative score = rating − k × RD. Leaderboard policy, not a forecasting parameter. */
    k: number;
    /** RD at or above this is "provisional". Display only; never gates whether results count. */
    provisionalRd: number;
    /** RD below this is "established"; between the two is "developing". */
    establishedRd: number;
  };
  predictor: "combined_rd" | "opponent_rd";
  dominance: DominanceConfig;
  outcomes: {
    /** Methods that count as legitimately contested. Everything else is excluded and reported. */
    contested: MethodKind[];
  };
  matching: {
    /** "retrospective" applies the reviewed alias table to the whole history; "none" ignores it. */
    aliasPolicy: "retrospective" | "none";
    /** Events with the same name are split into separate occurrences when matches are further apart than this. */
    eventGapDays: number;
    dedupeExactRows: boolean;
  };
  metrics: {
    /** Opponents at or above this percentile of current ratings count as "quality". */
    qualityPercentile: number;
    /** Reference rating for the opponent-adjusted strength-of-schedule expectation. */
    sosReferenceRating: number;
    trendDays: number;
  };
};

export const DEFAULT_RATING_CONFIG: RatingConfig = {
  modelVersion: "glicko2-baseline",
  glicko: {
    initialRating: 1500,
    initialRd: 350,
    initialVolatility: 0.06,
    tau: 0.5,
    epsilon: 0.000001,
    maxRd: 350,
  },
  period: { days: 7 },
  recency: { policy: "glicko2_inactivity_rd_growth" },
  uncertainty: { k: 1, provisionalRd: 120, establishedRd: 80 },
  predictor: "combined_rd",
  dominance: {
    enabled: false,
    winnerScore: { decision: 1, major_decision: 1, tech_fall: 1, fall: 1 },
    margin: null,
  },
  outcomes: { contested: ["decision", "major_decision", "tech_fall", "fall"] },
  matching: { aliasPolicy: "retrospective", eventGapDays: 7, dedupeExactRows: true },
  metrics: { qualityPercentile: 0.8, sosReferenceRating: 1500, trendDays: 90 },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };
export type RatingConfigOverrides = DeepPartial<RatingConfig>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function merge<T>(base: T, overrides: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(overrides)) return (overrides === undefined ? base : overrides) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    out[key] = key in base ? merge((base as Record<string, unknown>)[key], value) : value;
  }
  return out as T;
}

export function resolveConfig(overrides: RatingConfigOverrides = {}): RatingConfig {
  const config = merge(DEFAULT_RATING_CONFIG, overrides);
  validateConfig(config);
  return config;
}

export function validateConfig(config: RatingConfig) {
  const problems: string[] = [];
  const need = (ok: boolean, message: string) => { if (!ok) problems.push(message); };
  const { glicko, period, recency, uncertainty, dominance, metrics } = config;
  need(glicko.tau >= 0.1 && glicko.tau <= 2, "glicko.tau must be between 0.1 and 2");
  need(glicko.initialRd > 0 && glicko.initialRd <= glicko.maxRd, "glicko.initialRd must be in (0, maxRd]");
  need(glicko.initialVolatility > 0 && glicko.initialVolatility < 1, "glicko.initialVolatility must be in (0, 1)");
  need(glicko.epsilon > 0 && glicko.epsilon < 0.01, "glicko.epsilon must be small and positive");
  need(Number.isInteger(period.days) && period.days >= 1 && period.days <= 120, "period.days must be an integer from 1 to 120");
  need(recency.skillDriftRdPerYear === undefined ||
    (Number.isFinite(recency.skillDriftRdPerYear) && recency.skillDriftRdPerYear >= 0 && recency.skillDriftRdPerYear <= 350),
    "recency.skillDriftRdPerYear must be a finite value from 0 to 350");
  need(uncertainty.k >= 0 && uncertainty.k <= 5, "uncertainty.k must be between 0 and 5");
  need(uncertainty.establishedRd < uncertainty.provisionalRd, "uncertainty.establishedRd must be below provisionalRd");
  need(metrics.qualityPercentile > 0 && metrics.qualityPercentile < 1, "metrics.qualityPercentile must be in (0, 1)");
  for (const [method, score] of Object.entries(dominance.winnerScore)) {
    need(score >= 0.5 && score <= 1, `dominance.winnerScore.${method} must be between 0.5 and 1`);
  }
  need(config.outcomes.contested.length > 0, "outcomes.contested cannot be empty");
  if (problems.length) throw new Error(`Invalid rating configuration:\n- ${problems.join("\n- ")}`);
}

/** Deterministic JSON with sorted keys, used for hashing and for storing configuration. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Convenience description of the rating-period and inactivity policy for provenance columns. */
export const periodPolicyLabel = (config: RatingConfig) => `fixed_${config.period.days}d`;
