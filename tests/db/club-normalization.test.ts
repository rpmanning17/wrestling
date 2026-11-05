import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { aliasKey, buildMigration, buildRollback, ledger, manifest, migrationName, validateManifest } from "../../scripts/clubs/generate-normalization";

const rows = validateManifest(manifest);
const migration = buildMigration(manifest);
let db: PGlite;
const count = async (sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0].n);
const snapshot = async () => (await db.query(`select jsonb_agg(to_jsonb(a) order by alias_key) data from public.club_aliases a`)).rows;
const rollbackError = async (sql: string, pattern: RegExp) => {
  await assert.rejects(() => db.exec(sql), pattern);
  await db.exec("rollback");
};

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
});
after(async () => { await db.close(); });

describe("approved finite club normalization", () => {
  it("reproduces the committed migration and preserves all four literal punctuation keys", () => {
    // Windows checkouts may use CRLF; compare SQL content without changing applied migrations.
    const lf = (text: string) => text.replaceAll("\r\n", "\n");
    assert.equal(lf(readFileSync(path.join("supabase/migrations", migrationName), "utf8")), lf(migration));
    assert.equal(lf(readFileSync("supabase/rollbacks/20261104_approved_club_normalization.sql", "utf8")), lf(buildRollback()));
    for (const name of ["Gateway (Fort Myers)", "Gateway Fort Myers", "Sunset sniper.", "Sunset sniper"]) {
      assert.ok(rows.some(r => r.alias_key === aliasKey(name)));
    }
    assert.notEqual(aliasKey("Gateway (Fort Myers)"), aliasKey("Gateway Fort Myers"));
    assert.notEqual(aliasKey("Sunset sniper."), aliasKey("Sunset sniper"));
  });

  it("rejects colliding manifest keys rather than silently dropping mappings", () => {
    const bad = structuredClone(manifest);
    bad.groups[0].members.push(bad.groups[0].members[0]);
    assert.throws(() => validateManifest(bad), /Duplicate alias key/);
  });

  it("connects every explicitly approved cross-group pair without merging Spartan with LHP", () => {
    const pairs = [
      ["Black Flag Wrestling Academy", "Black Flag Wreslting Academy"],
      ["Charlotte Hammerheads", "Hammerheads"], ["Camden Outsiders", "The Outsiders"],
      ["Camden County A", "Camden Outsiders"], ["Tampa Bay Tigers", "Tampa Bay Tiger Wrestling"],
      ["Sons of Thunder", "SOT/DOZ"], ["Wakulla", "Wakulla Middle"],
      ["Cowboy Wrestling Club", "Cowboys Wrestling Club"], ["Longwood Wrestling Club", "Longwood Wrestlinv"],
      ["NorthSide WC", "North Side Wrestling Club"], ["Triton", "Tritons"],
      ["MOCCO WRESTLING", "ATT/Mocco Wrestling"], ["Jayhawk", "JayHawks"],
      ["Tomahawk Wrestling Club", "Tomohawk wrestling club"], ["Beebe Wrestling Club", "Beebe Trained"],
      ["Gateway Wrestling Club", "Gateway Fort Myers"], ["Florida Elite", "Elite wrestling club"],
      ["Caveman-Phoenix", "Caveman"], ["Caveman/Florida Phoenix", "Caveman Wrestling"],
      ["Caldwell Wrestling Academy", "Caldwell Combat"], ["Spartan Wrestling Club", "Spartan RTC"],
      ["Team Barracuda`s", "Team Barracuda"],
    ];
    for (const [a,b] of pairs) {
      const first = rows.find(r => r.alias_key === aliasKey(a));
      const second = rows.find(r => r.alias_key === aliasKey(b));
      assert.ok(first && second, `${a} and ${b} must both be mapped`);
      assert.equal(first.club_key, second.club_key, `${a} and ${b}`);
    }
    assert.ok(rows.filter(r => r.club_key === "spartan-rtc").every(r => r.relationship === "program"));
    assert.ok(!rows.some(r => r.club_key === "lake-highland-prep"));
  });

  it("throws on an existing canonical conflict, with no partial insertion", async () => {
    const baseline = await snapshot();
    await db.exec("update public.club_aliases set club_key='conflict' where alias_key='spartan rtc'");
    await rollbackError(migration, /conflicts with an existing canonical mapping/);
    assert.equal(await count("select count(*) n from public.club_aliases"), 13);
    await db.exec("update public.club_aliases set club_key='spartan-rtc' where alias_key='spartan rtc'");
    assert.deepEqual(await snapshot(), baseline);
  });

  it("applies every mapping, protects existing keys/relationships, and rolls back precisely", async () => {
    const baseline = await snapshot();
    await db.exec(migration);
    assert.equal(await count("select count(*) n from public.club_aliases"), 390);
    assert.equal(await count(`select count(*) n from ${ledger}`), 377);
    for (const role of ["anon", "authenticated", "service_role"]) {
      const privilege = (await db.query<{ allowed: boolean }>(`select has_table_privilege('${role}','${ledger}','select') allowed`)).rows[0];
      assert.equal(privilege.allowed, false, `${role} must not read rollback records`);
    }
    const actual = (await db.query<{ alias_key: string; club_key: string; canonical_name: string; relationship: string }>(
      "select alias_key,club_key,canonical_name,relationship from public.club_aliases")).rows;
    for (const expected of rows) {
      const row = actual.find(a => a.alias_key === expected.alias_key);
      assert.deepEqual(row, { alias_key: expected.alias_key, club_key: expected.club_key,
        canonical_name: expected.canonical_name, relationship: expected.relationship });
    }
    assert.equal(actual.find(a => a.alias_key === 'camden county a')?.relationship, 'team');
    assert.equal(actual.find(a => a.alias_key === 'spartan rtc')?.relationship, 'program');
    assert.equal(actual.find(a => a.alias_key === 'spartan wrestling club')?.club_key, 'spartan-rtc');
    assert.equal(actual.find(a => a.alias_key === 'longwood wrestlinv')?.club_key, 'longwood-wrestling-club');
    for (const label of ['I Own Florida','Jefferson Dragons','Panthers Legacy','Pensacola']) {
      assert.ok(!actual.some(a => a.alias_key === aliasKey(label)));
    }
    await db.exec(buildRollback());
    assert.deepEqual(await snapshot(), baseline);
  });

  it("refuses rollback when an inserted row was subsequently changed", async () => {
    await db.exec(migration);
    const key = rows.find(r => !r.existing)!.alias_key.replace(/'/g, "''");
    await db.exec(`update public.club_aliases set canonical_name='Changed' where alias_key='${key}'`);
    await rollbackError(buildRollback(), /rollback requires reconciliation/);
    assert.equal(await count(`select count(*) n from ${ledger}`), 377);
    await db.exec(`update public.club_aliases a set canonical_name=i.canonical_name from ${ledger} i where a.alias_key=i.alias_key`);
    await db.exec(buildRollback());
  });

  it("projects 1182 to 952 club identities while retaining every recorded bout and season", async () => {
    // Only reviewed labels are needed; unrelated identities use synthetic names.
    const ranked = rows.filter(r => r.source_club_key !== null);
    assert.equal(ranked.length, 378);
    assert.equal(manifest.groups.length, 148);
    const labels = [...ranked.map(r => r.source_name), ...Array.from({ length: 804 }, (_, i) => `Unrelated fixture ${i}`)];
    const values = labels.map((label, i) => `('2026-10-24','2026-2027','Fixture','12U 70','${i}',
      'Shared athlete','${label.replace(/'/g, "''")}','Opponent ${i}','', '5-3','DEC')`).join(",");
    await db.exec(`insert into public.matches(event_date,season,event_name,weight_class,round,winner_name,winner_team,loser_name,loser_team,result,win_type) values ${values}`);
    const raw = (await db.query("select md5(string_agg(to_jsonb(m)::text,'' order by id)) checksum from public.matches m")).rows;
    assert.equal(await count("select count(*) n from public.club_rankings_current where season='ALL'"), 1182);
    await db.exec(migration);
    assert.equal(await count("select count(*) n from public.club_rankings_current where season='ALL'"), 952);
    assert.equal(await count("select count(*) n from public.club_roster_current where season='ALL'"), 952);
    assert.equal(await count("select sum(bouts) n from public.club_roster_current where season='2026-2027'"), 1182);
    assert.deepEqual((await db.query("select md5(string_agg(to_jsonb(m)::text,'' order by id)) checksum from public.matches m")).rows, raw);
    await db.exec(buildRollback());
    assert.equal(await count("select count(*) n from public.club_rankings_current where season='ALL'"), 1182);
  });
});
