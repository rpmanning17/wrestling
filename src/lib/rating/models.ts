import type { RatingConfig } from "./config";
import {
  initialState,
  inflatePhi,
  muToRating,
  phiToRd,
  rdToPhi,
  updatePlayer,
  winProbability,
  type Game,
  type PlayerState,
} from "./glicko2";
import type { RatedMatch } from "./prepare";
import { periodEndDay, type WalkModel } from "./walk";

/** Score credited to the winner. Baseline Glicko-2 is always 1; dominance variants are experimental. */
export function winnerScore(match: Pick<RatedMatch, "method" | "margin">, config: RatingConfig): number {
  const { dominance } = config;
  if (!dominance.enabled) return 1;
  const base = dominance.winnerScore[match.method as keyof typeof dominance.winnerScore];
  if (base == null) return 1;
  if (match.method === "decision" && dominance.margin?.enabled && match.margin != null) {
    const { capPoints, decisionMin } = dominance.margin;
    const fraction = Math.min(1, Math.max(0, match.margin / capPoints));
    return decisionMin + (base - decisionMin) * fraction;
  }
  return base;
}

export type GlickoPlayer = {
  state: PlayerState;
  /** Index of the last rating period that updated this player. Empty periods since then are applied lazily. */
  lastPeriod: number;
  games: number;
  wins: number;
  losses: number;
  firstDay: number;
  lastDay: number;
};

export type HistoryPoint = { key: string; periodIndex: number; endDay: number; rating: number; rd: number; sigma: number; games: number };

export type GlickoSnapshot = { players: Map<string, GlickoPlayer>; period: number };

export class Glicko2Model implements WalkModel<GlickoSnapshot> {
  readonly name: string;
  readonly players = new Map<string, GlickoPlayer>();
  readonly history: HistoryPoint[] = [];
  private readonly maxPhi: number;

  constructor(readonly config: RatingConfig, name = "glicko2", private readonly recordHistory = false) {
    this.name = name;
    this.maxPhi = rdToPhi(config.glicko.maxRd);
  }

  /** State of a player at the START of `period`, with inactivity applied for every empty period before it. */
  stateAt(players: Map<string, GlickoPlayer>, key: string, period: number): PlayerState {
    const player = players.get(key);
    if (!player) return initialState(this.config.glicko);
    const empty = period - 1 - player.lastPeriod;
    if (empty <= 0) return player.state;
    return { ...player.state, phi: inflatePhi(player.state.phi, player.state.sigma, empty, this.maxPhi) };
  }

  /** State at the END of `period`: all periods through `period` have elapsed (used for "as of" displays). */
  stateAfter(key: string, period: number): PlayerState {
    return this.stateAt(this.players, key, period + 1);
  }

  snapshot(period: number): GlickoSnapshot {
    return { players: new Map(this.players), period };
  }

  predict(snapshot: GlickoSnapshot, match: RatedMatch): number {
    const winner = this.stateAt(snapshot.players, match.winnerKey, snapshot.period);
    const loser = this.stateAt(snapshot.players, match.loserKey, snapshot.period);
    return winProbability(winner, loser, this.config.predictor);
  }

