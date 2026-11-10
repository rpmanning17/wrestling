import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, before, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { splitPoolRows, type PoolRow } from "../../src/lib/identity/person-ranking-pool";

let db: PGlite;
const migrations = path.join(process.cwd(), "supabase", "migrations");
const COHORT = "athlete_key,athlete_name,team,evidence_date,age_group,bracket_weight_lbs,weight_bucket,division_birth_year_start,division_birth_year_end,confidence_score,confidence_label,evidence_type,tier_eligible";

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create schema extensions;
    create function extensions.digest(data text, kind text) returns bytea language sql immutable
      as $$ select sha256(convert_to(data, 'UTF8')) $$;`);
  for (const file of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort())
    await db.exec(readFileSync(path.join(migrations, file), "utf8"));
  await db.exec(`create or replace function private.personal_app_request_is_valid() returns boolean language sql stable
    as $$ select coalesce(current_setting('request.headers', true)::jsonb ->> 'x-personal-app-key', '') = 'test-key' $$;
    grant usage on schema private to anon;`);
  // 30 12U wrestlers across two weight buckets (repeat bouts included), plus 14U and mixed-age histories.
  await db.exec(`insert into public.matches(event_date,season,event_name,weight_class,winner_name,winner_team,loser_name,loser_team,result,win_type)
    select date '2026-10-01'+(n%9),'2026-2027','Open '||(n%5),
      case when n<40 then (case when n%2=0 then '12U 70' else '12U 75' end) when n<48 then '14U 95' else '12U 75' end,
      'W'||(n%30),'Club '||(n%4),'W'||((n*7+3)%30+(case when n>=40 and n<48 then 30 else 0 end)),'Club '||(n%3),'5-3',
      case n%4 when 0 then 'DEC' when 1 then 'F' when 2 then 'MD' else 'TF' end
    from generate_series(0,59) n where 'W'||(n%30) <> 'W'||((n*7+3)%30+(case when n>=40 and n<48 then 30 else 0 end));
    insert into public.wrestler_people(display_name)
      select distinct name from (select winner_name name from public.matches union select loser_name from public.matches) n;
    insert into public.identity_decisions(authority,disposition,source_checksum,rationale)
      values('administrative','separate_people','fixture','Ranking pool fixture');
    insert into public.identity_assignment_batches(decision_id) select id from public.identity_decisions;
    insert into public.source_identity_current_rows(source_kind,source_id,recorded_name,person_id,revision,batch_id)
      select s.kind,m.id::text,s.name,p.id,1,b.id from public.matches m
      cross join lateral(values('match_winner',m.winner_name),('match_loser',m.loser_name)) s(kind,name)
      join public.wrestler_people p on p.display_name=s.name cross join public.identity_assignment_batches b;
    insert into public.rating_models(model_version,status,identity_scheme,assignment_fingerprint,config,config_hash,input_fingerprint,
      as_of_date,match_cutoff,rating_period_policy,rating_period_days,uncertainty_k,provisional_rd,established_rd,recency_policy,matches_total,matches_rated,wrestlers_rated)
      values('pool-fixture','building','person_uuid',repeat('c',64),'{}',repeat('a',64),repeat('b',64),'2026-11-09','2026-11-08','fixed_1d',1,1,120,80,'glicko2_inactivity_rd_growth',60,60,40);
    -- Rate all but every fifth person; equal scores create ties.
    insert into public.wrestler_model_ratings(model_id,person_id,athlete_key,athlete_name,rating,rating_deviation,volatility,
      conservative_score,rating_status,match_count,wins,losses,first_match_date,last_match_date)
      select m.id,p.id,p.id::text,p.display_name,1400+10*(r%17),100,0.06,1300+10*(r%17),'developing',2,1,1,'2026-10-01','2026-10-09'
      from (select *,row_number() over(order by display_name) r from public.wrestler_people) p cross join public.rating_models m
      where p.r%5<>0;
    -- Fixture reconciliation totals (not a real calculation): balanced wins/losses per rated row.
    update public.rating_models set matches_total=(select count(*) from public.matches),
      wrestlers_rated=(select count(*) from public.wrestler_model_ratings),
      matches_rated=(select count(*) from public.wrestler_model_ratings);
    update public.rating_models set status='active',assignment_fingerprint=(
      select encode(sha256(convert_to(string_agg(source_kind||chr(31)||source_id||chr(31)||
      encode(convert_to(recorded_name,'UTF8'),'hex')||chr(31)||coalesce(person_id::text,''),
      chr(10) order by source_kind collate "C",source_id collate "C"),'UTF8')),'hex') from public.source_identity_current_rows);`);
});
after(async () => { await db.close(); });

it("single-pass ranking pool reproduces every cohort and standing field for each age", async () => {
  const rows = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows;
  let ratedTwelve = 0;
  for (const age of [6, 10, 12, 14, 18]) {
    const pool = await rows(`select * from public.current_person_cohort_strength($1) order by athlete_key`, [age]);
    assert.deepEqual(await rows(`select ${COHORT} from public.current_person_cohort_strength($1) order by athlete_key`, [age]),
      await rows(`select * from public.current_person_cohorts($1) order by athlete_key`, [age]));
    const strength = await rows(`select * from public.current_person_strength($1) order by athlete_key`, [age]);
    const rated = pool.filter(row => row.strength_rated);
    assert.equal(rated.length, strength.length);
    assert.deepEqual(rated.map(row => ({ athlete_key: row.athlete_key, strength_score: row.strength_score, cohort_rank: row.cohort_rank,
      cohort_size: row.cohort_size, cohort_tier: row.cohort_tier, tier_unavailable_reason: row.tier_unavailable_reason,
      weight_band: row.strength_weight_band, age_group: row.age_group, bracket_weight_lbs: row.strength_bracket_weight_lbs })),
    strength.map(row => ({ athlete_key: row.athlete_key, strength_score: row.strength_score, cohort_rank: row.cohort_rank,
      cohort_size: row.cohort_size, cohort_tier: row.cohort_tier, tier_unavailable_reason: row.tier_unavailable_reason,
      weight_band: row.weight_band, age_group: row.age_group, bracket_weight_lbs: row.bracket_weight_lbs })));
    for (const row of pool.filter(row => !row.strength_rated))
      assert.ok([row.strength_score, row.cohort_rank, row.cohort_size, row.cohort_tier, row.strength_weight_band].every(v => v === null));
    if (age === 12) ratedTwelve = rated.length;
  }
  // The fixture exercises tiers (>=20 rated), unrated cohort members and other ages.
  assert.ok(ratedTwelve >= 20);
  const twelve = await rows(`select * from public.current_person_cohort_strength(12)`);
  assert.ok(twelve.some(row => !row.strength_rated) && twelve.some(row => row.cohort_tier !== null));
  assert.ok((await rows(`select * from public.current_person_cohort_strength(14)`)).length > 0);
  await assert.rejects(() => db.query("select * from public.current_person_cohort_strength(null)"), /requires an age/);

  // App split yields exactly the cohort rows and the rated standing rows the profile builder previously fetched.
  const { cohorts, strength } = splitPoolRows(twelve as unknown as PoolRow[]);
  assert.equal(cohorts.length, twelve.length);
  assert.deepEqual(strength.map(row => row.athlete_key).sort(),
    (await rows(`select athlete_key from public.current_person_strength(12)`)).map(row => row.athlete_key).sort());

  await db.exec("begin");
  try {
    await db.exec("set local role anon");
    await db.exec(`select set_config('request.headers','{}',true)`);
    assert.equal((await rows("select * from public.current_person_cohort_strength(12)")).length, 0);
    await db.exec(`select set_config('request.headers','{"x-personal-app-key":"test-key"}',true)`);
    assert.equal((await rows("select * from public.current_person_cohort_strength(12)")).length, twelve.length);
    await db.exec("reset role");
    await db.exec("set local role authenticated");
    await assert.rejects(() => db.query("select * from public.current_person_cohort_strength(12)"), /permission denied/);
  } finally { await db.exec("rollback"); }
});
