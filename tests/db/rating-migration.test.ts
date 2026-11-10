import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

/**
 * Applies every migration, in order, to an in-process Postgres (PGlite) with Supabase-style roles, then
 * exercises the new tables, views, activation function and row-level security.
 *
 * The one stand-in: the production personal-app check compares a SHA-256 of a secret header to a fixed
 * hash, which cannot be reproduced here. After migrating, the function is replaced by an equivalent that
 * compares the header to "test-key", so the policies that CALL it are tested exactly as deployed.
 */
const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");
const HEADERS_ON = `select set_config('request.headers', '{"x-personal-app-key":"test-key"}', false)`;
const HEADERS_OFF = `select set_config('request.headers', '{}', false)`;

let db: PGlite;

const count = async (sql: string) => Number(((await db.query<{ n: string | number }>(sql)).rows[0]).n);
const rejects = async (sql: string, pattern: RegExp) => {
  await assert.rejects(() => db.exec(sql), pattern);
  await db.exec("rollback").catch(() => undefined);
};

const modelInsert = (id: string, hash: string, status = "candidate", cutoff = "2026-10-24") => `
  insert into public.rating_models
    (id, model_version, status, config, config_hash, input_fingerprint, as_of_date, match_cutoff,
     rating_period_policy, rating_period_days, uncertainty_k, provisional_rd, established_rd,
     recency_policy, matches_total, matches_rated, wrestlers_rated)
  values ('${id}', 'glicko2-baseline', '${status}', '{}', '${hash.repeat(64).slice(0, 64)}', '${"b".repeat(64)}',
     '2026-11-03', ${cutoff ? `'${cutoff}'` : "null"}, 'fixed_7d', 7, 1, 120, 80, 'glicko2_inactivity_rd_growth', 100, 90, 4)`;

const ratingInsert = (model: string, key: string, name: string, rating: number, rd: number, wins = 6, losses = 2) => `
  insert into public.wrestler_model_ratings
    (model_id, athlete_key, athlete_name, rating, rating_deviation, volatility, conservative_score, rating_status,
     match_count, wins, losses, first_match_date, last_match_date)
  values ('${model}', '${key}', '${name}', ${rating}, ${rd}, 0.06, ${rating - rd}, '${rd >= 120 ? "provisional" : rd >= 80 ? "developing" : "established"}',
     ${wins + losses}, ${wins}, ${losses}, '2026-01-10', '2026-10-24')`;

const evidenceInsert = (key: string, name: string, weight: number, n: number) => `
  insert into public.wrestler_evidence
    (athlete_key, athlete_name, team, event_date, event_name, evidence_type, age_group,
     division_birth_year_start, division_birth_year_end, bracket_weight_lbs, weight_basis,
     confidence_score, confidence_label, reason, source_key)
  values ('${key}', '${name}', 'Club', '2026-10-24', 'Fall Open', 'confirmed_entry', '12U', 2014, 2015, ${weight},
     'reported_bracket', 100, 'confirmed', 'test', 'test-${n}')`;

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to postgres;
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
  await db.exec(`
    create or replace function private.personal_app_request_is_valid() returns boolean language sql stable
    as $$ select coalesce(current_setting('request.headers', true)::jsonb ->> 'x-personal-app-key', '') = 'test-key' $$;
    grant usage on schema private to anon;
  `);

  // A 12U 70-79 cohort with three wrestlers and a 12U 60-69 cohort with one; "e" has a rating but no evidence.
  await db.exec([
    evidenceInsert("a one", "A One", 70, 1), evidenceInsert("b two", "B Two", 72, 2),
    evidenceInsert("c three", "C Three", 75, 3), evidenceInsert("d four", "D Four", 62, 4),
    modelInsert(M1, "a"),
    ratingInsert(M1, "a one", "A One", 1700, 60), ratingInsert(M1, "b two", "B Two", 1750, 190, 3, 1),
    ratingInsert(M1, "c three", "C Three", 1500, 70), ratingInsert(M1, "d four", "D Four", 1610, 90),
    ratingInsert(M1, "e five", "E Five", 1450, 80),
  ].join(";\n"));
});

