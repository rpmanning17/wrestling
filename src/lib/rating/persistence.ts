import type { EngineResult } from "./engine";

export const roundPersisted = (value: number | null, digits: number) => value == null ? null : Number(value.toFixed(digits));
const round = roundPersisted;

/** Shared with calculate.ts: preserve every persisted field and rounding rule. */
export function serializeRatingRows(result: EngineResult, modelId: string) {
    const rows = result.players.map((p) => ({
      model_id: modelId, athlete_key: p.key, athlete_name: p.name, team: p.team,
      rating: round(p.rating, 3), rating_deviation: round(p.rd, 3), volatility: round(p.volatility, 6),
      conservative_score: round(p.conservative, 3), rating_status: p.status,
      match_count: p.games, wins: p.wins, losses: p.losses, first_match_date: p.firstDate, last_match_date: p.lastDate,
      pin_pct: round(p.pinPct, 5), bonus_pct: round(p.bonusPct, 5), win_methods: p.winMethods, loss_methods: p.lossMethods,
      avg_win_margin: round(p.avgWinMargin, 2), avg_loss_margin: round(p.avgLossMargin, 2), margin_samples: p.marginSamples,
      avg_opponent_rating: round(p.avgOpponentRating, 2), sos_expected_win_pct: round(p.sosExpectedWinPct, 5),
      quality_wins: p.qualityWins, quality_losses: p.qualityLosses, rating_trend: round(p.trend, 2),
    }));
  return rows;
}

export function serializeHistoryRows(result: EngineResult, modelId: string) {
    const history = result.history.map((h) => ({
      model_id: modelId, athlete_key: h.key, period_end: new Date(h.endDay * 86_400_000).toISOString().slice(0, 10),
      rating: round(h.rating, 3), rating_deviation: round(h.rd, 3), volatility: round(h.sigma, 6), match_count: h.games,
    }));
  return history;
}
