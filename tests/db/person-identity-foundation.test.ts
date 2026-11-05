import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationName = "20261105182000_person_club_views.sql";
let db: PGlite;
const count = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0].n;

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
  for (const file of readdirSync("supabase/migrations").filter(f => f.endsWith(".sql") && f <= migrationName).sort()) {
    await db.exec(readFileSync(path.join("supabase/migrations", file), "utf8"));
  }
});
after(async () => { await db.close(); });

describe("person identity foundation", () => {
  it("keeps the two bout sides independent, records revisions and restores an earlier assignment", async () => {
    const winner = "11111111-1111-4111-8111-111111111111";
    const loser = "22222222-2222-4222-8222-222222222222";
    const bout = "33333333-3333-4333-8333-333333333333";
    const decision = "44444444-4444-4444-8444-444444444444";
    const batch = "55555555-5555-4555-8555-555555555555";
    const revertDecision = "66666666-6666-4666-8666-666666666666";
    const revertBatch = "77777777-7777-4777-8777-777777777777";
    await db.exec(`insert into public.matches (id,event_date,season,event_name,weight_class,winner_name,loser_name,win_type)
      values ('${bout}','2025-01-01','2024-2025','Test','100','Same Name','Same Name','DEC');
      insert into public.wrestler_people (id,display_name) values
        ('${winner}','Same Name — one'),('${loser}','Same Name — two');
      insert into public.identity_decisions (id,authority,disposition,source_checksum,rationale) values
        ('${decision}','owner_confirmed','separate_people','fixture','Source-backed split'),
        ('${revertDecision}','administrative','rollback','fixture','Restore prior state');
      insert into public.identity_assignment_batches (id,decision_id) values ('${batch}','${decision}');
      insert into public.identity_assignment_batches (id,decision_id,reverts_batch_id)
        values ('${revertBatch}','${revertDecision}','${batch}');`);
    await db.query(`select private.assign_source_identity($1,'match_winner',$2,$3,0,'Same Name',$4)`, [batch, bout, winner, decision]);
    await db.query(`select private.assign_source_identity($1,'match_loser',$2,$3,0,'Same Name',$4)`, [batch, bout, loser, decision]);
    let current = (await db.query<{ source_kind: string; person_id: string }>(
      `select source_kind,person_id from public.source_identity_current where source_id=$1 order by source_kind`, [bout],
    )).rows;
    assert.deepEqual(current.map(row => row.person_id), [loser, winner]);
    await assert.rejects(
      () => db.query(`select private.assign_source_identity($1,'match_winner',$2,$3,0,'Same Name',$4)`, [revertBatch, bout, loser, revertDecision]),
      /Stale assignment revision/,
    );
    await assert.rejects(
      () => db.query(`select private.assign_source_identity($1,'match_winner',$2,null,1,'Different Name',$3)`, [revertBatch, bout, revertDecision]),
      /source name changed/,
    );
    await db.query(`select private.assign_source_identity($1,'match_winner',$2,null,1,'Same Name',$3)`, [revertBatch, bout, revertDecision]);
    current = (await db.query<{ source_kind: string; person_id: string }>(
      `select source_kind,person_id from public.source_identity_current where source_id=$1 order by source_kind`, [bout],
    )).rows;
    assert.deepEqual(current.map(row => row.person_id), [loser, null]);
    assert.equal((await db.query<{ n: number }>(
      `select count(*)::int n from public.source_identity_assignments where match_id=$1`, [bout],
    )).rows[0].n, 3);
    const source = (await db.query<{ winner_name: string; loser_name: string }>(
      `select winner_name,loser_name from public.matches where id=$1`, [bout],
    )).rows[0];
    assert.deepEqual(source, { winner_name: "Same Name", loser_name: "Same Name" });
    const personRows = (await db.query<{ winner_person_id: string | null; loser_person_id: string | null }>(
      `select winner_person_id,loser_person_id from public.person_matches where id=$1`, [bout],
    )).rows;
    assert.deepEqual(personRows, [{ winner_person_id: null, loser_person_id: loser }]);
    const cohort = (await db.query<{ athlete_key: string }>(
      `select athlete_key from public.person_cohort_current where athlete_key=$1`, [loser],
    )).rows;
    assert.deepEqual(cohort, [{ athlete_key: loser }]);
  });

  it("does not allow app role to write decisions or assignments", async () => {
    await db.exec("set role anon");
    try {
      await assert.rejects(() => db.exec(`insert into public.identity_decisions
        (authority,disposition,source_checksum,rationale) values
        ('agent_inferred','same_person','fixture','Unauthorized')`), /permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });

  it("applies a bounded batch atomically, retries exactly and rejects changed sources", async () => {
    const bout = "88888888-8888-4888-8888-888888888888";
    const decision = "99999999-9999-4999-8999-999999999999";
    const batch = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const person = "11111111-1111-4111-8111-111111111111";
    await db.exec(`insert into public.matches (id,event_date,season,event_name,weight_class,winner_name,loser_name,win_type)
      values ('${bout}','2025-01-01','2024-2025','Test','100','Recorded Winner','Recorded Loser','DEC');
      insert into public.identity_decisions (id,authority,disposition,source_checksum,rationale)
      values ('${decision}','agent_inferred','same_person','fixture','Shared club and opponent');
      insert into public.identity_assignment_batches (id,decision_id) values ('${batch}','${decision}');`);
    const payload = JSON.stringify([{ source_kind: "match_winner", source_id: bout,
      recorded_name: "Recorded Winner", person_id: person, decision_id: decision, expected_revision: 0 }]);
    const apply = () => db.query<{ n: number }>(`select private.apply_identity_batch($1,$2::jsonb) n`, [batch, payload]);
    assert.equal((await apply()).rows[0].n, 1);
    assert.equal((await apply()).rows[0].n, 1);
    assert.equal(await count(`select count(*) n from public.source_identity_assignments where match_id='${bout}'`), 1);
    const changed = JSON.stringify([{ source_kind: "match_loser", source_id: bout,
      recorded_name: "Wrong Loser", person_id: person, decision_id: decision, expected_revision: 0 }]);
    await assert.rejects(() => db.query(`select private.apply_identity_batch($1,$2::jsonb)`, [batch, changed]),
      /source record missing or changed/);
    assert.equal(await count(`select count(*) n from public.source_identity_assignments where match_id='${bout}'`), 1);
  });

  it("replays generated connector batches without changing an already applied assignment", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "identity-rollout-test-"));
    const bout = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const person = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const decision = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    try {
      await db.exec(`insert into public.matches (id,event_date,season,event_name,weight_class,winner_name,loser_name,win_type)
        values ('${bout}','2025-02-01','2024-2025','Test','100','Test Name','Opponent','DEC')`);
      writeFileSync(path.join(directory, "identity-417-assignment-plan.json"), JSON.stringify({
        sourceChecksum: "fixture", people: [{ id: person, displayName: "Test Name" }],
        decisions: [{ id: decision, authority: "administrative", disposition: "same_person",
          sourceChecksum: "fixture", evidenceHash: null, evidence: {}, rationale: "Fixture" }],
        assignments: [{ sourceKind: "match_winner", sourceId: bout, recordedName: "Test Name",
          personId: person, authority: "administrative", decisionId: decision }],
      }));
      writeFileSync(path.join(directory, "identity-417-rating-candidate.json"), JSON.stringify({
        model: { assignment_fingerprint: "f".repeat(64) },
      }));
      const generated = (phase: string) => execFileSync("node", ["--import", "tsx",
        "scripts/identity/rollout-sql.ts", directory, phase, "0"], { cwd: process.cwd(), encoding: "utf8" });
      await db.exec(generated("people"));
      await db.exec(generated("decisions"));
      await db.exec(generated("assignments"));
      await db.exec(generated("assignments"));
      assert.equal(await count(`select count(*) n from public.source_identity_assignments where match_id='${bout}'`), 1);
      assert.equal((await db.query<{ person_id: string }>(
        `select person_id from public.source_identity_current where source_kind='match_winner' and source_id='${bout}'`)).rows[0].person_id, person);
      await db.exec(generated("rollback-decision"));
      await db.exec(generated("rollback"));
      assert.equal((await db.query<{ person_id: string | null }>(
        `select person_id from public.source_identity_current where source_kind='match_winner' and source_id='${bout}'`)).rows[0].person_id, null);
      assert.equal(await count(`select count(*) n from public.source_identity_assignments where match_id='${bout}'`), 2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
