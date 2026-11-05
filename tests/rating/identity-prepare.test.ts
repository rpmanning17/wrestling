import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateRatings } from "../../src/lib/rating/engine";
import { prepareMatches, type MatchIdentityAssignment } from "../../src/lib/rating/prepare";
import { raw } from "./helpers";
import { resolveConfig } from "../../src/lib/rating/config";

describe("person-aware rating preparation", () => {
  const config = resolveConfig();
  it("splits identical recorded names into independent ratings", () => {
    const bout = raw({ winner_name: "Aaron Jones", loser_name: "Aaron Jones" });
    const assignments: MatchIdentityAssignment[] = [
      { matchId: bout.id, side: "winner", personId: "person-a" },
      { matchId: bout.id, side: "loser", personId: "person-b" },
    ];
    const { matches, report } = prepareMatches([bout], [], config, assignments);
    assert.equal(report.rated, 1);
    assert.equal(report.byReason.self_match, 0);
    assert.equal(matches[0].winnerKey, "person-a");
    assert.equal(matches[0].loserKey, "person-b");
    const result = calculateRatings(matches, config, { asOfDate: "2026-01-10" });
    assert.deepEqual(result.players.map(player => player.key).sort(), ["person-a", "person-b"]);
  });

  it("combines an assigned spelling variant and excludes an unknown side", () => {
    const first = raw({ winner_name: "Thomas Leonard", loser_name: "Opponent A", event_date: "2026-01-10" });
    const second = raw({ winner_name: "Tommy Leonard", loser_name: "Opponent B", event_date: "2026-01-17" });
    const unknown = raw({ winner_name: "Unknown Identity", loser_name: "Opponent A", event_date: "2026-01-24" });
    const assignments: MatchIdentityAssignment[] = [
      { matchId: first.id, side: "winner", personId: "thomas" },
      { matchId: first.id, side: "loser", personId: "a" },
      { matchId: second.id, side: "winner", personId: "thomas" },
      { matchId: second.id, side: "loser", personId: "b" },
      { matchId: unknown.id, side: "loser", personId: "a" },
    ];
    const { matches, report } = prepareMatches([first, second, unknown], [], config, assignments);
    assert.equal(report.rated, 2);
    assert.equal(report.byReason.unresolved_identity, 1);
    const result = calculateRatings(matches, config, { asOfDate: "2026-01-24" });
    assert.equal(result.players.find(player => player.key === "thomas")?.games, 2);
  });
});
