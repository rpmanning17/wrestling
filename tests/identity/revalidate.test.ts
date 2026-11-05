import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { revalidateLinks, type ProposedLink } from "../../src/lib/identity/revalidate";
import type { AuditMatch, IdentitySnapshot } from "../../src/lib/identity/audit";

let next = 0;
const match = (winner: string, loser: string, winnerTeam = "A", loserTeam = "A",
  date = "2025-01-01", event = "Open", state = "FL", weight = "100"): AuditMatch =>
  [String(++next), date, event, "City", state, weight, "", winner, winnerTeam, loser, loserTeam, "Dec 1-0", "DEC", null, null];
const snap = (matches: AuditMatch[]): IdentitySnapshot => ({
  matches, aliases: [], clubs: [], entries: [], observations: [],
});
const link = (a: string, b: string): ProposedLink => ({ keys: [a, b], authority: "agent_inferred" });

describe("whole-group identity evidence", () => {
  it("accepts shared club and opponent, including a nickname", () => {
    const source = snap([match("Thomas", "Rival"), match("Tommy", "Rival")]);
    assert.equal(revalidateLinks(source, [link("Thomas", "Tommy")]).checked[0].status, "accepted");
  });
  it("rejects direct opponents even with enough shared evidence", () => {
    const source = snap([match("Thomas", "Rival"), match("Tommy", "Rival"), match("Thomas", "Tommy")]);
    assert.match(revalidateLinks(source, [link("Thomas", "Tommy")]).checked[0].reason, /direct opponents/);
  });
  it("rejects a transitive bridge when group members directly met", () => {
    const source = snap([
      match("An", "Rival 1"), match("An", "Rival 2"),
      match("Bn", "Rival 1"), match("Bn", "Rival 2"),
      match("Cn", "Rival 1"), match("Cn", "Rival 2"),
      match("An", "Cn"),
    ]);
    const result = revalidateLinks(source, [link("An", "Bn"), link("Bn", "Cn")]);
    assert.equal(result.checked[0].status, "accepted");
    assert.equal(result.checked[1].status, "held");
    assert.match(result.checked[1].reason, /direct opponents/);
  });
  it("keeps owner-separated names apart and rejects conflicting same-day contexts", () => {
    const direct = snap([match("One", "Rival"), match("Two", "Rival")]);
    assert.match(revalidateLinks(direct, [link("One", "Two")], [["One", "Two"]]).checked[0].reason,
      /confirmed separation/);
    const contexts = snap([
      match("One", "Rival", "A", "A", "2025-01-01", "Open 1", "FL", "60"),
      match("Two", "Rival", "B", "B", "2025-01-01", "Open 2", "GA", "180"),
      match("One", "Rival 2"), match("Two", "Rival 2"),
    ]);
    assert.match(revalidateLinks(contexts, [link("One", "Two")]).checked[0].reason,
      /contradictory context/);
  });
});
