import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { IDENTITY_PLAN_SQL, applyOverrides, planDigest, planSummary, type PlanRow } from "../../src/lib/release/identity-plan";

/** Release pipeline safeguards from 20261112160000_agent_release_pipeline.sql, on every migration. */
let db: PGlite;
const P = (n: number) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const OLD_FILE = "Old.csv", NEW_FILE = "New.csv";
const MODEL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", MODEL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FINGERPRINT = `select encode(sha256(convert_to(string_agg(source_kind||chr(31)||source_id||chr(31)||
  encode(convert_to(recorded_name,'UTF8'),'hex')||chr(31)||coalesce(person_id::text,''),chr(10)
  order by source_kind collate "C",source_id collate "C"),'UTF8')),'hex') from public.source_identity_current_rows`;

async function personModel(id: string, ratedPeople: string[]) {
  const matches = (await db.query<{ n: number }>("select count(*)::int n from public.matches")).rows[0].n;
  await db.exec(`insert into public.rating_models (id, model_version, status, config, config_hash, input_fingerprint, as_of_date,
      match_cutoff, rating_period_policy, rating_period_days, uncertainty_k, provisional_rd, established_rd, recency_policy,
      matches_total, matches_rated, wrestlers_rated, identity_scheme, assignment_fingerprint)
    values ('${id}', 'glicko2-daily-dec08-person-identity-v1', 'building', '{}', '${id.replace(/-/g, "").padEnd(64, "0").slice(0, 64)}',
      '${"c".repeat(64)}', '2026-11-09', '2026-11-08', 'fixed_1d', 1, 1, 120, 80, 'glicko2_inactivity_rd_growth',
      ${matches}, ${ratedPeople.length / 2}, ${ratedPeople.length}, 'person_uuid', (${FINGERPRINT}))`);
  for (const [i, person] of ratedPeople.entries()) {
    const win = i % 2 === 0 ? 1 : 0;
    await db.exec(`insert into public.wrestler_model_ratings (model_id, athlete_key, person_id, athlete_name, rating, rating_deviation,
        volatility, conservative_score, rating_status, match_count, wins, losses, first_match_date, last_match_date)
      values ('${id}', '${person}', '${person}', 'Person ${i}', 1500, 200, 0.06, 1300, 'provisional', 1, ${win}, ${1 - win}, '2026-01-01', '2026-01-01');
      insert into public.wrestler_rating_history (model_id, athlete_key, person_id, period_end, rating, rating_deviation, volatility, match_count)
      values ('${id}', '${person}', '${person}', '2026-01-01', 1500, 200, 0.06, 1);`);
  }
  await db.exec(`update public.rating_models set status = 'candidate' where id = '${id}'`);
}

async function decisionBatch() {
  const d = (await db.query<{ id: string }>(`insert into public.identity_decisions (authority, disposition, source_checksum, rationale)
    values ('agent_inferred', 'same_person', 'fixture', 'fixture') returning id`)).rows[0].id;
  const b = (await db.query<{ id: string }>(`insert into public.identity_assignment_batches (decision_id) values ('${d}') returning id`)).rows[0].id;
  return { d, b };
}

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create schema extensions;
    create function extensions.digest(data text,kind text) returns bytea language sql immutable
      as $$ select sha256(convert_to(data,'UTF8')) $$;`);
  for (const file of readdirSync("supabase/migrations").filter(f => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join("supabase/migrations", file), "utf8"));
  }
  // History: "Known Kid" (one person, 3 bouts at ~80 lb), plus an opponent pool.
  await db.exec(`insert into public.wrestler_people (id, display_name) values
    ('${P(1)}', 'Known Kid'), ('${P(2)}', 'Opponent One'), ('${P(3)}', 'Opponent Two'), ('${P(4)}', 'Twin Name'), ('${P(5)}', 'Twin Name')`);
  const old = [["Known Kid", "Opponent One", "12U 78-82", "2026-09-01"], ["Known Kid", "Opponent Two", "12U 78-82", "2026-09-02"],
    ["Opponent One", "Known Kid", "12U 78-82", "2026-10-01"], ["Twin Name", "Opponent Two", "12U 78-82", "2026-10-02"],
    ["Opponent Two", "Twin Name", "12U 78-82", "2026-10-03"]];
  const people: Record<string, string[]> = { "Known Kid": [P(1)], "Opponent One": [P(2)], "Opponent Two": [P(3)], "Twin Name": [P(4), P(5)] };
  const { d, b } = await decisionBatch();
  const payload: unknown[] = [];
  for (const [i, [w, l, wc, date]] of old.entries()) {
    const id = (await db.query<{ id: string }>(`insert into public.matches (event_date, season, event_name, weight_class, winner_name, winner_team,
      loser_name, loser_team, result, win_type, source_file, source_row) values ($1, '2026–2027', 'Old Event', $2, $3, 'Club', $4, 'Club', '3-0', 'DEC', $5, $6) returning id`,
      [date, wc, w, l, OLD_FILE, i + 2])).rows[0].id;
    const twin = (name: string) => people[name].length > 1 ? people[name][i % 2] : people[name][0];
    payload.push({ source_kind: "match_winner", source_id: id, recorded_name: w, person_id: twin(w), decision_id: d, expected_revision: 0 },
      { source_kind: "match_loser", source_id: id, recorded_name: l, person_id: twin(l), decision_id: d, expected_revision: 0 });
  }
  await db.query(`select private.apply_identity_batch($1, $2::jsonb)`, [b, JSON.stringify(payload)]);
  await personModel(MODEL_A, [P(1), P(2), P(3), P(4)]);
  await db.exec(`select private.activate_rating_model('${MODEL_A}')`);
});
after(async () => { await db.close(); });

