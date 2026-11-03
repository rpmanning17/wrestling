import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareModels, runBacktest, standardModels } from "../../src/lib/rating/backtest";
import { defaultVariants, tuneAndConfirm } from "../../src/lib/rating/grid";
import { CoinFlipModel } from "../../src/lib/rating/models";
import { prepared, raw, signalLeague, syntheticLeague } from "./helpers";

describe("backtest metrics", () => {
  it("coin flip scores exactly ln 2, 0.25 and 50% on any data", () => {
    const { matches } = prepared([
      raw({ winner_name: "A", loser_name: "B", event_name: "E1", event_date: "2026-01-10" }),
      raw({ winner_name: "C", loser_name: "D", event_name: "E1", event_date: "2026-01-10" }),
    ]);
    const report = runBacktest(matches, [new CoinFlipModel()], { periodDays: 7, evaluateFrom: "2026-01-01" });
    const metrics = report.models[0].overall;
    assert.equal(metrics.n, 2);
    assert.ok(Math.abs(metrics.logLoss! - Math.LN2) < 1e-12);
    assert.ok(Math.abs(metrics.brier! - 0.25) < 1e-12);
    assert.equal(metrics.accuracy, 0.5); // ties on exactly 0.5 count half
  });

  it("calibration bins cover both orientations of every match and sum to twice the sample", () => {
    const { rows } = syntheticLeague({ wrestlers: 30, events: 20 });
    const { matches, config } = prepared(rows);
    const report = runBacktest(matches, standardModels(config), { periodDays: config.period.days });
    for (const model of report.models) {
      assert.equal(model.overall.calibration.reduce((sum, bin) => sum + bin.n, 0), model.overall.n * 2);
    }
  });

  it("warm-up and held-out windows are respected and the first events can not be scored without history", () => {
    const { rows } = syntheticLeague({ wrestlers: 30, events: 20 });
    const { matches, config } = prepared(rows);
    const all = runBacktest(matches, [new CoinFlipModel()], { periodDays: 7, evaluateFrom: "2000-01-01" });
    const warm = runBacktest(matches, [new CoinFlipModel()], { periodDays: 7, warmupDays: 60 });
    const windowed = runBacktest(matches, [new CoinFlipModel()], { periodDays: 7, evaluateFrom: "2025-01-01", evaluateUntil: "2025-03-01" });
    assert.equal(all.scored, matches.length);
    assert.equal(warm.scored + warm.warmupSkipped, matches.length);
    assert.ok(warm.warmupSkipped > 0 && warm.scored < all.scored);
    assert.ok(windowed.scored > 0 && windowed.scored < warm.scored);
    assert.ok(config.period.days === 7);
  });

  it("every match falls in exactly one label for each segment dimension", () => {
    const { rows } = syntheticLeague({ wrestlers: 40, events: 30 });
    const { matches, config } = prepared(rows);
    const report = runBacktest(matches, standardModels(config), { periodDays: config.period.days });
    const glicko = report.models[0];
    for (const dimension of ["experience", "weight", "age", "activity"]) {
      const total = Object.entries(glicko.segments).filter(([key]) => key.startsWith(`${dimension}:`)).reduce((sum, [, metrics]) => sum + metrics.n, 0);
      assert.equal(total, glicko.overall.n, dimension);
    }
  });

  it("newcomer matches are reported separately from established-vs-established matches", () => {
    const { rows } = syntheticLeague({ wrestlers: 50, events: 40, seed: 3 });
    const { matches, config } = prepared(rows);
    const report = runBacktest(matches, standardModels(config), { periodDays: config.period.days });
    const segments = report.models[0].segments;
    assert.ok((segments["experience:newcomer_involved"]?.n ?? 0) > 0);
    assert.ok((segments["experience:both_established"]?.n ?? 0) > 0);
  });
});

describe("what the harness can detect", () => {
  it("opponent-adjusted Glicko-2 beats every baseline on league data with known skills", () => {
    const { rows } = syntheticLeague({ wrestlers: 80, events: 60, seed: 21 });
    const { matches, config } = prepared(rows);
    const report = runBacktest(matches, standardModels(config), { periodDays: config.period.days });
    const by = new Map(report.models.map((m) => [m.name, m]));
    const glicko = by.get("glicko2")!;
    for (const baseline of ["coin_flip", "win_rate_log5", "elo", "legacy_heuristic"]) {
      const comparison = compareModels(glicko, by.get(baseline)!, 300);
      assert.ok(comparison.deltaLogLoss < 0, `${baseline} ${comparison.deltaLogLoss}`);
    }
    assert.ok(compareModels(glicko, by.get("coin_flip")!, 300).significantlyBetter);
    assert.ok(glicko.overall.ece! < 0.08, `ece ${glicko.overall.ece}`);
    assert.ok(glicko.overall.accuracy! > 0.65);
  });

  it("does not adopt any change when nothing beats the baseline (false-positive control)", () => {
    // Win method is generated independently of skill, so dominance adjustments carry no real signal.
    const { rows } = syntheticLeague({ wrestlers: 70, events: 50, seed: 99 });
    const variants = defaultVariants().filter((v) => ["baseline", "dominance-dec-0.8", "dominance-graded", "aliases-off", "outcomes-include-default-dq"].includes(v.id));
    const result = tuneAndConfirm(rows, [], variants, { bootstrapIterations: 150 });
    const adoptedIds = result.adoptedVariants.map((v) => v.id);
    assert.ok(!adoptedIds.includes("aliases-off"));
    assert.ok(!adoptedIds.includes("outcomes-include-default-dq"));
    assert.ok(!adoptedIds.some((id) => id.startsWith("dominance")), `adopted ${adoptedIds.join(",")}`);
    assert.equal(result.confirmation.recommendation, "keep_baseline");
  });

  it("positive control: adopts a dominance adjustment when the win method really carries skill information", () => {
    const rows = signalLeague({ events: 200 });
    const variants = defaultVariants().filter((v) => ["baseline", "dominance-dec-0.8", "dominance-dec-0.9"].includes(v.id));
    const result = tuneAndConfirm(rows, [], variants, { bootstrapIterations: 200 });
    assert.ok(result.adoptedVariants.some((v) => v.id.startsWith("dominance")), "tuning window should detect the signal");
    assert.equal(result.confirmation.recommendation, "adopt_candidate");
    assert.ok(result.confirmation.comparison.ci95[1] < 0);
  });

  it("is deterministic: the same inputs give identical metrics", () => {
    const { rows } = syntheticLeague({ wrestlers: 30, events: 20 });
    const a = prepared(rows);
    const b = prepared(rows);
    const ra = runBacktest(a.matches, standardModels(a.config), { periodDays: 7 });
    const rb = runBacktest(b.matches, standardModels(b.config), { periodDays: 7 });
    assert.deepEqual(ra.models.map((m) => m.overall), rb.models.map((m) => m.overall));
  });
});
