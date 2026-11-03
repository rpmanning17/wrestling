import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateRatings } from "../../src/lib/rating/engine";
import { Glicko2Model } from "../../src/lib/rating/models";
import { dayNumber } from "../../src/lib/rating/prepare";
import { walkForward } from "../../src/lib/rating/walk";
import { isoDay, prepared, raw, swapOutcome, syntheticLeague } from "./helpers";

const AS_OF = "2026-11-03";
const byKey = (result: ReturnType<typeof calculateRatings>) => new Map(result.players.map((p) => [p.key, p]));

describe("chronological handling", () => {
  it("gives identical ratings regardless of the order rows arrive in", () => {
    const { rows } = syntheticLeague({ wrestlers: 30, events: 12 });
    const shuffled = [...rows].sort((a, b) => b.id.localeCompare(a.id));
    const a = prepared(rows);
    const b = prepared(shuffled);
    const ra = calculateRatings(a.matches, a.config, { asOfDate: AS_OF });
    const rb = calculateRatings(b.matches, b.config, { asOfDate: AS_OF });
    assert.deepEqual(ra.players.map((p) => [p.key, p.rating, p.rd]), rb.players.map((p) => [p.key, p.rating, p.rd]));
  });

  it("a match cutoff behaves exactly like deleting every later match", () => {
    const { rows } = syntheticLeague({ wrestlers: 30, events: 20 });
    const cutoff = isoDay("2024-10-05", 150);
    const full = prepared(rows);
    const trimmed = prepared(rows.filter((row) => row.event_date <= cutoff));
    const withCutoff = calculateRatings(full.matches, full.config, { asOfDate: AS_OF, matchCutoff: cutoff });
    const manual = calculateRatings(trimmed.matches, trimmed.config, { asOfDate: AS_OF });
    assert.deepEqual(withCutoff.players.map((p) => [p.key, p.rating, p.rd, p.games]), manual.players.map((p) => [p.key, p.rating, p.rd, p.games]));
    assert.ok(withCutoff.players.length > 0);
  });
});

describe("no future-data leakage", () => {
  type Observed = { id: string; eventId: string; day: number; pFirst: number };

  /** Predictions oriented by alphabetical key so they are comparable when outcomes are flipped. */
  function predictions(rows: ReturnType<typeof syntheticLeague>["rows"], periodDays: number) {
    const { matches, config } = prepared(rows, { period: { days: periodDays } });
    const model = new Glicko2Model(config);
    const out: Observed[] = [];
    walkForward(matches, [model], {
      periodDays,
      onPrediction: ({ match, p }) => {
        const pWinner = p.glicko2!;
        const firstIsWinner = match.winnerKey < match.loserKey;
        out.push({ id: match.id, eventId: match.eventId, day: match.day, pFirst: firstIsWinner ? pWinner : 1 - pWinner });
      },
    });
    return new Map(out.map((o) => [o.id, o]));
  }

  for (const periodDays of [1, 7, 30]) {
    it(`flipping every result from event 15 onward never changes earlier or same-event predictions (${periodDays}-day periods)`, () => {
      const { rows } = syntheticLeague({ wrestlers: 40, events: 30, seed: 11 });
      const eventName = "League Event 15";
      const startDate = rows.filter((r) => r.event_name === eventName).map((r) => r.event_date).sort()[0];
      const flipped = rows.map((row) => (row.event_date >= startDate ? swapOutcome(row) : row));
      const base = predictions(rows, periodDays);
      const changed = predictions(flipped, periodDays);
      let comparedBefore = 0;
      let comparedSameEvent = 0;
      for (const [id, original] of base) {
        const other = changed.get(id)!;
        const date = isoDay("1970-01-01", original.day);
        // Tolerance covers floating-point asymmetry between p and 1 - p of the swapped match (~1e-16).
        // A genuine leak moves predictions by orders of magnitude more, as the sanity check below shows.
        if (date < startDate) { assert.ok(Math.abs(other.pFirst - original.pFirst) < 1e-9, `match ${id} before the event changed`); comparedBefore += 1; }
        const inEvent = rows.find((r) => r.id === id)!.event_name === eventName;
        if (inEvent) { assert.ok(Math.abs(other.pFirst - original.pFirst) < 1e-9, `match ${id} inside the event changed`); comparedSameEvent += 1; }
      }
      assert.ok(comparedBefore > 50 && comparedSameEvent > 5);
      // Sanity: later events DO depend on earlier results, so the test is able to detect a difference.
      const later = [...base.values()].filter((o) => isoDay("1970-01-01", o.day) > isoDay(startDate, 60));
      assert.ok(later.some((o) => Math.abs(changed.get(o.id)!.pFirst - o.pFirst) > 1e-3));
    });
  }

  it("day-two predictions of a multi-day event ignore day-one results of the same event", () => {
    const { rows } = syntheticLeague({ wrestlers: 40, events: 20, seed: 5 });
    const eventName = "League Event 10";
    const days = [...new Set(rows.filter((r) => r.event_name === eventName).map((r) => r.event_date))].sort();
    assert.equal(days.length, 2);
    const flipped = rows.map((row) => (row.event_name === eventName && row.event_date === days[0] ? swapOutcome(row) : row));
    const base = predictions(rows, 1);
    const changed = predictions(flipped, 1);
    const dayTwo = rows.filter((r) => r.event_name === eventName && r.event_date === days[1]);
    assert.ok(dayTwo.length > 3);
    for (const row of dayTwo) assert.ok(Math.abs(changed.get(row.id)!.pFirst - base.get(row.id)!.pFirst) < 1e-9);
  });

  it("alias resolution does not depend on outcomes", () => {
    const aliases = [{ alias_key: "grayson piaseck", canonical_key: "grayson piasecki", canonical_name: "Grayson Piasecki" }];
    const rows = [
      raw({ winner_name: "Grayson Piaseck", loser_name: "A One" }),
      raw({ winner_name: "B Two", loser_name: "Grayson Piasecki", event_date: "2026-02-01" }),
    ];
    const keysOf = (input: typeof rows) => prepared(input, {}, aliases).matches.flatMap((m) => [m.winnerKey, m.loserKey]).sort();
    assert.deepEqual(keysOf(rows), keysOf(rows.map(swapOutcome)).map((k) => k)); // same identity set either way
  });
});

