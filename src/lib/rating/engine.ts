import type { RatingConfig } from "./config";
import { muToRating, phiToRd } from "./glicko2";
import { Glicko2Model, type HistoryPoint } from "./models";
import { dayNumber, type RatedMatch } from "./prepare";
import { periodIndexOf, walkForward } from "./walk";

export type RatingStatus = "provisional" | "developing" | "established";

export type MethodBreakdown = { decision: number; major_decision: number; tech_fall: number; fall: number };

export type PlayerResult = {
  key: string;
  name: string;
  team: string;
  /** Estimated Power Rating: best current estimate of ability (Glicko scale, 1500 = unrated start). */
  rating: number;
  /** Rating deviation: one standard deviation of uncertainty, grown for inactivity up to the as-of date. */
  rd: number;
  volatility: number;
  /** rating − k × rd. A leaderboard score, never a forecast. */
  conservative: number;
  status: RatingStatus;
  games: number;
  wins: number;
  losses: number;
  firstDate: string;
  lastDate: string;
  winMethods: MethodBreakdown;
  lossMethods: MethodBreakdown;
  /** Falls ÷ wins. */
  pinPct: number | null;
  /** (falls + technical falls + major decisions) ÷ wins. */
  bonusPct: number | null;
  avgWinMargin: number | null;
  avgLossMargin: number | null;
  marginSamples: number;
  /** Explanatory only: computed from opponents' CURRENT ratings and never fed back into any rating. */
  avgOpponentRating: number | null;
  /** Expected win rate of a reference 1500 wrestler against this wrestler's actual opponents (lower = harder). */
  sosExpectedWinPct: number | null;
  qualityWins: number;
  qualityLosses: number;
  /** Rating change over the configured trend window, or null without enough history. */
  trend: number | null;
};

export type EngineResult = {
  players: PlayerResult[];
  history: HistoryPoint[];
  asOfDate: string;
  asOfPeriod: number;
  qualityThreshold: number;
  qualityPoolSize: number;
  matchCutoff: string | null;
  firstMatchDate: string | null;
};

const emptyBreakdown = (): MethodBreakdown => ({ decision: 0, major_decision: 0, tech_fall: 0, fall: 0 });

export const statusFor = (rd: number, config: RatingConfig): RatingStatus =>
  rd >= config.uncertainty.provisionalRd ? "provisional" : rd >= config.uncertainty.establishedRd ? "developing" : "established";

export const conservativeScore = (rating: number, rd: number, k: number) => rating - k * rd;

