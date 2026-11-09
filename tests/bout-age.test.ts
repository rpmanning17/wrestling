import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ageGroupForBout, type BoutAgeEvidence } from "../src/lib/bout-age";

const bout = {
  id: "bout-1",
  event_date: "2026-10-24",
  event_name: "Juggernaut Winter Springs Qualifier",
  weight_class: "80",
  winner_name: "Waylon Jones",
  loser_name: "Carson Givens",
};
const anchor: BoutAgeEvidence = {
  source_match_id: "other-bout",
  event_date: bout.event_date,
  event_name: bout.event_name,
  athlete_name: "Waylon Jones",
  age_group: "12U",
  bracket_weight_lbs: "80.00",
  confidence_label: "strong",
};

describe("recent bout age groups", () => {
  it("reads the age directly from a USA Bracketing class", () => {
    assert.equal(ageGroupForBout({ ...bout, weight_class: "12U - 80" }, []), "12U");
  });
  it("uses a single compatible bracket evidence for a previously unlabelled match", () => {
    assert.equal(ageGroupForBout(bout, [anchor]), "12U");
  });
  it("never substitutes evidence from a different weight or event", () => {
    assert.equal(ageGroupForBout(bout, [{ ...anchor, bracket_weight_lbs: 90 }]), null);
    assert.equal(ageGroupForBout(bout, [{ ...anchor, event_date: "2026-10-10" }]), null);
  });
  it("does not silently choose between conflicting age groups", () => {
    assert.equal(ageGroupForBout(bout, [anchor, { ...anchor, age_group: "14U" }]), null);
  });
  it("accepts direct source-match evidence with a verified age group", () => {
    assert.equal(ageGroupForBout(bout, [{ ...anchor, source_match_id: bout.id }]), "12U");
  });
});