describe("alias handling", () => {
  const aliases = [{ alias_key: "grayson piaseck", canonical_key: "grayson piasecki", canonical_name: "Grayson Piasecki" }];
  const rows = [
    raw({ winner_name: "Grayson Piaseck", loser_name: "A One", event_date: "2026-01-10", event_name: "E1" }),
    raw({ winner_name: "Grayson Piasecki", loser_name: "B Two", event_date: "2026-02-10", event_name: "E2" }),
    raw({ winner_name: "C Three", loser_name: "Grayson Piasecki", event_date: "2026-03-10", event_name: "E3" }),
  ];

  it("merges a reviewed alias into one canonical wrestler and counts the application", () => {
    const { matches, config, report } = prepared(rows, {}, aliases);
    assert.equal(report.aliasesApplied, 1);
    const result = calculateRatings(matches, config, { asOfDate: AS_OF });
    const grayson = byKey(result).get("grayson piasecki")!;
    assert.equal(grayson.games, 3);
    assert.equal(grayson.wins, 2);
    assert.equal(grayson.name, "Grayson Piasecki");
    assert.equal(byKey(result).has("grayson piaseck"), false);
  });

  it("keeps the two spellings separate when alias resolution is switched off", () => {
    const { matches, config } = prepared(rows, { matching: { aliasPolicy: "none" } }, aliases);
    const result = calculateRatings(matches, config, { asOfDate: AS_OF });
    assert.equal(byKey(result).get("grayson piasecki")!.games, 2);
    assert.equal(byKey(result).get("grayson piaseck")!.games, 1);
  });
});