const percentile = (sortedAscending: number[], fraction: number) => {
  if (!sortedAscending.length) return Number.POSITIVE_INFINITY;
  const position = (sortedAscending.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sortedAscending[lower] + (sortedAscending[upper] - sortedAscending[lower]) * (position - lower);
};

/**
 * Calculates ratings for every wrestler from `matches` (already prepared), as of `asOfDate`.
 * Only matches dated on or before `matchCutoff` are used; later ones are ignored entirely.
 */
export function calculateRatings(
  allMatches: RatedMatch[],
  config: RatingConfig,
  options: { asOfDate: string; matchCutoff?: string | null; recordHistory?: boolean },
): EngineResult {
  const cutoffDay = options.matchCutoff ? dayNumber(options.matchCutoff) : Number.POSITIVE_INFINITY;
  const matches = allMatches.filter((match) => match.day <= cutoffDay);
  const model = new Glicko2Model(config, "glicko2", options.recordHistory ?? true);
  walkForward(matches, [model], { periodDays: config.period.days });

  const asOfDay = dayNumber(options.asOfDate);
  const asOfPeriod = periodIndexOf(asOfDay, config.period.days);

  const names = new Map<string, { name: string; team: string }>();
  for (const match of matches) { // chronological, so later rows overwrite earlier ones
    const w = names.get(match.winnerKey);
    names.set(match.winnerKey, { name: match.winnerName, team: match.winnerTeam || w?.team || "" });
    const l = names.get(match.loserKey);
    names.set(match.loserKey, { name: match.loserName, team: match.loserTeam || l?.team || "" });
  }

  const current = new Map<string, { rating: number; rd: number; sigma: number }>();
  for (const [key] of model.players) {
    const state = model.stateAt(model.players, key, asOfPeriod);
    current.set(key, { rating: muToRating(state.mu), rd: phiToRd(state.phi), sigma: state.sigma });
  }

  const pool = [...model.players.keys()]
    .map((key) => ({ key, ...current.get(key)! }))
    .filter((p) => p.rd < config.uncertainty.provisionalRd);
  const thresholdPool = (pool.length >= 20 ? pool : [...model.players.keys()].map((key) => ({ key, ...current.get(key)! })))
    .map((p) => p.rating)
    .sort((a, b) => a - b);
  const qualityThreshold = percentile(thresholdPool, config.metrics.qualityPercentile);

  type Accumulator = {
    winMethods: MethodBreakdown; lossMethods: MethodBreakdown;
    winMargins: number[]; lossMargins: number[];
    opponentRatings: number[]; sosExpected: number[];
    qualityWins: number; qualityLosses: number;
  };
  const acc = new Map<string, Accumulator>();
  const get = (key: string) => {
    let entry = acc.get(key);
    if (!entry) {
      entry = { winMethods: emptyBreakdown(), lossMethods: emptyBreakdown(), winMargins: [], lossMargins: [], opponentRatings: [], sosExpected: [], qualityWins: 0, qualityLosses: 0 };
      acc.set(key, entry);
    }
    return entry;
  };
  const reference = config.metrics.sosReferenceRating;
  for (const match of matches) {
    const winner = get(match.winnerKey);
    const loser = get(match.loserKey);
    const method = match.method as keyof MethodBreakdown;
    winner.winMethods[method] += 1;
    loser.lossMethods[method] += 1;
    if (match.margin != null) { winner.winMargins.push(match.margin); loser.lossMargins.push(match.margin); }
    const loserRating = current.get(match.loserKey)!.rating;
    const winnerRating = current.get(match.winnerKey)!.rating;
    winner.opponentRatings.push(loserRating);
    loser.opponentRatings.push(winnerRating);
    winner.sosExpected.push(1 / (1 + 10 ** ((loserRating - reference) / 400)));
    loser.sosExpected.push(1 / (1 + 10 ** ((winnerRating - reference) / 400)));
    if (loserRating >= qualityThreshold) winner.qualityWins += 1;
    if (winnerRating >= qualityThreshold) loser.qualityLosses += 1;
  }

  const history = options.recordHistory === false ? [] : model.history;
  const trendCutoffDay = asOfDay - config.metrics.trendDays;
  const trendBase = new Map<string, number>();
  for (const point of history) { // history is chronological per key
    if (point.endDay <= trendCutoffDay) trendBase.set(point.key, point.rating);
  }

  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const players: PlayerResult[] = [];
  for (const [key, record] of model.players) {
    const { rating, rd, sigma } = current.get(key)!;
    const a = acc.get(key)!;
    const identity = names.get(key)!;
    const wins = record.wins;
    const falls = a.winMethods.fall;
    const bonus = falls + a.winMethods.tech_fall + a.winMethods.major_decision;
    const base = trendBase.get(key);
    players.push({
      key,
      name: identity.name,
      team: identity.team,
      rating,
      rd,
      volatility: sigma,
      conservative: conservativeScore(rating, rd, config.uncertainty.k),
      status: statusFor(rd, config),
      games: record.games,
      wins,
      losses: record.losses,
      firstDate: new Date(record.firstDay * 86_400_000).toISOString().slice(0, 10),
      lastDate: new Date(record.lastDay * 86_400_000).toISOString().slice(0, 10),
      winMethods: a.winMethods,
      lossMethods: a.lossMethods,
      pinPct: wins ? falls / wins : null,
      bonusPct: wins ? bonus / wins : null,
      avgWinMargin: mean(a.winMargins),
      avgLossMargin: mean(a.lossMargins),
      marginSamples: a.winMargins.length + a.lossMargins.length,
      avgOpponentRating: mean(a.opponentRatings),
      sosExpectedWinPct: mean(a.sosExpected),
      qualityWins: a.qualityWins,
      qualityLosses: a.qualityLosses,
      trend: base == null ? null : rating - base,
    });
  }
  players.sort((a, b) => b.conservative - a.conservative || a.key.localeCompare(b.key));

  const dates = matches.map((m) => m.date).sort();
  return {
    players,
    history,
    asOfDate: options.asOfDate,
    asOfPeriod,
    qualityThreshold,
    qualityPoolSize: thresholdPool.length,
    matchCutoff: dates.at(-1) ?? null,
    firstMatchDate: dates[0] ?? null,
  };
}