describe("agent release pipeline safeguards", () => {
  let plan: PlanRow[] = [];
  it("plans links, new people and holds with the conservative rule", async () => {
    const rows = [["Known Kid", "Brand New", "12U 80-85"], ["Known Kid", "Twin Name", "12U 80-85"], ["Known Kid", "Known Kid", "12U 80-85"],
      ["Brand New", "Opponent One", "12U 80-85"], ["Known Kid", "Opponent Two", "14U 120-126"]];
    for (const [i, [w, l, wc]] of rows.entries()) {
      await db.query(`insert into public.matches (event_date, season, event_name, weight_class, winner_name, winner_team, loser_name, loser_team,
        result, win_type, source_file, source_row) values ('2026-11-08', '2026–2027', 'New Event', $1, $2, 'Club', $3, 'Club', '3-0', 'DEC', $4, $5)`,
        [wc, w, l, NEW_FILE, i + 2]);
    }
    plan = ((await db.query(IDENTITY_PLAN_SQL, [[NEW_FILE]])).rows as PlanRow[]);
    const at = (row: number, kind: string) => plan.find(p => p.source_row === row && p.source_kind === kind)!;
    assert.equal(at(2, "match_winner").resolution, "link");
    assert.equal(at(2, "match_winner").identity_key, P(1));
    assert.equal(at(2, "match_loser").resolution, "new");
    assert.equal(at(5, "match_winner").identity_key, at(2, "match_loser").identity_key, "same unseen name and club is one new person");
    assert.equal(at(3, "match_loser").resolution, "held", "a name shared by two people is never guessed");
    assert.equal(at(4, "match_winner").resolution, "held", "both sides resolving to one person are held");
    assert.equal(at(4, "match_loser").resolution, "held");
    assert.equal(at(5, "match_loser").resolution, "link", "two compatible prior bouts are sufficient");
    assert.equal(at(6, "match_winner").resolution, "held", "no weight-compatible history is never linked");
    assert.equal(at(3, "match_winner").resolution, "link");
    assert.deepEqual(planSummary(plan), { sides: 10, link: 3, new: 2, held: 5, owner_hold: 0, owner_person: 0, new_people: 1 });
    const overridden = applyOverrides(plan, [{ source_row: 2, side: "winner", action: "hold" }]);
    assert.equal(overridden.find(p => p.source_row === 2 && p.source_kind === "match_winner")!.resolution, "owner_hold");
    assert.notEqual(planDigest(overridden), planDigest(plan));
    assert.equal(planDigest(plan.map(p => ({ ...p, source_id: "different-dry-run-uuid" }))), planDigest(plan), "digest ignores row UUIDs");
  });

  it("allows first assignments of new sources under an active person model but refuses changes", async () => {
    const { d, b } = await decisionBatch();
    const first = plan.map(p => ({ source_kind: p.source_kind, source_id: p.source_id, recorded_name: p.recorded_name,
      person_id: p.resolution === "link" ? p.identity_key : null, decision_id: d, expected_revision: 0 }));
    await db.query(`select private.apply_identity_batch($1, $2::jsonb)`, [b, JSON.stringify(first)]);
    const { d: d2, b: b2 } = await decisionBatch();
    const change = [{ ...first[0], person_id: null, decision_id: d2, expected_revision: 1 }];
    await assert.rejects(() => db.query(`select private.apply_identity_batch($1, $2::jsonb)`, [b2, JSON.stringify(change)]),
      /Archive active person model before changing existing identity assignments/);
  });

  it("keeps the previous person model as a guarded rollback after new results", async () => {
    await personModel(MODEL_B, [P(1), P(2), P(3), P(4)]);
    await db.exec(`select private.activate_rating_model('${MODEL_B}')`);
    await assert.rejects(() => db.exec(`select private.activate_rating_model('${MODEL_A}')`), /source match count is stale/,
      "ordinary activation still refuses a stale person model");
    await assert.rejects(() => db.exec(`select private.rollback_rating_model('${MODEL_A}', '${MODEL_A}')`), /not the sole active model/);
    await db.exec(`select private.rollback_rating_model('${MODEL_A}', '${MODEL_B}')`);
    const states = (await db.query<{ id: string; status: string }>(`select id, status from public.rating_models where id in ('${MODEL_A}','${MODEL_B}') order by id`)).rows;
    assert.deepEqual(states.map(s => s.status), ["active", "archived"]);
    assert.equal((await db.query<{ v: string | null }>(`select current_setting('matnotes.rollback_target', true) v`)).rows[0].v ?? "", "");
    await db.exec(`select private.rollback_rating_model('${MODEL_B}', '${MODEL_A}')`);
  });

  it("gives the CI role only the pipeline privileges and no plan approval", async () => {
    const q = async (sql: string) => (await db.query<{ v: boolean }>(sql)).rows[0].v;
    assert.equal(await q(`select rolcanlogin and rolbypassrls and not rolsuper and not rolcreaterole v from pg_roles where rolname = 'matnotes_release'`), true);
    assert.equal(await q(`select has_function_privilege('matnotes_release', 'private.rollback_rating_model(uuid,uuid)', 'execute') v`), true);
    assert.equal(await q(`select has_table_privilege('matnotes_release', 'public.matches', 'insert') v`), true);
    assert.equal(await q(`select has_table_privilege('matnotes_release', 'public.matches', 'update') or has_table_privilege('matnotes_release', 'public.matches', 'delete') v`), false);
    assert.equal(await q(`select has_column_privilege('matnotes_release', 'private.import_runs', 'approved_plan_sha256', 'update') v`), false);
    assert.equal(await q(`select has_function_privilege('anon', 'private.rollback_rating_model(uuid,uuid)', 'execute') v`), false);
    assert.equal(await q(`select has_table_privilege('anon', 'private.import_sources', 'select') v`), false);
  });

  it("rejects raw sources whose stored hash does not match their bytes", async () => {
    await assert.rejects(() => db.exec(`insert into private.import_sources (provider, original_filename, sha256, content)
      values ('flo', 'x.csv', '${"0".repeat(64)}', 'abc'::bytea)`), /import_source_content_hash/);
  });
});