describe("uncertainty and provisional status", () => {
  it("a newcomer's strong 3-1 start is rated high but flagged provisional and less certain than a veteran", () => {
    // Build opponents with established ratings by giving them many games first.
    const opponents = ["Opp 1400", "Opp 1500", "Opp 1650", "Opp 1800"];
    const field = Array.from({ length: 8 }, (_, i) => `Filler ${i}`);
    const warm: ReturnType<typeof raw>[] = [];
    // Round-robin among opponents and fillers across many weeks so they all accumulate games.
    const everyone = [...opponents, ...field];
    for (let week = 0; week < 20; week += 1) {
      for (let i = 0; i + 1 < everyone.length; i += 2) {
        const a = everyone[(i + week) % everyone.length];
        const b = everyone[(i + 1 + week * 3) % everyone.length];
        if (a === b) continue;
        // Make the four named opponents ordered by strength: lower index loses to higher.
        const strength = (n: string) => (opponents.includes(n) ? opponents.indexOf(n) + 5 : 2);
        const aWins = strength(a) >= strength(b);
        warm.push(raw({ winner_name: aWins ? a : b, loser_name: aWins ? b : a, event_date: isoDay("2025-01-01", week * 7), event_name: `Warm ${week}` }));
      }
    }
    const nolan = [
      raw({ winner_name: "Nolan", loser_name: "Opp 1400", event_date: "2026-10-31", event_name: "Debut" }),
      raw({ winner_name: "Nolan", loser_name: "Opp 1500", event_date: "2026-10-31", event_name: "Debut" }),
      raw({ winner_name: "Nolan", loser_name: "Opp 1650", event_date: "2026-10-31", event_name: "Debut" }),
      raw({ winner_name: "Opp 1800", loser_name: "Nolan", event_date: "2026-10-31", event_name: "Debut" }),
    ];
    const { matches, config } = prepared([...warm, ...nolan]);
    const result = calculateRatings(matches, config, { asOfDate: "2026-11-03" });
    const players = byKey(result);
    const newcomer = players.get("nolan")!;
    const veteran = players.get("opp 1650")!;
    assert.equal(newcomer.games, 4);
    assert.equal(newcomer.status, "provisional");
    assert.ok(newcomer.rd > veteran.rd + 40, `newcomer rd ${newcomer.rd} veteran rd ${veteran.rd}`);
    assert.ok(newcomer.rating > 1500, "wins over rated opponents must count immediately, with no cap");
    assert.ok(Math.abs(newcomer.conservative - (newcomer.rating - config.uncertainty.k * newcomer.rd)) < 1e-9);
  });

  it("inactivity raises RD but leaves the rating untouched", () => {
    const { rows } = syntheticLeague({ wrestlers: 24, events: 10, startDate: "2024-10-05" });
    const { matches, config } = prepared(rows);
    const soon = byKey(calculateRatings(matches, config, { asOfDate: "2025-03-01" }));
    const later = byKey(calculateRatings(matches, config, { asOfDate: "2026-11-03" }));
    let compared = 0;
    for (const [key, early] of soon) {
      const late = later.get(key)!;
      assert.equal(late.rating, early.rating);
      assert.ok(late.rd >= early.rd);
      compared += 1;
    }
    assert.ok(compared > 10);
    assert.ok([...later.values()].some((p) => p.rd > soon.get(p.key)!.rd + 20));
    assert.ok([...later.values()].every((p) => p.rd <= 350 + 1e-9));
  });

  it("k is configurable and only changes the conservative score", () => {
    const { rows } = syntheticLeague({ wrestlers: 20, events: 8 });
    const k0 = prepared(rows, { uncertainty: { k: 0 } });
    const k2 = prepared(rows, { uncertainty: { k: 2 } });
    const a = byKey(calculateRatings(k0.matches, k0.config, { asOfDate: AS_OF }));
    const b = byKey(calculateRatings(k2.matches, k2.config, { asOfDate: AS_OF }));
    for (const [key, player] of a) {
      assert.equal(player.rating, b.get(key)!.rating);
      assert.equal(player.rd, b.get(key)!.rd);
      assert.ok(Math.abs(player.conservative - player.rating) < 1e-9);
      assert.ok(Math.abs(b.get(key)!.conservative - (player.rating - 2 * player.rd)) < 1e-9);
    }
  });
});

