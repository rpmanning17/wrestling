import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { syntheticLeague } from "./helpers";

describe("recency experiment read-only CLI smoke test", () => {
  it("runs on an offline synthetic snapshot and emits audit-ready segment/event/fingerprint diagnostics", () => {
    const directory = mkdtempSync(join(tmpdir(), "mat-notes-recency-"));
    try {
      const input = join(directory, "input.json");
      const out = join(directory, "report.md");
      const json = join(directory, "report.json");
      const { rows } = syntheticLeague({ wrestlers: 24, events: 18, seed: 97, spacingDays: 14 });
      writeFileSync(input, JSON.stringify({ matches: rows, aliases: [] }), "utf8");

      const run = spawnSync(process.execPath, [
        "--import", "tsx", "scripts/ratings/recency-backtest.ts",
        "--input", input, "--out", out, "--json", json,
        "--iterations", "100", "--drifts", "50,100",
      ], { cwd: process.cwd(), encoding: "utf8", timeout: 60000 });

      assert.equal(run.status, 0, `stdout: ${run.stdout}\nstderr: ${run.stderr}`);
      const report = readFileSync(out, "utf8");
      const payload = JSON.parse(readFileSync(json, "utf8")) as {
        inputs: { total: number; rated: number; sourceFingerprint: string; baselineConfigHash: string };
        windows: { evaluateFrom: string; splitDate: string };
        tuning: Array<{ drift: number; comparison: { matches: number } }>;
        confirmation: { baseline: { n: number }; segments: unknown[]; concentration: { events: number } };
        selectedDrift: number | null;
      };
      assert.match(report, /Holdout segment diagnostics/);
      assert.match(report, /Event concentration/);
      assert.match(report, /Input fingerprint/);
      assert.match(report, /NOT a production adoption/);
      assert.equal(payload.inputs.total, rows.length);
      assert.ok(payload.inputs.rated > 0);
      assert.equal(payload.inputs.sourceFingerprint.length, 64);
      assert.equal(payload.inputs.baselineConfigHash, "1eb854346d016d2c1276d8cc5209f73acac90c433fcc23636743e6a5e1881a67");
      assert.deepEqual(payload.tuning.map((v) => v.drift), [50, 100]);
      assert.ok(payload.tuning.every((v) => v.comparison.matches > 0));
      assert.ok(payload.windows.splitDate > payload.windows.evaluateFrom);
      assert.ok(payload.confirmation.baseline.n > 0);
      assert.ok(payload.confirmation.concentration.events > 0);
      assert.equal(payload.confirmation.segments.length, 11);
      assert.ok(payload.selectedDrift === null || [50, 100].includes(payload.selectedDrift));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
