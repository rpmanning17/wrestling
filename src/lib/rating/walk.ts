import type { RatedMatch } from "./prepare";

/**
 * Chronological walk-forward protocol shared by the rating calculation and the backtest.
 *
 * Leakage rule: every match in an event is predicted from a snapshot taken BEFORE the rating period
 * that contains the event's first match. A snapshot therefore contains only matches in earlier
 * periods, and never any result from the same event, even for multi-day events. Updates from a period
 * are applied only after every match in that period has been predicted.
 */
export interface WalkModel<Snapshot> {
  readonly name: string;
  /** Cheap, immutable view of the model as of the start of `periodIndex`. */
  snapshot(periodIndex: number): Snapshot;
  /** Probability that the match winner beats the loser, or null when the model abstains. */
  predict(snapshot: Snapshot, match: RatedMatch, history: HistoryView): number | null;
  /** Apply every match in the period (simultaneously). */
  update(periodIndex: number, matches: RatedMatch[]): void;
}

/** What was publicly knowable about each wrestler at the snapshot: used for segmenting, never for rating. */
export interface HistoryView {
  games(key: string): number;
  lastDay(key: string): number | null;
  lastBracketWeight(key: string): number | null;
  lastAgeGroup(key: string): string | null;
}

type HistoryEntry = { games: number; lastDay: number; weight: number | null; age: string | null };

class HistoryTracker implements HistoryView {
  constructor(private entries: Map<string, HistoryEntry> = new Map()) {}
  games(key: string) { return this.entries.get(key)?.games ?? 0; }
  lastDay(key: string) { return this.entries.get(key)?.lastDay ?? null; }
  lastBracketWeight(key: string) { return this.entries.get(key)?.weight ?? null; }
  lastAgeGroup(key: string) { return this.entries.get(key)?.age ?? null; }
  snapshot() { return new HistoryTracker(new Map(this.entries)); }
  update(matches: RatedMatch[]) {
    for (const match of matches) {
      for (const key of [match.winnerKey, match.loserKey]) {
        const previous = this.entries.get(key);
        this.entries.set(key, {
          games: (previous?.games ?? 0) + 1,
          lastDay: Math.max(previous?.lastDay ?? match.day, match.day),
          weight: match.bracketWeight ?? previous?.weight ?? null,
          age: match.ageGroup ?? previous?.age ?? null,
        });
      }
    }
  }
}

/** Mondays: 1970-01-05 is day 4. Periods are fixed-length windows anchored on a Monday. */
const PERIOD_ANCHOR_DAY = 4;
export const periodIndexOf = (day: number, periodDays: number) => Math.floor((day - PERIOD_ANCHOR_DAY) / periodDays);
export const periodEndDay = (periodIndex: number, periodDays: number) => (periodIndex + 1) * periodDays + PERIOD_ANCHOR_DAY - 1;

export type WalkPrediction = {
  match: RatedMatch;
  /** One entry per model, keyed by model name. */
  p: Record<string, number | null>;
  history: HistoryView;
  /** Index of the period whose start-of-period snapshot produced the prediction. */
  snapshotPeriod: number;
};

export type WalkOptions = {
  periodDays: number;
  /** Called for each match, in chronological order, with predictions made before any same-period update. */
  onPrediction?: (prediction: WalkPrediction) => void;
  /** Called after each period's updates are applied. */
  onPeriodApplied?: (periodIndex: number, matches: RatedMatch[]) => void;
};

export function walkForward(matches: RatedMatch[], models: ReadonlyArray<WalkModel<unknown>>, options: WalkOptions) {
  const { periodDays } = options;
  const ordered = [...matches].sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));

  const periods = new Map<number, RatedMatch[]>();
  const eventLastPeriod = new Map<string, number>();
  const eventStartPeriod = new Map<string, number>();
  for (const match of ordered) {
    const index = periodIndexOf(match.day, periodDays);
    const list = periods.get(index);
    if (list) list.push(match); else periods.set(index, [match]);
    eventLastPeriod.set(match.eventId, Math.max(eventLastPeriod.get(match.eventId) ?? index, index));
    eventStartPeriod.set(match.eventId, periodIndexOf(match.eventStartDay, periodDays));
  }

  const tracker = new HistoryTracker();
  type Frozen = { snapshots: unknown[]; history: HistoryTracker; period: number };
  const eventFrozen = new Map<string, Frozen>();

  for (const index of [...periods.keys()].sort((a, b) => a - b)) {
    const periodMatches = periods.get(index)!;

    if (options.onPrediction) {
      let frozen: Frozen | null = null;
      const frozenFor = () => (frozen ??= { snapshots: models.map((model) => model.snapshot(index)), history: tracker.snapshot(), period: index });
      for (const match of periodMatches) {
        if (!eventFrozen.has(match.eventId)) {
          // The first match of an event always lies in the period containing the event's start day.
          if (eventStartPeriod.get(match.eventId) !== index) throw new Error(`Event ${match.eventId} has no snapshot for period ${index}`);
          eventFrozen.set(match.eventId, frozenFor());
        }
      }
      for (const match of periodMatches) {
        const snap = eventFrozen.get(match.eventId)!;
        const p: Record<string, number | null> = {};
        models.forEach((model, i) => { p[model.name] = model.predict(snap.snapshots[i], match, snap.history); });
        options.onPrediction({ match, p, history: snap.history, snapshotPeriod: snap.period });
      }
    }

    for (const model of models) model.update(index, periodMatches);
    tracker.update(periodMatches);
    options.onPeriodApplied?.(index, periodMatches);

    for (const [eventId, last] of eventLastPeriod) {
      if (last <= index) { eventFrozen.delete(eventId); eventLastPeriod.delete(eventId); }
    }
  }
}
