import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Executes supabase/audits/match_outcome_audit.sql against the real migrated schema so the read-only
// audit cannot silently break, and checks the queries that matter for the first rating run.
const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const AUDIT = readFileSync(path.join(ROOT, "supabase", "audits", "match_outcome_audit.sql"), "utf8");

let db: PGlite;

const match = (date: string, weight: string, round: string, winner: string, wTeam: string, loser: string, lTeam: string, result: string, winType: string) =>
  `insert into public.matches (event_date, season, event_name, weight_class, round, winner_name, winner_team, loser_name, loser_team, result, win_type)
   values ('${date}', '2026', 'Fall Open', '${weight}', '${round}', '${winner}', '${wTeam}', '${loser}', '${lTeam}', '${result}', '${winType}')`;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create schema extensions;
    create function extensions.digest(data text, kind text) returns bytea language sql immutable
      as $$ select sha256(convert_to(data, 'UTF8')) $$;
  `);
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS, file), "utf8"));
  }
  await db.exec([
    match("2026-10-24", "12U 70", "R1", "A One", "Club A", "B Two", "Club B", "Dec 7-3", "DEC"),
    match("2026-10-24", "12U 70", "R1", "A One", "Club A", "B Two", "Club B", "Dec 7-3", "DEC"), // exact copy
    match("2026-10-24", "12U 70", "QF", "B Two", "Club B", "A One", "Club A", "Dec 4-2", "DEC"), // swapped pair...
    match("2026-10-24", "12U 70", "QF", "A One", "Club A", "B Two", "Club B", "Dec 4-2", "DEC"), // ...with this
    match("2026-10-24", "100 (14U)", "R1", "C Three", "Club C", "D Four", "Other Club", "Fall 1:12", "F"),
    match("2026-10-24", "HWT", "R1", "D Four", "Club D", "E Five", "Club E", "", "FOR"),
  ].join(";\n"));
});

after(async () => { await db.close(); });

describe("match_outcome_audit.sql", () => {
  it("runs every query without error and writes nothing", async () => {
    const before = Number((await db.query<{ n: number }>("select count(*)::int as n from public.matches")).rows[0].n);
    const results = await db.exec(AUDIT);
    assert.equal(results.length, 9); // queries 0-8
    const afterCount = Number((await db.query<{ n: number }>("select count(*)::int as n from public.matches")).rows[0].n);
    assert.equal(afterCount, before);
  });

  it("reports duplicates, swapped records, multi-club names and unparseable weights", async () => {
    const [, , , , duplicates, clubs, , weights, swapped] = await db.exec(AUDIT);
    assert.ok(duplicates.rows.some((row) => Number((row as { copies: number }).copies) === 2));
    assert.equal(swapped.rows.length, 1);
    assert.deepEqual(clubs.rows.map((row) => (row as { athlete_key: string }).athlete_key), ["d four"]);
    const labels = weights.rows.map((row) => (row as { weight_class: string }).weight_class).sort();
    assert.deepEqual(labels, ["100 (14U)", "HWT"]);
  });
});