  update(period: number, matches: RatedMatch[]) {
    // Pre-period states, computed before any update so that games within a period are simultaneous.
    const pre = new Map<string, PlayerState>();
    const gamesByPlayer = new Map<string, Game[]>();
    const stats = new Map<string, { wins: number; losses: number; firstDay: number; lastDay: number }>();
    const pre_ = (key: string) => {
      let state = pre.get(key);
      if (!state) { state = this.stateAt(this.players, key, period); pre.set(key, state); }
      return state;
    };

    for (const match of matches) {
      const s = winnerScore(match, this.config);
      const winner = pre_(match.winnerKey);
      const loser = pre_(match.loserKey);
      const push = (key: string, game: Game) => {
        const list = gamesByPlayer.get(key);
        if (list) list.push(game); else gamesByPlayer.set(key, [game]);
      };
      push(match.winnerKey, { opponentMu: loser.mu, opponentPhi: loser.phi, score: s });
      push(match.loserKey, { opponentMu: winner.mu, opponentPhi: winner.phi, score: 1 - s });
      const bump = (key: string, won: boolean) => {
        const entry = stats.get(key) ?? { wins: 0, losses: 0, firstDay: match.day, lastDay: match.day };
        if (won) entry.wins += 1; else entry.losses += 1;
        entry.firstDay = Math.min(entry.firstDay, match.day);
        entry.lastDay = Math.max(entry.lastDay, match.day);
        stats.set(key, entry);
      };
      bump(match.winnerKey, true);
      bump(match.loserKey, false);
    }

    const endDay = periodEndDay(period, this.config.period.days);
    for (const [key, games] of gamesByPlayer) {
      const next = updatePlayer(pre_(key), games, this.config.glicko);
      const previous = this.players.get(key);
      const delta = stats.get(key)!;
      const record: GlickoPlayer = {
        state: next,
        lastPeriod: period,
        games: (previous?.games ?? 0) + games.length,
        wins: (previous?.wins ?? 0) + delta.wins,
        losses: (previous?.losses ?? 0) + delta.losses,
        firstDay: previous ? Math.min(previous.firstDay, delta.firstDay) : delta.firstDay,
        lastDay: previous ? Math.max(previous.lastDay, delta.lastDay) : delta.lastDay,
      };
      this.players.set(key, record);
      if (this.recordHistory) {
        this.history.push({ key, periodIndex: period, endDay, rating: muToRating(next.mu), rd: phiToRd(next.phi), sigma: next.sigma, games: record.games });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Comparison baselines. These exist only so the backtest can show whether Glicko-2 earns its keep.
// ---------------------------------------------------------------------------------------------

/** Constant 0.5. Any model must beat this on log loss and Brier. */
export class CoinFlipModel implements WalkModel<null> {
  readonly name = "coin_flip";
  snapshot() { return null; }
  predict() { return 0.5; }
  update() { /* stateless */ }
}

/** Plain Elo, simultaneous within a period, with a larger K for a player's first games. */
export class EloModel implements WalkModel<Map<string, { rating: number; games: number }>> {
  readonly name: string;
  private ratings = new Map<string, { rating: number; games: number }>();
  constructor(private readonly k = 24, private readonly provisionalK = 48, private readonly provisionalGames = 8, name = "elo") { this.name = name; }
  snapshot() { return new Map(this.ratings); }
  predict(snapshot: Map<string, { rating: number; games: number }>, match: RatedMatch) {
    const a = snapshot.get(match.winnerKey)?.rating ?? 1500;
    const b = snapshot.get(match.loserKey)?.rating ?? 1500;
    return 1 / (1 + 10 ** ((b - a) / 400));
  }
  update(_period: number, matches: RatedMatch[]) {
    const before = new Map(this.ratings);
    const read = (key: string) => before.get(key) ?? { rating: 1500, games: 0 };
    const deltas = new Map<string, { change: number; games: number }>();
    const add = (key: string, change: number) => {
      const entry = deltas.get(key) ?? { change: 0, games: 0 };
      entry.change += change;
      entry.games += 1;
      deltas.set(key, entry);
    };
    for (const match of matches) {
      const w = read(match.winnerKey);
      const l = read(match.loserKey);
      const expected = 1 / (1 + 10 ** ((l.rating - w.rating) / 400));
      const kw = w.games < this.provisionalGames ? this.provisionalK : this.k;
      const kl = l.games < this.provisionalGames ? this.provisionalK : this.k;
      add(match.winnerKey, kw * (1 - expected));
      add(match.loserKey, -kl * (1 - expected));
    }
    for (const [key, delta] of deltas) {
      const previous = read(key);
      this.ratings.set(key, { rating: previous.rating + delta.change, games: previous.games + delta.games });
    }
  }
}

/** Laplace-smoothed win rate combined with the log5 formula. Ignores opponent quality entirely. */
export class WinRateModel implements WalkModel<Map<string, { wins: number; games: number }>> {
  readonly name = "win_rate_log5";
  private record = new Map<string, { wins: number; games: number }>();
  snapshot() { return new Map(this.record); }
  predict(snapshot: Map<string, { wins: number; games: number }>, match: RatedMatch) {
    const rate = (key: string) => { const r = snapshot.get(key); return ((r?.wins ?? 0) + 1) / ((r?.games ?? 0) + 2); };
    const a = rate(match.winnerKey);
    const b = rate(match.loserKey);
    return (a * (1 - b)) / (a * (1 - b) + b * (1 - a));
  }
  update(_period: number, matches: RatedMatch[]) {
    for (const match of matches) {
      for (const [key, won] of [[match.winnerKey, 1], [match.loserKey, 0]] as const) {
        const previous = this.record.get(key) ?? { wins: 0, games: 0 };
        this.record.set(key, { wins: previous.wins + won, games: previous.games + 1 });
      }
    }
  }
}

/**
 * Stand-in for the pre-existing ranking recipe (win rate, decisive-win share, volume, recency) at the
 * time of each event. Placements are excluded because they cannot be time-gated here. The score is not
 * a probability, so only ordering accuracy is meaningful; probabilities are a crude logistic of the gap.
 */
export class LegacyHeuristicModel implements WalkModel<Map<string, { wins: number; games: number; decisive: number; lastDay: number }>> {
  readonly name = "legacy_heuristic";
  readonly calibrated = false;
  private record = new Map<string, { wins: number; games: number; decisive: number; lastDay: number }>();
  snapshot() { return new Map(this.record); }
  predict(snapshot: Map<string, { wins: number; games: number; decisive: number; lastDay: number }>, match: RatedMatch) {
    const score = (key: string) => {
      const r = snapshot.get(key);
      if (!r || !r.games) return 0;
      const recency = Math.max(0, 1 - (match.eventStartDay - r.lastDay) / 730);
      return (r.wins / r.games) * 500 + (r.wins ? r.decisive / r.wins : 0) * 100 + recency * 100 + Math.min(1, r.games / 20) * 100;
    };
    return 1 / (1 + Math.exp(-(score(match.winnerKey) - score(match.loserKey)) / 100));
  }
  update(_period: number, matches: RatedMatch[]) {
    for (const match of matches) {
      const decisive = match.method === "fall" || match.method === "tech_fall" || match.method === "major_decision" ? 1 : 0;
      const w = this.record.get(match.winnerKey) ?? { wins: 0, games: 0, decisive: 0, lastDay: match.day };
      this.record.set(match.winnerKey, { wins: w.wins + 1, games: w.games + 1, decisive: w.decisive + decisive, lastDay: Math.max(w.lastDay, match.day) });
      const l = this.record.get(match.loserKey) ?? { wins: 0, games: 0, decisive: 0, lastDay: match.day };
      this.record.set(match.loserKey, { wins: l.wins, games: l.games + 1, decisive: l.decisive, lastDay: Math.max(l.lastDay, match.day) });
    }
  }
}