after(async () => { await db.close(); });

describe("expanded-source cohort read optimization", () => {
  it("age-scoped standings preserve every rating, rank and tier within each complete age population", async () => {
    assert.equal(await count(`select count(*) n from pg_indexes where schemaname='public'
      and tablename='wrestler_model_ratings' and indexname='person_club_rating_covering_idx'`),1);
    await db.exec("begin");
    try {
      await db.exec(`select private.activate_rating_model('${M1}')`);
      const all = (await db.query<{age_group:string}>("select * from public.wrestler_strength_current order by athlete_key")).rows;
      for (const age of [6,8,10,12,14,16,18]) {
        const scoped = (await db.query("select * from public.current_wrestler_strength($1) order by athlete_key", [age])).rows;
        assert.deepEqual(scoped, all.filter(row => row.age_group === age+"U"));
      }
      await db.query(HEADERS_OFF);
      await db.exec("set local role anon");
      assert.equal(await count("select count(*) n from public.current_wrestler_strength(12)"),0);
      await db.exec("reset role");
    } finally { await db.exec("rollback"); }
  });
  it("preserves all club records, roster and schedule metrics when resolving repeated literal team labels once", async () => {
    await db.exec("begin");
    try {
      await db.exec(`select private.activate_rating_model('${M1}');
        insert into public.matches(event_date,season,event_name,weight_class,winner_name,loser_name,winner_team,loser_team,win_type)
        select date '2026-10-24','2026','Repeated Club Open','75','A One','B Two',
          case n%2 when 0 then 'Sunset sniper.' else 'Sunset sniper' end,'Other Raw Club','DEC'
        from generate_series(1,120) n`);
      const snapshot = async () => (await db.query(`select to_jsonb(c)||jsonb_build_object(
        'schedule_expected_win_pct',round(schedule_expected_win_pct,12)) as row
        from public.club_rankings_current c order by season,club_key`)).rows;
      const optimized = await snapshot();
      const previous = readFileSync(path.join(MIGRATIONS, "20261104145400_bound_filtered_club_schedule.sql"), "utf8");
      await db.exec(previous.slice(previous.indexOf("create or replace view"), previous.lastIndexOf("commit;")));
      assert.deepEqual(await snapshot(), optimized);
      await db.exec(readFileSync(path.join(MIGRATIONS, "20261104202147_bound_expanded_club_reads.sql"), "utf8")
        .replace(/^begin;\s*/, "").replace(/commit;\s*$/, ""));
      assert.deepEqual(await snapshot(), optimized);
      const options=(await db.query<{reloptions:string[]}>(
        "select reloptions from pg_class where oid='public.club_rankings_current'::regclass")).rows[0].reloptions;
      assert.ok(options.includes("security_invoker=true"));
      await db.query(HEADERS_OFF);
      await db.exec("set local role anon");
      assert.equal(await count("select count(*) n from public.club_rankings_current"),0);
      await db.exec("reset role");
    } finally { await db.exec("rollback"); }
  });
  it("preserves every classification and standing field with repeated/unparseable labels and raw bouts", async () => {
    await db.exec("begin");
    try {
      await db.exec(`insert into public.matches(event_date,season,event_name,weight_class,winner_name,loser_name,win_type)
        select date '2026-10-24'+(n%2),'2026','Repeated  Duals',
          case n%4 when 0 then 'Unknown' when 1 then 'HWT' when 2 then '12U 75' else '14U 80' end,
          'Repeated Athlete','Repeated Opponent','DEC' from generate_series(1,120) n`);
      const snapshot = async () => ({
        cohorts: (await db.query("select * from public.wrestler_cohort_current order by athlete_key")).rows,
        standings: (await db.query("select * from public.wrestler_strength_current order by athlete_key")).rows,
      });
      const optimized = await snapshot();
      const previous = readFileSync(path.join(MIGRATIONS, "20261104143500_cohort_tiers_and_rating_clarity.sql"), "utf8");
      await db.exec(previous.slice(previous.indexOf("create or replace view public.wrestler_cohort_current"), previous.indexOf("-- Midpoint")));
      assert.deepEqual(await snapshot(), optimized);
      await db.exec(readFileSync(path.join(MIGRATIONS, "20261104201302_bound_expanded_cohort_reads.sql"), "utf8")
        .replace(/^begin;\s*/, "").replace(/commit;\s*$/, ""));
      assert.deepEqual(await snapshot(), optimized);
      const rawCount = await count("select count(*) n from public.matches");
      await db.exec(readFileSync(path.join(MIGRATIONS, "20261109183704_bound_cohort_input_duplicates.sql"), "utf8")
        .replace(/^begin;\s*/, "").replace(/commit;\s*$/, ""));
      assert.deepEqual(await snapshot(), optimized);
      assert.equal(await count("select count(*) n from public.matches"), rawCount);
      const options = (await db.query<{ reloptions: string[] }>(
        "select reloptions from pg_class where oid='public.wrestler_cohort_current'::regclass")).rows[0].reloptions;
      assert.ok(options.includes("security_invoker=true"));
      await db.query(HEADERS_OFF);
      await db.exec("set local role anon");
      assert.equal(await count("select count(*) n from public.wrestler_cohort_current"), 0);
      await db.exec("reset role");
    } finally { await db.exec("rollback"); }
  });
});

