import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ratingFreshnessStatus } from "../../src/lib/rating/freshness";

const active = { matches_total: 67736, as_of_date: "2026-11-04", match_cutoff: "2026-10-31" };

describe("rating freshness: source-count signal, not a false guarantee", () => {
  it("does not display a stale warning when counts match", () => {
    assert.deepEqual(ratingFreshnessStatus(active, 67736), { kind: "count_matches" });
  });
  it("flags new imports even if their event dates are older than the model cutoff", () => {
    assert.deepEqual(ratingFreshnessStatus(active, 67800), {
      kind: "changed", sourceCount: 67800, ratedCount: 67736, asOfDate: "2026-11-04",
    });
  });
  it("flags deleted source rows too", () => {
    assert.equal(ratingFreshnessStatus(active, 67735).kind, "changed");
  });
  it("warns about uncalculated sources and tolerates an empty initial database", () => {
    assert.deepEqual(ratingFreshnessStatus(null, 25), { kind: "no_model", sourceCount: 25 });
    assert.equal(ratingFreshnessStatus(null, 0).kind, "count_matches");
  });
  it("never converts unknown or erroneous source counts into a false clean state", () => {
    assert.equal(ratingFreshnessStatus(active, null).kind, "unavailable");
    assert.equal(ratingFreshnessStatus(active, 67736, true).kind, "unavailable");
    assert.equal(ratingFreshnessStatus({ ...active, matches_total: NaN }, 0).kind, "unavailable");
  });
});
