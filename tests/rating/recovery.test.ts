import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { resolveConfig } from "../../src/lib/rating/config";
import { calculateRatings } from "../../src/lib/rating/engine";
import { prepareMatches } from "../../src/lib/rating/prepare";
import { serializeRatingRows, serializeHistoryRows } from "../../src/lib/rating/persistence";
import { assertSameFormula, guardedBatchSql, sqlLiteral } from "../../src/lib/rating/recovery";
import { raw, syntheticLeague } from "./helpers";

const production = resolveConfig(JSON.parse(readFileSync("config/ratings.production.json", "utf8")));
const recovery = resolveConfig(JSON.parse(readFileSync("config/ratings.recovery-20261104.json", "utf8")));
const modelId = "10000000-0000-4000-8000-000000000001";

describe("canonical provenance-only recovery", () => {
  it("changes only modelVersion, retaining the exact resolved production formula", () => {
    assertSameFormula(production, recovery);
    assert.notEqual(production.modelVersion, recovery.modelVersion);
    assert.deepEqual({ ...production, modelVersion: recovery.modelVersion }, recovery);
    assert.throws(() => assertSameFormula(production, production), /distinct version/);
    assert.throws(() => assertSameFormula(production, { ...recovery, period: { days: 7 } }), /production formula/);
  });

  for (const spacingDays of [1, 14, 120]) {
    it(`serializes every rating/SOS/method/history field identically (${spacingDays}-day gaps)`, () => {
      const { rows } = syntheticLeague({ wrestlers: 40, events: 20, spacingDays, seed: 23 });
      rows.push(raw({ winner_name: "Alias", loser_name: "Other", win_type: "TF", result: "16-0" }));
      rows.push(raw({ winner_name: "Excluded", loser_name: "Other", win_type: "FOR" }));
      const aliases = [{ alias_key: "alias", canonical_key: "canonical", canonical_name: "Canonical" }];
      const calculate = (config: typeof production) => calculateRatings(
        prepareMatches(rows, aliases, config).matches, config, { asOfDate: "2035-11-04", recordHistory: true });
      const a = calculate(production), b = calculate(recovery);
      assert.ok(a.history.length > 0);
      assert.equal(JSON.stringify(serializeRatingRows(a, modelId)), JSON.stringify(serializeRatingRows(b, modelId)));
      assert.equal(JSON.stringify(serializeHistoryRows(a, modelId)), JSON.stringify(serializeHistoryRows(b, modelId)));
    });
  }

  it("retries interrupted ratings/history without overwrites and fails closed on provenance/status/conflicts", async () => {
    const db = new PGlite();
    try {
      const migration = readFileSync("supabase/migrations/202611030009_create_versioned_opponent_adjusted_ratings.sql", "utf8");
      for (const name of ["rating_models", "wrestler_model_ratings", "wrestler_rating_history"]) {
        const start = migration.indexOf(`create table public.${name} (`);
        await db.exec(migration.slice(start, migration.indexOf("\n);", start) + 4));
      }
      const model = { id: modelId, status: "building", code_version: "canonical-commit/glicko2-engine-1",
        model_version: "recovery", config: {}, config_hash: "a".repeat(64), input_fingerprint: "b".repeat(64),
        as_of_date: "2026-11-04", match_cutoff: null };
      await db.exec(`insert into public.rating_models
        (id,model_version,config,config_hash,input_fingerprint,code_version,as_of_date,rating_period_policy,
         rating_period_days,uncertainty_k,provisional_rd,established_rd,recency_policy)
        values ('${modelId}','recovery','{}','${"a".repeat(64)}','${"b".repeat(64)}',
        ${sqlLiteral(model.code_version)},'2026-11-04','fixed_1d',1,1,120,80,'glicko2_inactivity_rd_growth');`);
      const source = [raw({ winner_name: "O'Brien $guard$", loser_name: "Opponent" })];
      const result = calculateRatings(prepareMatches(source, [], production).matches, production,
        { asOfDate: "2026-11-04", recordHistory: true });
      const ratings = serializeRatingRows(result, modelId), history = serializeHistoryRows(result, modelId);
      await db.exec(guardedBatchSql(model, "wrestler_model_ratings", ratings.slice(0, 1)));
      // Simulate lost acknowledgement/interruption, then replay all expected rows twice.
      for (let retry = 0; retry < 2; retry++) {
        await db.exec(guardedBatchSql(model, "wrestler_model_ratings", ratings));
        await db.exec(guardedBatchSql(model, "wrestler_rating_history", history));
      }
      const before = await db.query("select to_jsonb(r) r from public.wrestler_model_ratings r order by athlete_key");
      assert.equal(before.rows.length, ratings.length);
      assert.equal((await db.query("select * from public.wrestler_rating_history")).rows.length, history.length);
      await assert.rejects(db.exec(guardedBatchSql({ ...model, code_version: "chat-20261104/glicko2-engine-1" },
        "wrestler_model_ratings", ratings)), /provenance mismatch/);
      // Nested metadata must be exactly equal, not merely JSON containment.
      await db.exec(`update public.rating_models set config='{"unexpected":true}' where id='${modelId}'`);
      await assert.rejects(db.exec(guardedBatchSql({ ...model, config: {} }, "wrestler_model_ratings", ratings)), /provenance mismatch/);
      await db.exec(`update public.rating_models set config='{}' where id='${modelId}'`);
      for (const field of ["rating", "rating_deviation", "volatility", "wins", "avg_opponent_rating", "sos_expected_win_pct"]) {
        const changed = ratings.map(r => ({ ...r, [field]: Number(r[field as keyof typeof r]) + 1 }));
        await assert.rejects(db.exec(guardedBatchSql(model, "wrestler_model_ratings", changed)), /existing-row mismatch/);
      }
      await assert.rejects(db.exec(guardedBatchSql(model, "wrestler_rating_history",
        history.map(h => ({ ...h, rating: h.rating! + 1 })))), /existing-row mismatch/);
      assert.deepEqual((await db.query("select to_jsonb(r) r from public.wrestler_model_ratings r order by athlete_key")).rows, before.rows);
      const { config_hash: omitted, ...incomplete } = model;
      assert.ok(omitted);
      assert.throws(() => guardedBatchSql(incomplete, "wrestler_model_ratings", ratings), /Complete expected/);
      await db.exec(`update public.rating_models set status='archived' where id='${modelId}'`);
      await assert.rejects(db.exec(guardedBatchSql(model, "wrestler_model_ratings", ratings)), /provenance mismatch/);
      await db.exec(`update public.rating_models set status='active' where id='${modelId}'`);
      await assert.rejects(db.exec(guardedBatchSql(model, "wrestler_model_ratings", ratings)), /provenance mismatch/);
      assert.throws(() => guardedBatchSql({ ...model, status: "active" }, "wrestler_model_ratings", ratings), /building model/);
      assert.throws(() => guardedBatchSql(model, "wrestler_model_ratings", [ratings[0], ratings[0]]), /Duplicate/);
    } finally { await db.close(); }
  });
});
