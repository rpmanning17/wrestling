import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { after, before, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationName = "20261105150000_club_alias_catchup.sql";
const migrationPath = path.join("supabase", "migrations", migrationName);
const rollbackPath = path.join("supabase", "rollbacks", "20261105_club_alias_catchup.sql");
let db: PGlite;
const count = async (sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0].n);

const bout = (winner: string, winnerTeam: string, loser: string, loserTeam: string) =>
  `insert into public.matches(event_date,season,event_name,weight_class,round,winner_name,winner_team,loser_name,loser_team,result,win_type)
   values ('2026-10-24','2026-2027','Catch-up fixture','90','Round 1',
     '${winner}','${winnerTeam}','${loser}','${loserTeam}','5-3','DEC')`;

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create schema extensions;
    create function extensions.digest(data text,kind text) returns bytea language sql immutable
      as $$ select sha256(convert_to(data,'UTF8')) $$;`);
  for (const file of readdirSync("supabase/migrations").filter(f => f.endsWith(".sql") && f < migrationName).sort()) {
    await db.exec(readFileSync(path.join("supabase/migrations", file), "utf8"));
  }
  await db.exec([
    bout("Scorpion One", "FL Scorpions Wrestling Club", "Opponent One", "Kongkrete Red"),
    bout("Scorpion Two", "Florida Scorpions", "Opponent Two", "Kongkrete Grey"),
    bout("River One", "Riversprings", "Opponent Three", "River Springs"),
    bout("Broward One", "South Broward", "Opponent Four", "South Broward High School"),
    bout("Trained One", "Well Trained", "Opponent Five", "Well Trained Wrestling Club"),
  ].join(";\n"));
});
after(async () => { await db.close(); });

it("consolidates only reviewed club identities, preserves source bouts and rolls back", async () => {
  const migration = readFileSync(migrationPath, "utf8");
  const rollback = readFileSync(rollbackPath, "utf8");
  const checksum = (await db.query("select md5(string_agg(to_jsonb(m)::text,'' order by id)) value from public.matches m")).rows;
  assert.equal(await count("select count(*) n from public.club_aliases"), 390);
  assert.equal(await count("select count(*) n from public.club_rankings_current where season='ALL'"), 10);

  await db.exec(migration);
  assert.equal(await count("select count(*) n from public.club_aliases"), 417);
  assert.equal(await count("select count(*) n from private.club_alias_catchup_20261105_inserted"), 27);
  assert.equal(await count("select count(*) n from public.club_rankings_current where season='ALL'"), 5);
  const groups = (await db.query<{ club_key: string; bouts: number; wrestlers: number }>(`
    select club_key,bouts,wrestlers from public.club_rankings_current
    where season='ALL' order by club_key`)).rows;
  assert.deepEqual(groups, [
    { club_key: "florida-scorpions", bouts: 2, wrestlers: 2 },
    { club_key: "kongkrete-wrestling-academy", bouts: 2, wrestlers: 2 },
    { club_key: "river-springs", bouts: 2, wrestlers: 2 },
    { club_key: "south-broward-high-school", bouts: 2, wrestlers: 2 },
    { club_key: "well-trained", bouts: 2, wrestlers: 2 },
  ]);
  assert.deepEqual((await db.query("select md5(string_agg(to_jsonb(m)::text,'' order by id)) value from public.matches m")).rows, checksum);
  assert.equal((await db.query<{ allowed: boolean }>("select has_table_privilege('service_role','private.club_alias_catchup_20261105_inserted','select') allowed")).rows[0].allowed, false);

  await assert.rejects(() => db.exec(migration), /already exists|club_alias_catchup_20261105_inserted/i);
  await db.exec("rollback");
  await db.exec("update public.club_aliases set canonical_name='Changed' where alias_key='kongkrete red'");
  await assert.rejects(() => db.exec(rollback), /requires reconciliation/);
  await db.exec("rollback");
  await db.exec("update public.club_aliases set canonical_name='KONGKRETE WRESTLING ACADEMY' where alias_key='kongkrete red'");
  await db.exec(rollback);
  assert.equal(await count("select count(*) n from public.club_aliases"), 390);
  assert.equal(await count("select count(*) n from public.club_rankings_current where season='ALL'"), 10);
  assert.deepEqual((await db.query("select md5(string_agg(to_jsonb(m)::text,'' order by id)) value from public.matches m")).rows, checksum);
});