describe("migrations apply cleanly in order", () => {
  it("creates the new tables, views and activation function and leaves the legacy view in place", async () => {
    const tables = (await db.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema='public'`)).rows.map((r) => r.table_name);
    for (const name of ["matches", "wrestler_evidence", "wrestler_ratings", "rating_models", "wrestler_model_ratings", "wrestler_rating_history", "rating_backtest_runs", "wrestler_rating_current", "wrestler_strength_current", "wrestler_cohort_current", "wrestler_people", "identity_decisions", "identity_assignment_batches", "source_identity_assignments", "source_identity_current_rows", "person_matches", "person_cohort_current", "person_strength_current", "person_club_roster_current", "person_club_rankings_current"]) {
      assert.ok(tables.includes(name), `${name} missing`);
    }
    assert.equal(await count("select count(*) as n from public.wrestler_ratings"), 0); // legacy view still queries
    assert.equal((await db.query<{ identity_scheme: string }>(`select identity_scheme from public.rating_models where id='${M1}'`)).rows[0].identity_scheme, "name_key");
    assert.equal(await count("select count(*) as n from public.person_rating_current"), 0);
  });
});

describe("activation and the cohort view", () => {
  it("returns nothing until a model is active, so the app keeps using the legacy ranking", async () => {
    assert.equal(await count("select count(*) as n from public.wrestler_strength_current"), 0);
    assert.equal(await count("select count(*) as n from public.wrestler_rating_current"), 0);
  });

  it("ranks a cohort by CONSERVATIVE score and scales it 0-1000", async () => {
    await db.exec(`select private.activate_rating_model('${M1}')`);
    const rows = (await db.query<{ athlete_key: string; cohort_rank: number; cohort_size: number; strength_score: string; rating_status: string }>(`
      select athlete_key, cohort_rank, cohort_size, strength_score, rating_status
      from public.wrestler_strength_current where age_group='12U' and weight_bucket=70 order by cohort_rank`)).rows;
    // Conservative scores: a one 1640, c three 1430, b two 1560 -> order a, b, c even though b has the highest raw rating.
    assert.deepEqual(rows.map((r) => r.athlete_key), ["a one", "b two", "c three"]);
    assert.equal(rows[0].cohort_size, 3);
    assert.equal(Number(rows[0].strength_score), 1000);
    assert.equal(Number(rows[2].strength_score), 0);
    assert.ok(Number(rows[1].strength_score) > 0 && Number(rows[1].strength_score) < 1000);
    assert.equal(rows[1].rating_status, "provisional");
  });

  it("scales each cohort independently and omits wrestlers without cohort evidence", async () => {
    const lone = (await db.query<{ strength_score: string; cohort_size: number }>(`select strength_score, cohort_size from public.wrestler_strength_current where athlete_key='d four'`)).rows[0];
    assert.equal(Number(lone.strength_score), 1000);
    assert.equal(lone.cohort_size, 1);
    assert.equal(await count("select count(*) as n from public.wrestler_strength_current where athlete_key='e five'"), 0);
    assert.equal(await count("select count(*) as n from public.wrestler_rating_current where athlete_key='e five'"), 1);
  });

  it("allows exactly one active model and archives the previous one on activation", async () => {
    await db.exec([modelInsert(M2, "c", "candidate", "2026-10-31"), ratingInsert(M2, "a one", "A One", 1400, 60)].join(";\n"));
    await rejects(`update public.rating_models set status='active' where id='${M2}'`, /rating_models_one_active_idx|duplicate key/);
    await db.exec(`select private.activate_rating_model('${M2}')`);
    const statuses = (await db.query<{ id: string; status: string }>("select id, status from public.rating_models order by id")).rows;
    assert.deepEqual(statuses.map((s) => s.status), ["archived", "active"]);
    // Prior model results remain intact for comparison.
    assert.equal(await count(`select count(*) as n from public.wrestler_model_ratings where model_id='${M1}'`), 5);
    assert.equal(Number((await db.query<{ rating: string }>("select rating from public.wrestler_rating_current where athlete_key='a one'")).rows[0].rating), 1400);
  });

  it("refuses to activate a model that does not exist or is still building", async () => {
    await rejects(`select private.activate_rating_model('99999999-9999-4999-8999-999999999999')`, /does not exist/);
    await db.exec(modelInsert("33333333-3333-4333-8333-333333333333", "d", "building", "2026-10-30"));
    await rejects(`select private.activate_rating_model('33333333-3333-4333-8333-333333333333')`, /has not finished building/);
  });
});

describe("integrity rules", () => {
  it("recognises an identical calculation, including runs with no match cutoff", async () => {
    await rejects(modelInsert("44444444-4444-4444-8444-444444444444", "a"), /rating_models_identical_run_idx|duplicate key/); // same hash/fingerprint/dates as M1
    await db.exec(`delete from public.rating_models where id='33333333-3333-4333-8333-333333333333'`);
    await db.exec(modelInsert("55555555-5555-4555-8555-555555555555", "e", "candidate", ""));
    await rejects(modelInsert("66666666-6666-4666-8666-666666666666", "e", "candidate", ""), /rating_models_identical_run_idx|duplicate key/);
  });

  it("rejects ratings whose record does not add up or whose RD is not positive", async () => {
    await rejects(`insert into public.wrestler_model_ratings (model_id, athlete_key, athlete_name, rating, rating_deviation, volatility, conservative_score, rating_status, match_count, wins, losses, first_match_date, last_match_date)
      values ('${M1}', 'bad one', 'Bad One', 1500, 100, 0.06, 1400, 'developing', 5, 2, 2, '2026-01-01', '2026-01-02')`, /wrestler_model_ratings_record|check/);
    await rejects(`insert into public.wrestler_model_ratings (model_id, athlete_key, athlete_name, rating, rating_deviation, volatility, conservative_score, rating_status, match_count, wins, losses, first_match_date, last_match_date)
      values ('${M1}', 'bad two', 'Bad Two', 1500, 0, 0.06, 1500, 'developing', 4, 2, 2, '2026-01-01', '2026-01-02')`, /check/);
  });

  it("deleting a model removes its ratings and history but never touches matches or other models", async () => {
    await db.exec(`insert into public.wrestler_rating_history (model_id, athlete_key, period_end, rating, rating_deviation, volatility, match_count) values ('${M1}', 'a one', '2026-01-15', 1600, 100, 0.06, 3)`);
    await db.exec(`delete from public.rating_models where id='${M1}'`);
    assert.equal(await count(`select count(*) as n from public.wrestler_model_ratings where model_id='${M1}'`), 0);
    assert.equal(await count(`select count(*) as n from public.wrestler_rating_history where model_id='${M1}'`), 0);
    assert.equal(await count(`select count(*) as n from public.wrestler_model_ratings where model_id='${M2}'`), 1);
  });
});

describe("access control", () => {
  const tables = ["rating_models", "wrestler_model_ratings", "wrestler_rating_history", "rating_backtest_runs"];

  it("hides every new table and view from requests without the personal-app key", async () => {
    await db.exec("reset role");
    await db.query(HEADERS_OFF);
    await db.exec("set role anon");
    for (const name of [...tables, "wrestler_rating_current", "wrestler_strength_current", "wrestler_cohort_current"]) {
      assert.equal(await count(`select count(*) as n from public.${name}`), 0, name);
    }
    await db.exec("reset role");
  });

  it("lets a request with the key read ratings through the views", async () => {
    await db.query(HEADERS_ON);
    await db.exec("set role anon");
    assert.ok(await count("select count(*) as n from public.rating_models") >= 1);
    assert.ok(await count("select count(*) as n from public.wrestler_rating_current") >= 1);
    await db.exec("reset role");
  });

  it("never lets the anonymous role write, even with the key", async () => {
    await db.query(HEADERS_ON);
    await db.exec("set role anon");
    for (const name of tables) {
      await assert.rejects(() => db.exec(`delete from public.${name}`), /permission denied/, name);
      await assert.rejects(() => db.exec(`update public.${name} set ${name === "rating_models" ? "notes" : name === "rating_backtest_runs" ? "notes" : "athlete_key"} = 'x'`), /permission denied/, name);
    }
    await assert.rejects(() => db.exec(modelInsert("77777777-7777-4777-8777-777777777777", "f")), /permission denied/);
    await assert.rejects(() => db.exec(`select private.activate_rating_model('${M2}')`), /permission denied/);
    await db.exec("reset role");
  });

  it("lets only the service role write (bypassing row-level security)", async () => {
    await db.query(HEADERS_OFF);
    await db.exec("set role service_role");
    await db.exec(modelInsert("88888888-8888-4888-8888-888888888888", "g", "candidate", "2026-09-01"));
    await db.exec("reset role");
    assert.equal(await count("select count(*) as n from public.rating_models where id='88888888-8888-4888-8888-888888888888'"), 1);
  });

  it("revokes direct access for the authenticated role", async () => {
    await db.exec("set role authenticated");
    await assert.rejects(() => db.exec("select count(*) from public.rating_models"), /permission denied/);
    await db.exec("reset role");
  });
});

describe("authoritative three-event classification", () => {
  const seed = async (date: string, event: string, weight: number, age = "12U", source = "evidence", weighIn: number | null = null) => {
    if (source === "entry") {
      await db.query(`insert into tournament_entries (athlete_name,event_date,event_name,division_label,age_group,
        division_birth_year_start,division_birth_year_end,bracket_weight_lbs,weigh_in_lbs,experience_division,source_file,source_key)
        values ('Cohort Test',$1,$2,'Division',$3,2014,2015,$4,$5,'open','cohort-test',$6)`,
      [date,event,age,weight,weighIn,`${date}-${event}-${weight}-${age}`]);
    } else {
      await db.query(`insert into wrestler_evidence (athlete_key,athlete_name,event_date,event_name,evidence_type,
        age_group,division_birth_year_start,division_birth_year_end,bracket_weight_lbs,weight_basis,
        confidence_score,confidence_label,reason,source_key)
        values ('cohort test','Cohort Test',$1,$2,'inferred_same_bout',$3,2014,2015,$4,'match_class',90,'strong','test',$5)`,
      [date,event,age,weight,`${date}-${event}-${weight}-${age}`]);
    }
  };
  const cohort = async () => (await db.query<{age_group:string; bracket_weight_lbs:string; weight_bucket:number}>(
    "select * from wrestler_cohort_current where athlete_key='cohort test'" )).rows[0];
  const isolated = async (run: () => Promise<void>) => {
    await db.exec("begin");
    try { await run(); } finally { await db.exec("rollback"); }
  };

  it("uses exactly three events, newest wins a 50/30/20 tie, and repeated event evidence cannot add votes", () => isolated(async () => {
    await seed("2026-10-24","Latest",80);
    await seed("2026-10-17","Second",75);
    await seed("2026-10-10","Third",75);
    await seed("2026-10-03","Ignored",75);
    await db.exec(`insert into wrestler_evidence (athlete_key,athlete_name,event_date,event_name,evidence_type,age_group,
      division_birth_year_start,division_birth_year_end,bracket_weight_lbs,weight_basis,confidence_score,confidence_label,reason,source_key)
      select athlete_key,athlete_name,event_date,event_name,evidence_type,age_group,division_birth_year_start,division_birth_year_end,
      bracket_weight_lbs,weight_basis,confidence_score,confidence_label,reason,source_key||'-repeat-'||n
      from wrestler_evidence cross join generate_series(1,8) n where athlete_key='cohort test' and event_name='Second'`);
    assert.equal(Number((await cohort()).bracket_weight_lbs),80);
  }));

  it("evaluates cross-age and changing weight independently with source priority", () => isolated(async () => {
    await seed("2026-10-24","Latest",80,"14U","entry");
    await seed("2026-10-24","Latest",80,"12U","entry");
    await seed("2026-10-24","Latest",65,"10U");
    await seed("2026-10-17","Second",75,"12U","entry");
    await seed("2026-10-10","Third",80,"12U","entry");
    const row=await cohort();
    assert.equal(row.age_group,"12U");
    assert.equal(Number(row.bracket_weight_lbs),80);
  }));

  it("prefers verified weigh-ins to bracket labels without rewriting the bracket", () => isolated(async () => {
    await seed("2026-10-24","Latest",85,"12U","entry",74.5);
    assert.equal(Number((await cohort()).bracket_weight_lbs),74.5);
    assert.equal(Number((await db.query<{bracket_weight_lbs:string}>("select bracket_weight_lbs from tournament_entries where athlete_name='Cohort Test'")).rows[0].bracket_weight_lbs),85);
  }));

  it("halves dual event influence, preserving tournament age and weight", () => isolated(async () => {
    await seed("2026-10-24","State Duals",90,"14U");
    await seed("2026-10-17","Second",75,"12U");
    await seed("2026-10-10","Third",75,"12U");
    assert.equal((await cohort()).age_group,"12U");
    assert.equal(Number((await cohort()).bracket_weight_lbs),75);
  }));

  it("counts consecutive dates of a normalized multi-day event once and separates later editions", () => isolated(async () => {
    await seed("2026-10-24"," State   Open ",80);
    await seed("2026-10-25","state open",80);
    await seed("2026-10-17","Second",75);
    await seed("2026-10-10","state open",75);
    assert.equal(Number((await cohort()).bracket_weight_lbs),80);
  }));

  it("splits conflicting same-source labels once each, independent of row count or insertion order", () => isolated(async () => {
    await seed("2026-10-24","Latest",80,"14U");
    await seed("2026-10-24","Latest",75,"12U");
    await seed("2026-10-17","Second",75,"12U");
    assert.equal((await cohort()).age_group,"12U");
    assert.equal(Number((await cohort()).bracket_weight_lbs),75);
  }));

  it("regresses Waylon's 75 versus 80–89 mismatch: one current cohort, unchanged global rating", () => isolated(async () => {
    await seed("2026-10-24","Juggernaut Winter Springs Qualifier",80);
    await seed("2026-10-10","Juggernaut Orlando Qualifier",80);
    await seed("2026-08-29","Lyman Juggernaut 2026",75);
    await db.exec(ratingInsert(M2,"cohort test","Cohort Test",1514,122));
    const rows=(await db.query<{weight_band:string; bracket_weight_lbs:string; rating:string; strength_score:string}>(
      "select * from wrestler_strength_current where athlete_key='cohort test'")).rows;
    assert.equal(rows.length,1);
    assert.equal(rows[0].weight_band,"80–89 lb");
    assert.equal(Number(rows[0].bracket_weight_lbs),80);
    assert.equal(Number(rows[0].rating),1514);
    assert.equal(Number(rows[0].strength_score),1000); // solitary fixture; historical screenshot scores aren't current expectations
  }));

  it("keeps missing age independent of known weight and never revives evidence older than three events", () => isolated(async () => {
    await seed("2026-08-01","Old",75);
    await db.exec(`insert into matches (event_date,season,event_name,weight_class,winner_name,loser_name,win_type)
      values ('2026-10-24','2026','Latest','80','Cohort Test','Opponent','DEC'),
      ('2026-10-17','2026','Second','80','Cohort Test','Opponent','DEC'),
      ('2026-10-10','2026','Third','HWT','Cohort Test','Opponent','DEC')`);
    assert.equal((await cohort()).age_group,null);
    assert.equal(Number((await cohort()).bracket_weight_lbs),80);
    assert.equal(await count("select count(*) n from wrestler_strength_current where athlete_key='cohort test'"),0);
  }));
});

describe("population decile Cohort Tiers", () => {
  const isolated = async (run: () => Promise<void>) => {
    await db.exec("begin");
    try { await run(); } finally { await db.exec("rollback"); }
  };
  const seedPopulation = async (size: number, same = false) => {
    const statements = Array.from({length:size},(_,i) => {
      const name=`Tier ${i.toString().padStart(5,"0")}`;
      return [evidenceInsert(name.toLowerCase(),name,150,100000+i),
        ratingInsert(M2,name.toLowerCase(),name,same ? 1800 : 2500-i,100)];
    }).flat();
    await db.exec(statements.join(";\n"));
  };
  const tiers = async () => (await db.query<{cohort_tier:number|null;n:number}>(
    "select cohort_tier,count(*)::int n from wrestler_strength_current where weight_bucket=150 group by cohort_tier order by cohort_tier")).rows;

  it("assigns exactly two wrestlers to each decile at the minimum population of 20", () => isolated(async () => {
    await seedPopulation(20);
    assert.deepEqual(await tiers(),Array.from({length:10},(_,i)=>({cohort_tier:i+1,n:2})));
  }));
  for(const size of [23,1003]) {
    it(`keeps all ten groups within one wrestler for an untied population of ${size}`, () => isolated(async () => {
      await seedPopulation(size);
      const rows=await tiers();
      assert.equal(rows.length,10);
      assert.equal(rows.reduce((sum,r)=>sum+r.n,0),size);
      assert.ok(Math.max(...rows.map(r=>r.n))-Math.min(...rows.map(r=>r.n))<=1);
    }));
  }
  it("keeps equal conservative ratings together across a decile boundary", () => isolated(async () => {
    await seedPopulation(20);
    await db.exec(`update wrestler_model_ratings set rating=2499,conservative_score=2399
      where model_id='${M2}' and athlete_key in ('tier 00001','tier 00002')`);
    const rows=(await db.query<{cohort_rank:number;cohort_tier:number}>(
      "select cohort_rank,cohort_tier from wrestler_strength_current where athlete_key in ('tier 00001','tier 00002') order by athlete_key")).rows;
    assert.deepEqual(rows,[{cohort_rank:2,cohort_tier:1},{cohort_rank:2,cohort_tier:1}]);
  }));
  it("puts an entirely tied population in the same midpoint tier instead of inventing distinctions", () => isolated(async () => {
    await seedPopulation(20,true);
    assert.deepEqual(await tiers(),[{cohort_tier:5,n:20}]);
  }));
  it("withholds tiers below 20 while preserving rank, population and strength", () => isolated(async () => {
    await seedPopulation(19);
    assert.deepEqual(await tiers(),[{cohort_tier:null,n:19}]);
    const rows=(await db.query<{cohort_rank:number;cohort_size:number;strength_score:string;tier_unavailable_reason:string}>(
      "select * from wrestler_strength_current where athlete_key='tier 00000'")).rows;
    assert.equal(rows[0].cohort_rank,1);
    assert.equal(rows[0].cohort_size,19);
    assert.equal(Number(rows[0].strength_score),1000);
    assert.match(rows[0].tier_unavailable_reason,/20 rated/);
  }));
  it("retains deterministic inferred placement but withholds tier for tied age or weight support", () => isolated(async () => {
    await seedPopulation(20);
    await db.exec(evidenceInsert('tier 00000','Tier 00000',160,999999));
    const row=(await db.query<{cohort_tier:number|null;tier_unavailable_reason:string;bracket_weight_lbs:string}>(
      "select * from wrestler_strength_current where athlete_key='tier 00000'")).rows[0];
    assert.equal(Number(row.bracket_weight_lbs),150);
    assert.equal(row.cohort_tier,null);
    assert.match(row.tier_unavailable_reason,/tied support/);
  }));
  it("recomputes populations and tiers when current weight changes while preserving the global rating", () => isolated(async () => {
    await seedPopulation(20);
    await db.exec(evidenceInsert('tier 00000','Tier 00000',160,999999).replace("'2026-10-24'","'2026-11-01'").replace("'Fall Open'","'New Open'"));
    const rows=(await db.query<{athlete_key:string;cohort_size:number;cohort_tier:number|null;rating:string}>(
      "select athlete_key,cohort_size,cohort_tier,rating from wrestler_strength_current where athlete_key like 'tier %'")).rows;
    assert.equal(rows.length,20);
    assert.ok(rows.every(r=>r.cohort_tier===null));
    assert.equal(rows.find(r=>r.athlete_key==='tier 00000')?.cohort_size,1);
    assert.equal(Number(rows.find(r=>r.athlete_key==='tier 00000')?.rating),2500);
  }));
  it("recomputes current age cohort tiers without changing global ratings", () => isolated(async () => {
    await seedPopulation(20);
    await db.exec(evidenceInsert('tier 00000','Tier 00000',150,999999).replace("'2026-10-24'","'2026-11-01'").replace("'Fall Open'","'New Open'").replace("'12U'","'14U'"));
    const row=(await db.query<{age_group:string;cohort_size:number;cohort_tier:number|null;rating:string}>(
      "select * from wrestler_strength_current where athlete_key='tier 00000'")).rows[0];
    assert.equal(row.age_group,'14U');
    assert.equal(row.cohort_size,1);
    assert.equal(row.cohort_tier,null);
    assert.equal(Number(row.rating),2500);
  }));
  it("uses the existing reference-1500 expectation in both all-club and filtered reads", () => isolated(async () => {
    await db.exec(`insert into matches(event_date,season,event_name,weight_class,winner_name,winner_team,loser_name,loser_team,win_type)
      values ('2026-10-24','2026','Tier Club Open','75','A One','Tier Club A','Opponent','Tier Club B','DEC')`);
    const all=(await db.query<{club_key:string;schedule_expected_win_pct:string;avg_opponent_rating:string}>(
      "select club_key,schedule_expected_win_pct,avg_opponent_rating from club_rankings_current where season='ALL'")).rows;
    const filtered=(await db.query<{schedule_expected_win_pct:string}>(
      "select schedule_expected_win_pct from club_rankings_current where season='ALL' and club_key='raw:tier club b'")).rows;
    const row=all.find(r=>r.club_key==='raw:tier club b')!;
    assert.ok(row);
    assert.equal(Number(row.avg_opponent_rating),1400);
    assert.ok(Math.abs(Number(row.schedule_expected_win_pct)-1/(1+10**((1400-1500)/400)))<1e-12);
    assert.equal(filtered[0].schedule_expected_win_pct,row.schedule_expected_win_pct);
  }));
});
