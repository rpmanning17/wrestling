import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyMethod, parseAgeGroup, parseBracketWeight, parseScore, scoringMargin } from "../../src/lib/rating/outcomes";
import { identityKey } from "../../src/lib/rating/prepare";
import { prepared, raw } from "./helpers";

describe("method classification", () => {
  const cases: Array<[string, string]> = [
    ["DEC", "decision"], ["Dec", "decision"], ["SV-1", "decision"], ["TB-1", "decision"], ["UTB", "decision"], ["DEC OT", "decision"],
    ["MD", "major_decision"], ["Major Decision", "major_decision"],
    ["TF", "tech_fall"], ["Tech Fall", "tech_fall"], ["TF-1.5", "tech_fall"],
    ["F", "fall"], ["Fall", "fall"], ["PIN", "fall"], ["Fall 1:12", "fall"],
    ["FOR", "forfeit"], ["Forfeit", "forfeit"],
    ["M FOR", "medical_forfeit"], ["MFFL", "medical_forfeit"],
    ["DEF", "default"], ["INJ DEF", "default"],
    ["DQ", "disqualification"], ["NC", "no_contest"], ["BYE", "bye"],
    ["WEIRD", "unknown"], ["", "unknown"],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => assert.equal(classifyMethod(input), expected));
  }

  it("falls back to the first token of the result only when win_type is blank", () => {
    assert.equal(classifyMethod("", "Fall 0:45"), "fall");
    assert.equal(classifyMethod("WEIRD", "Fall 0:45"), "unknown");
  });
});

describe("score and weight parsing", () => {
  it("reads decision scores and ignores overtime labels, clocks and invalid orders", () => {
    assert.deepEqual(parseScore("Dec 7-3"), { winner: 7, loser: 3 });
    assert.deepEqual(parseScore("SV-1 5-3"), { winner: 5, loser: 3 });
    assert.equal(parseScore("Fall 1:12"), null);
    assert.equal(parseScore("SV-1"), null);
    assert.equal(parseScore("3-7"), null); // winner cannot trail
    assert.equal(parseScore(""), null);
  });
  it("margins exist only for scored methods", () => {
    assert.equal(scoringMargin("decision", "6-2"), 4);
    assert.equal(scoringMargin("major_decision", "14-4"), 10);
    assert.equal(scoringMargin("fall", "6-2"), null);
  });
  it("takes the last number in a weight label, like the evidence refresh does", () => {
    assert.equal(parseBracketWeight("12U 70"), 70);
    assert.equal(parseBracketWeight("Open 67.5 lbs"), 67.5);
    assert.equal(parseBracketWeight("HWT"), null);
    assert.equal(parseAgeGroup("12U 70"), "12U");
    assert.equal(parseAgeGroup("Open 70"), null);
  });
});

describe("match preparation", () => {
  it("rates only legitimately contested bouts and reports every exclusion", () => {
    const rows = [
      raw({ winner_name: "A One", loser_name: "B Two", win_type: "DEC" }),
      raw({ winner_name: "A One", loser_name: "C Three", win_type: "F", result: "Fall 1:10" }),
      raw({ winner_name: "A One", loser_name: "D Four", win_type: "FOR" }),
      raw({ winner_name: "A One", loser_name: "E Five", win_type: "M FOR" }),
      raw({ winner_name: "A One", loser_name: "BYE", win_type: "DEC" }),
      raw({ winner_name: "A One", loser_name: "F Six", win_type: "DQ" }),
      raw({ winner_name: "A One", loser_name: "G Seven", win_type: "ZZZ" }),
      raw({ winner_name: "A One", loser_name: "A One", win_type: "DEC" }),
      raw({ winner_name: "A One", loser_name: "H Eight", event_date: "not a date" }),
    ];
    const { matches, report } = prepared(rows);
    assert.equal(matches.length, 2);
    assert.equal(report.total, 9);
    assert.equal(report.rated, 2);
    assert.equal(report.excluded, 7);
    assert.equal(report.byReason.non_contested_method, 3); // FOR, M FOR, DQ
    assert.equal(report.byReason.placeholder_opponent, 1);
    assert.equal(report.byReason.unrecognized_method, 1);
    assert.equal(report.byReason.self_match, 1);
    assert.equal(report.byReason.invalid_date, 1);
    assert.deepEqual(report.unrecognizedWinTypes, { ZZZ: 1 });
  });

  it("drops exact duplicate rows but keeps a genuine rematch in another round", () => {
    const base = { winner_name: "A One", loser_name: "B Two", result: "Dec 4-1" };
    const { matches, report } = prepared([
      raw({ ...base, round: "Quarter" }),
      raw({ ...base, round: "Quarter" }),
      raw({ ...base, round: "Final" }),
    ]);
    assert.equal(matches.length, 2);
    assert.equal(report.byReason.duplicate_row, 1);
  });

  it("does not modify the source rows (original labels stay recoverable)", () => {
    const rows = [raw({ winner_name: "Grayson Piaseck", loser_name: "B Two" })];
    const snapshot = JSON.stringify(rows);
    prepared(rows, {}, [{ alias_key: "grayson piaseck", canonical_key: "grayson piasecki", canonical_name: "Grayson Piasecki" }]);
    assert.equal(JSON.stringify(rows), snapshot);
  });

  it("identity keys match the database's lower(trim(name)) convention", () => {
    assert.equal(identityKey("  Grayson Piasecki "), "grayson piasecki");
  });

  it("groups repeat events by name and splits occurrences separated by long gaps", () => {
    const { matches } = prepared([
      raw({ event_name: "Fall Brawl", event_date: "2024-10-05", winner_name: "A", loser_name: "B" }),
      raw({ event_name: "Fall Brawl", event_date: "2024-10-06", winner_name: "C", loser_name: "D" }),
      raw({ event_name: "Fall Brawl", event_date: "2026-10-04", winner_name: "A", loser_name: "D" }),
    ]);
    const ids = new Set(matches.map((m) => m.eventId));
    assert.equal(ids.size, 2);
    const first = matches.find((m) => m.date === "2024-10-06")!;
    assert.equal(first.eventStartDay, matches.find((m) => m.date === "2024-10-05")!.day);
  });
});
