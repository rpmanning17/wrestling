import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commonOpponents, headToHead, type Bout } from "../../src/lib/rating/relations";

const bout = (date: string, winner: string, loser: string): Bout => ({ date, winnerKey: winner.toLowerCase(), loserKey: loser.toLowerCase(), winnerName: winner, loserName: loser });
const names = new Map([["alex", "Alex"], ["ben", "Ben"], ["cal", "Cal"], ["dan", "Dan"]]);

describe("head-to-head", () => {
  it("counts each meeting from the subject's point of view and reports the latest date", () => {
    const bouts = [bout("2026-01-10", "Alex", "Ben"), bout("2026-03-10", "Ben", "Alex"), bout("2026-04-10", "Alex", "Ben"), bout("2026-04-11", "Cal", "Dan")];
    const [result] = headToHead(bouts, "alex", ["ben", "cal"], names);
    assert.deepEqual({ w: result.wins, l: result.losses, last: result.lastDate }, { w: 2, l: 1, last: "2026-04-10" });
    assert.equal(headToHead(bouts, "alex", ["cal"], names).length, 0);
  });
});

describe("common opponents", () => {
  it("lists shared opponents with both wrestlers' records and excludes direct meetings", () => {
    const bouts = [bout("2026-01-01", "Alex", "Cal"), bout("2026-02-01", "Dan", "Alex"), bout("2026-01-02", "Cal", "Ben"), bout("2026-02-02", "Dan", "Ben"), bout("2026-03-01", "Alex", "Ben")];
    const [summary] = commonOpponents(bouts, "alex", ["ben"], names);
    assert.equal(summary.shared.length, 2);
    const cal = summary.shared.find((s) => s.opponentKey === "cal")!;
    assert.deepEqual(cal.mine, { wins: 1, losses: 0 });
    assert.deepEqual(cal.theirs, { wins: 0, losses: 1 });
    const dan = summary.shared.find((s) => s.opponentKey === "dan")!;
    assert.deepEqual(dan.mine, { wins: 0, losses: 1 });
    assert.deepEqual(dan.theirs, { wins: 0, losses: 1 });
    assert.ok(!summary.shared.some((s) => s.opponentKey === "ben"));
  });
  it("returns nothing when wrestlers share no opponents", () => {
    assert.deepEqual(commonOpponents([bout("2026-01-01", "Alex", "Cal"), bout("2026-01-01", "Ben", "Dan")], "alex", ["ben"], names), []);
  });
});
