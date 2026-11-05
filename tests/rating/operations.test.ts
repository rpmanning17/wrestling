import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { inputFingerprint, legacyInputFingerprint, type Inputs } from "../../scripts/ratings/common";
import { raw } from "./helpers";

const inputs: Inputs = { matches: [raw({ winner_name: "Winner", loser_name: "Loser", id: "1" }), raw({ winner_name: "Winner", loser_name: "Loser", id: "2" })],
  aliases: [{ alias_key: "alias", canonical_key: "canonical", canonical_name: "Canonical" }], source: "fixture" };

describe("calculation operational safety", () => {
  it("fingerprints all context and alias display fields with order-independent unambiguous v2 encoding", () => {
    const hash = inputFingerprint(inputs);
    assert.notEqual(hash, legacyInputFingerprint(inputs));
    assert.equal(hash, inputFingerprint({ ...inputs, matches: [...inputs.matches].reverse() }));
    for (const field of Object.keys(inputs.matches[0])) {
      assert.notEqual(hash, inputFingerprint({ ...inputs, matches: [{ ...inputs.matches[0], [field]: "changed" }, inputs.matches[1]] }), field);
    }
    for (const field of ["event_name", "round", "city", "winner_team", "loser_team"]) {
      assert.notEqual(hash, inputFingerprint({ ...inputs, matches: [{ ...inputs.matches[0], [field]: "changed" }, inputs.matches[1]] }), field);
    }
    assert.notEqual(hash, inputFingerprint({ ...inputs, aliases: [{ ...inputs.aliases[0], canonical_name: "New display" }] }));
    const pair = (event_name: string, round: string) => ({ ...inputs, matches: [raw({ winner_name: "Winner", loser_name: "Loser", event_name, round })] });
    assert.notEqual(inputFingerprint(pair("a\u001fb", "c")), inputFingerprint(pair("a", "b\u001fc")));
  });

  it("rejects legacy write/activation/force commands before input reads or database access", () => {
    for (const args of [[], ["--activate"], ["--dry-run", "--activate"], ["--dry-run", "--force"]]) {
      const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/ratings/calculate.ts", ...args, "--input", "does-not-exist.json"], { encoding: "utf8" });
      assert.equal(run.status, 1);
      assert.match(run.stderr, /Calculation is read-only/);
      assert.doesNotMatch(run.stderr, /ENOENT/);
    }
  });
});