describe("opponent adjustment end to end", () => {
  it("15-5 against elite opposition outranks 25-1 against weak opposition, and its schedule is harder", () => {
    const elites = Array.from({ length: 4 }, (_, i) => `Elite ${i}`);
    const weak = Array.from({ length: 4 }, (_, i) => `Weak ${i}`);
    const rows: ReturnType<typeof raw>[] = [];
    let week = 0;
    const play = (winner: string, loser: string) => rows.push(raw({ winner_name: winner, loser_name: loser, event_date: isoDay("2025-01-01", week * 7), event_name: `Ev ${week}`, round: `r${rows.length}` }));
    // Pools build their own strength: elites beat everyone outside their pool; weaklings lose to everyone outside theirs.
    for (let round = 0; round < 12; round += 1, week += 1) {
      for (let i = 0; i < 4; i += 1) {
        play(elites[i], weak[i]);
        play(elites[(i + 1) % 4], elites[i]);
        play(weak[(i + 1) % 4], weak[i]);
      }
    }
    // Challenger A: 15-5 vs elites. Challenger B: 25-1 vs weak.
    for (let i = 0; i < 20; i += 1, week += (i % 4 === 0 ? 1 : 0)) {
      if (i < 15) play("Challenger A", elites[i % 4]); else play(elites[i % 4], "Challenger A");
    }
    for (let i = 0; i < 26; i += 1, week += (i % 4 === 0 ? 1 : 0)) {
      if (i < 25) play("Challenger B", weak[i % 4]); else play(weak[i % 4], "Challenger B");
    }
    // A 10-player pool is too small for the default 80th-percentile "quality" cutoff (it would land above
    // the elites), so this test uses "above the median" to exercise the quality-win bookkeeping itself.
    const { matches, config } = prepared(rows, { metrics: { qualityPercentile: 0.5 } });
    const players = byKey(calculateRatings(matches, config, { asOfDate: AS_OF }));
    const a = players.get("challenger a")!;
    const b = players.get("challenger b")!;
    assert.equal(`${a.wins}-${a.losses}`, "15-5");
    assert.equal(`${b.wins}-${b.losses}`, "25-1");
    assert.ok(a.rating > b.rating, `A ${a.rating.toFixed(0)} vs B ${b.rating.toFixed(0)}`);
    assert.ok(a.avgOpponentRating! > b.avgOpponentRating!);
    assert.ok(a.sosExpectedWinPct! < b.sosExpectedWinPct!, "a harder schedule means a lower expected win rate for a reference wrestler");
    assert.ok(a.qualityWins > b.qualityWins);
  });

  it("strength of schedule is explanatory only: it does not change any rating", () => {
    const { rows } = syntheticLeague({ wrestlers: 24, events: 10 });
    const { matches, config } = prepared(rows);
    const base = calculateRatings(matches, config, { asOfDate: AS_OF });
    const tweaked = calculateRatings(matches, { ...config, metrics: { ...config.metrics, qualityPercentile: 0.5, sosReferenceRating: 1800 } }, { asOfDate: AS_OF });
    assert.deepEqual(base.players.map((p) => [p.key, p.rating, p.rd]), tweaked.players.map((p) => [p.key, p.rating, p.rd]));
  });

  it("method breakdown and margins are preserved without affecting baseline ratings", () => {
    const { matches, config } = prepared([
      raw({ winner_name: "A", loser_name: "B", win_type: "F", result: "Fall 1:10", event_date: "2026-01-10" }),
      raw({ winner_name: "A", loser_name: "C", win_type: "TF", result: "TF 15-0", event_date: "2026-01-10" }),
      raw({ winner_name: "A", loser_name: "D", win_type: "MD", result: "MD 12-3", event_date: "2026-01-10" }),
      raw({ winner_name: "A", loser_name: "E", win_type: "DEC", result: "Dec 4-3", event_date: "2026-01-10" }),
    ]);
    const a = byKey(calculateRatings(matches, config, { asOfDate: AS_OF })).get("a")!;
    assert.equal(a.pinPct, 0.25);
    assert.equal(a.bonusPct, 0.75);
    assert.deepEqual(a.winMethods, { decision: 1, major_decision: 1, tech_fall: 1, fall: 1 });
    assert.equal(a.avgWinMargin, (15 + 9 + 1) / 3);
  });
});

describe("dominance variant", () => {
  const rows = [
    raw({ winner_name: "A", loser_name: "B", win_type: "DEC", result: "Dec 3-2", event_date: "2026-01-10" }),
    raw({ winner_name: "C", loser_name: "D", win_type: "F", result: "Fall 0:30", event_date: "2026-01-10" }),
  ];

  it("is off by default and baseline outcomes are strictly binary", () => {
    const { matches, config } = prepared(rows);
    assert.equal(config.dominance.enabled, false);
    const players = byKey(calculateRatings(matches, config, { asOfDate: AS_OF }));
    assert.equal(players.get("a")!.rating, players.get("c")!.rating);
    assert.equal(players.get("b")!.rating, players.get("d")!.rating);
  });

  it("when enabled, a narrow decision moves ratings less than a fall", () => {
    const { matches, config } = prepared(rows, { dominance: { enabled: true, winnerScore: { decision: 0.8 } } });
    const players = byKey(calculateRatings(matches, config, { asOfDate: AS_OF }));
    assert.ok(players.get("a")!.rating < players.get("c")!.rating);
    assert.ok(players.get("b")!.rating > players.get("d")!.rating);
  });
});

describe("period policy", () => {
  it("rating periods are fixed windows, so the same matches in one period are simultaneous", () => {
    const { matches, config } = prepared([
      raw({ winner_name: "A", loser_name: "B", event_date: "2026-01-12", event_name: "X" }),
      raw({ winner_name: "B", loser_name: "C", event_date: "2026-01-13", event_name: "X" }),
    ], { period: { days: 7 } });
    // Mon 12th and Tue 13th fall in one weekly period: B's result vs C uses B's pre-period rating, not B's post-loss rating.
    const weekly = byKey(calculateRatings(matches, config, { asOfDate: AS_OF }));
    const daily = byKey(calculateRatings(matches, { ...config, period: { days: 1 } }, { asOfDate: AS_OF }));
    assert.notEqual(weekly.get("c")!.rating, daily.get("c")!.rating);
    assert.equal(dayNumber("2026-01-12") + 1, dayNumber("2026-01-13"));
  });
});
