import assert from "node:assert/strict";
import test from "node:test";
import { likelihoodScore } from "../../src/lib/scoring";

test("Waylon screenshot gap is 100 likelihood points when the selected weight drifts from 80 to 75", (t) => {
  // Controlled reproduction of the reported numbers, not a claim about the screenshots' original timestamp.
  t.mock.method(Date, "now", () => Date.parse("2026-11-04T13:00:00Z"));
  const input = {
    wins: 29, losses: 26, decisiveWins: 0, latestDate: "2026-10-24", bestPlacement: null,
    latestAgeGroup: "12U", latestWeight: 80, orlandoAppearances: 6,
    recentAppearances: 3, tournamentCount: 15, confirmedEvidence: false,
  };
  assert.equal(likelihoodScore(input), 838.35);
  assert.equal(likelihoodScore({ ...input, latestWeight: 75 }), 938.35);
});
