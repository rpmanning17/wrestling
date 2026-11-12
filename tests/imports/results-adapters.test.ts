import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adaptResults, seasonFor, RESULTS_TABLE_HEADER } from "../../src/lib/imports/results-adapters";

const wrap = (cells: string[]) => cells.map(c => `"=""${c.replaceAll('"', '""""')}"""`).join(",");
const header = wrap([...RESULTS_TABLE_HEADER]);
const row = (weight: string, winner: string, loser: string, method = "DEC", result = "5-3") =>
  wrap(["11/8/2026", weight, "Round 1", winner, "Club A", result, method, loser, "Trey?s, Club", "Pembroke Pines", "FL", "Fixture Brawl"]);
const file = [header, row("12U 78-85", "Alpha Kid", "Beta Kid"), row("JV 106-113", "Older Kid", "Other Kid"),
  wrap(["11/8/2026", "JV 120-126", "Quarterfinal", "Bye Kid", "Club", "0-0", "BYE", "", "", "Pembroke Pines", "FL", "Fixture Brawl"]),
  row("14U 86-96", "Gamma Kid", "Delta Kid", "F", "3-0 0:22"), row("V 126", "Senior", "Senior Two")].join("\n");
const request = { source_file: "FixtureBrawl.csv", divisions: ["10U", "12U", "14U"] };

describe("results-table adapters", () => {
  it("keeps selected youth rows verbatim with original line numbers and counts every exclusion", () => {
    const out = adaptResults("flo", file, request);
    assert.equal(out.sourceRows, 5);
    assert.deepEqual(out.report.rows.map(r => [r.source_row, r.weight_class, r.season, r.event_date]),
      [[2, "12U 78-85", "2026–2027", "2026-11-08"], [5, "14U 86-96", "2026–2027", "2026-11-08"]]);
    assert.equal(out.report.rows[0].loser_team, "Trey?s, Club");
    assert.equal(out.report.rows[1].result, "3-0 0:22");
    assert.deepEqual(out.excluded, { division: { JV: 2, V: 1 }, byes: 1, total: 3 });
    assert.equal(adaptResults("trackwrestling", file, request).normalizedCsv, out.normalizedCsv);
  });

  it("fails closed on expectation mismatches, other layouts, unknown methods and shifted line numbers", () => {
    assert.throws(() => adaptResults("flo", file, { ...request, expect: { imported: 3 } }), /Expected imported=3/);
    assert.throws(() => adaptResults("flo", file.replace("Winning Wrestler", "Winner"), request), /Unsupported results layout/);
    assert.throws(() => adaptResults("flo", file.replace('"=""DEC"""', '"=""XYZ"""'), request), /Unreviewed win_type/);
    assert.throws(() => adaptResults("flo", file.replace("\n", "\n\n"), request), /source_row would not equal/);
    assert.throws(() => adaptResults("flo", file, { ...request, source_file: "a/b.csv" }), /provenance label/);
    assert.throws(() => adaptResults("usa_bracketing", file, request), /reviewed JSON/);
  });

  it("uses the August 1 season boundary of existing production rows", () => {
    assert.equal(seasonFor("2026-07-31"), "2025–2026");
    assert.equal(seasonFor("2026-08-01"), "2026–2027");
  });
});
