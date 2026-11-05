import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { guardedMatchImportSql, parseCsv, validateNormalizedMatchCsv, type MatchImportRow } from "../../src/lib/imports/matches-csv";

const header = "index,event_date,season,event_name,city,state,weight_class,round,winner_name,winner_team,loser_name,loser_team,result,win_type,source_file,source_row";
const example = "0,2025-01-05,2024–2025,Yulee IOF,Yulee,FL,55,Round 1,Jax Perry,Creeks Wrestling,Lincoln Sliwa,Fernandina Beach Wrestling Clu,4-2 1:57,F,2025 Results.zip/YuleeIOF (1).csv,2";
const data = header + "\n" + example + "\n";
const parse = (txt = data) => validateNormalizedMatchCsv(txt);
const sample = (): MatchImportRow => parse().rows[0];

describe("normalized match import safety", () => {
  it("matches actual normalized 2025 source columns without changing result or provenance", () => {
    const x = parse();
    assert.equal(x.rows.length, 1);
    assert.equal(x.rows[0].source_row, 2);
    assert.equal(x.rows[0].source_file, "2025 Results.zip/YuleeIOF (1).csv");
    assert.equal(x.rows[0].win_type, "F");
    assert.equal(x.rows[0].result, "4-2 1:57");
    assert.equal(x.rows[0].season, "2024–2025");
    assert.equal(x.firstDate, "2025-01-05");
  });
  it("handles BOM, Windows CRLF, escaped quotes, embedded commas, and newlines", () => {
    const rows = parseCsv('\ufeffsource,notes\r\n"Flo, 2025","O\'Brien ""wins""\nagain"\r\n');
    assert.deepEqual(rows, [["source","notes"], ["Flo, 2025", 'O\'Brien "wins"\nagain']]);
  });
  it("fails closed on bad header, bad date, empty winner and repeated source row", () => {
    assert.throws(() => parse("winner,loser\na,b"), /Unsupported CSV columns|Missing/);
    assert.throws(() => parse(data.replace("2025-01-05", "2025-02-30")), /invalid event_date/);
    assert.throws(() => parse(data.replace("Jax Perry", "")), /winner_name is required/);
    assert.throws(() => parse(header + "\n" + example + "\n" + example + "\n"), /repeated source_file\/source_row/);
    assert.throws(() => parseCsv('a,b\n"unterminated'), /Unclosed/);
  });
  it("retains possible genuine same-event rematches and opposite winners", () => {
    const copy = example.replace("Jax Perry,Creeks Wrestling,Lincoln Sliwa", "Lincoln Sliwa,Creeks Wrestling,Jax Perry").replace(/,2$/, ",3");
    const x = parse(header + "\n" + example + "\n" + copy + "\n");
    assert.equal(x.rows.length, 2);
    assert.equal(x.repeatedPairGroups, 1);
    assert.equal(x.oppositeWinnerGroups, 1);
  });
  it("reports unusual source methods for review instead of guessing", () => {
    const x = parse(data.replace(",F,2025 Results.zip", ",NEWCODE,2025 Results.zip"));
    assert.deepEqual(x.unrecognizedMethods, ["NEWCODE"]);
  });
  it("rejects an empty, oversized or repeated-key SQL batch", () => {
    assert.throws(() => guardedMatchImportSql([]), /nonempty/);
    assert.throws(() => guardedMatchImportSql(Array.from({ length: 251 }, () => sample())), /at most/);
    assert.throws(() => guardedMatchImportSql([sample(),sample()]), /Repeated batch/);
  });
  it("inserts, retries exactly, rejects changed fields and allows real rematches", async () => {
    const db = new PGlite();
    try {
      await db.exec(`create table public.matches (
        id serial primary key, event_date date, season text, event_name text,
        city text, state text, weight_class text, round text,
        winner_name text, winner_team text, loser_name text, loser_team text,
        result text, win_type text, source_file text, source_row integer,
        unique(source_file,source_row)
      )`);
      const first = sample();
      const rematch: MatchImportRow = {
        ...first, source_row: 3, winner_name: first.loser_name,
        loser_name: first.winner_name, result: "2-5 2:17",
      };
      const safeQuote: MatchImportRow = {
        ...first, source_row: 4, winner_name: "O'Hara'); DROP TABLE matches; --",
        result: "10-2",
      };
      const sql = guardedMatchImportSql([first,rematch,safeQuote]);
      await db.exec(sql);
      await db.exec(sql); // exact replay
      const c = (await db.query<{ n: number }>("select count(*)::int as n from matches")).rows[0];
      assert.equal(c.n, 3);
      const countBefore = (await db.query<{ n: number }>("select count(*)::int as n from matches")).rows[0].n;
      await assert.rejects(db.exec(guardedMatchImportSql([
        { ...first, result: "REVISED" },
        { ...rematch, source_row: 5 },
      ])), /Match import conflicting existing source row/);
      const countAfter = (await db.query<{ n: number }>("select count(*)::int as n from matches")).rows[0].n;
      assert.equal(countAfter, countBefore);
      const stillThere = (await db.query<{ winner_name: string }>("select winner_name from matches where source_row=4")).rows[0];
      assert.equal(stillThere.winner_name, safeQuote.winner_name);
    } finally { await db.close(); }
  });
});
