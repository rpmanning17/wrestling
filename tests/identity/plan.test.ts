import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IdentitySnapshot } from "../../src/lib/identity/audit";
import { buildIdentityPlan, type ConfirmedSplit } from "../../src/lib/identity/plan";
import type { CheckedLink } from "../../src/lib/identity/revalidate";

const snapshot: IdentitySnapshot = {
  source_checksum: "fixture-checksum", aliases: [], clubs: [],
  matches: [
    ["m1", "2025-01-01", "Open 1", "City", "FL", "60", "", "Same Name", "Club A", "Rival", "Club C", "Dec 1-0", "DEC", "file.csv", 2],
    ["m2", "2025-01-01", "Open 2", "City", "FL", "180", "", "Other", "Club D", "Same Name", "Club B", "Dec 2-0", "DEC", "file.csv", 3],
    ["m3", "2025-01-08", "Open 3", "City", "FL", "60", "", "Same Name", "Club A", "Rival", "Club C", "Dec 3-0", "DEC", "file.csv", 4],
    ["m4", "2025-01-15", "Open 4", "City", "FL", "60", "", "Variant", "Club A", "Rival", "Club C", "Dec 3-0", "DEC", "file.csv", 5],
  ],
  entries: [{ id: 1, athlete_name: "Same Name", team: "Club B", event_date: "2025-01-01", event_name: "Open 2" }],
  observations: [{ id: 2, athlete_name: "Variant", team: "Club A", event_date: "2025-01-15", event_name: "Open 4", identity_resolution: "ambiguous" }],
};
const split: ConfirmedSplit = { kind: "confirmed_distinct_people", normalizedName: "same name", groups: [
  { personId: "11111111-1111-4111-8111-111111111111", label: "one",
    sourceAppearances: [{ matchId: "m1", side: "winner", recordedName: "Same Name", sourceFile: "file.csv", sourceRow: 2 },
      { matchId: "m3", side: "winner", recordedName: "Same Name", sourceFile: "file.csv", sourceRow: 4 }] },
  { personId: "22222222-2222-4222-8222-222222222222", label: "two",
    sourceAppearances: [{ matchId: "m2", side: "loser", recordedName: "Same Name", sourceFile: "file.csv", sourceRow: 3 }] },
] };
const link: CheckedLink = { keys: ["Variant", "Rival"], authority: "agent_inferred", status: "held",
  reason: "fixture", sharedClubs: 0, sharedOpponents: 0 };

describe("offline identity assignment plan", () => {
  it("keeps same-name sides separate and ambiguous context unattributed", () => {
    const before = structuredClone(snapshot);
    const plan = buildIdentityPlan(snapshot, [link], [split]);
    const same = plan.assignments.filter(a => a.recordedName === "Same Name" && a.sourceKind.startsWith("match"));
    assert.deepEqual(new Set(same.map(a => a.personId)), new Set(split.groups.map(g => g.personId)));
    assert.equal(plan.assignments.find(a => a.sourceKind === "tournament_entry")?.personId, null);
    assert.equal(plan.assignments.find(a => a.sourceKind === "tournament_observation")?.personId, null);
    assert.deepEqual(snapshot, before);
    assert.deepEqual(buildIdentityPlan(snapshot, [link], [split]), plan);
  });
  it("rejects a stale owner source coordinate", () => {
    const changed = structuredClone(split);
    changed.groups[0].sourceAppearances[0].sourceRow = 999;
    assert.throws(() => buildIdentityPlan(snapshot, [], [changed]), /Confirmed appearance changed/);
  });
  it("selects display spelling by distinct events, then appearances", () => {
    const simple: IdentitySnapshot = {
      ...snapshot, entries: [], observations: [], matches: [
        ["a", "2025-01-01", "Open", "City", "FL", "60", "", "Long Name", "A", "Rival", "B", "", "DEC", null, null],
        ["b", "2025-01-01", "Open", "City", "FL", "60", "", "Long Name", "A", "Other", "B", "", "DEC", null, null],
        ["c", "2025-01-08", "Second", "City", "FL", "60", "", "Short Name", "A", "Other", "B", "", "DEC", null, null],
        ["d", "2025-01-15", "Third", "City", "FL", "60", "", "Short Name", "A", "Other", "B", "", "DEC", null, null],
      ],
    };
    const accepted: CheckedLink = { keys: ["Long Name", "Short Name"], authority: "agent_inferred",
      status: "accepted", reason: "", sharedClubs: 1, sharedOpponents: 1 };
    const plan = buildIdentityPlan(simple, [accepted], []);
    assert.equal(plan.people.find(p => p.variants.includes("Long Name"))?.displayName, "Short Name");
  });
});
