import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

it("age-scoped cohorts preserve complete histories, all output fields and denied access for both identity schemes", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create schema extensions; grant usage on schema extensions to anon;
      create function extensions.digest(data text,kind text) returns bytea language sql immutable
        as $$ select sha256(convert_to(data,'UTF8')) $$;`);
    const migration = "20261109204500_bound_age_cohort_population.sql";
    for (const file of readdirSync("supabase/migrations").filter(f => f.endsWith(".sql") && f < migration).sort())
      await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
    await db.exec(`insert into public.matches(event_date,season,event_name,weight_class,winner_name,loser_name,win_type)
      select date '2026-10-01'+n,'2026',
        case when n<3 then 'Repeated  Duals' else 'Open '||n end,
        case n%4 when 0 then '12U 75' when 1 then '14U 80' when 2 then 'HWT' else '10U 70' end,
        'Mixed Athlete','Opponent '||n,'DEC' from generate_series(0,11) n;
      insert into public.wrestler_people(display_name)
        select distinct name from (
          select winner_name name from matches union select loser_name from matches) names;
      insert into public.identity_decisions(authority,disposition,source_checksum,rationale)
        values ('administrative','separate_people','fixture','Test source assignments');
      insert into public.identity_assignment_batches(decision_id) select id from identity_decisions;`);
    await db.exec(`select private.assign_source_identity(b.id,s.kind,m.id::text,p.id,0,s.name,d.id)
      from public.matches m cross join lateral
        (values ('match_winner',m.winner_name),('match_loser',m.loser_name)) s(kind,name)
      join public.wrestler_people p on p.display_name=s.name
      cross join public.identity_assignment_batches b cross join public.identity_decisions d;`);
    const snapshot = async (view: string) => (await db.query<Record<string, unknown>>(`select * from public.${view} order by athlete_key`)).rows;
    const oldName = await snapshot("wrestler_cohort_current");
    const oldPerson = await snapshot("person_cohort_current");
    await db.exec(readFileSync("supabase/migrations/" + migration, "utf8"));
    await db.exec(readFileSync("supabase/migrations/20261109205000_inline_age_cohort_functions.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/20261109205500_bound_person_cohort_inputs.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/20261109210001_plan_cohorts_with_fixed_search_path.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/20261109211500_index_transactional_cohort_appearances.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/20261109212500_drive_cohort_appearance_indexes.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/20261109213000_scope_current_standings.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/20261109213500_drive_person_appearance_indexes.sql", "utf8"));
    assert.deepEqual(await snapshot("wrestler_cohort_current"), oldName);
    assert.deepEqual(await snapshot("person_cohort_current"), oldPerson);
    for (const [fn, baseline] of [["current_wrestler_cohorts", oldName], ["current_person_cohorts", oldPerson]] as const) {
      for (const age of [6,8,10,12,14,16,18]) {
        const scoped = (await db.query(`select * from public.${fn}($1) where age_group=$2 order by athlete_key`, [age, age+"U"])).rows;
        assert.deepEqual(scoped, baseline.filter(r => r.age_group === age+"U"));
      }
      await db.exec("set role anon");
      assert.equal((await db.query(`select * from public.${fn}(12)`)).rows.length, 0);
      await db.exec("reset role");
      assert.equal((await db.query<{prosecdef:boolean}>(`select prosecdef from pg_proc where oid='public.${fn}(integer)'::regprocedure`)).rows[0].prosecdef, false);
    }
    const projection = async () => (await db.query(`select source_match_id,side,athlete_name,team,event_date,event_name,age_group,bracket_weight_lbs
      from private.match_cohort_appearances order by source_match_id,side`)).rows;
    const verifyProjection = async () => assert.deepEqual(await projection(), (await db.query(`
      select m.id source_match_id,p.side,p.name athlete_name,p.team,m.event_date,m.event_name,
       (regexp_match(m.weight_class,'(?<![0-9])(6|8|10|12|14|16|18) ?[uU](?![a-zA-Z])'))[1]||'U' age_group,
       substring(m.weight_class from '([0-9]+(?:[.][0-9]+)?)[^0-9]*$')::numeric bracket_weight_lbs
      from public.matches m cross join lateral
       (values ('winner',m.winner_name,m.winner_team),('loser',m.loser_name,m.loser_team)) p(side,name,team)
      order by m.id,p.side`)).rows);
    await verifyProjection();
    const before = await projection();
    await db.exec("begin");
    await db.exec(`update public.matches set weight_class='8U 60',winner_name='Changed Name',event_name='Changed Event'`);
    await verifyProjection();
    await db.exec("rollback");
    assert.deepEqual(await projection(), before);
    await db.exec(`insert into public.matches(event_date,season,event_name,weight_class,winner_name,loser_name,win_type)
      values ('2026-11-07','2026','Projection Test','12U - 70-74','New Winner','New Loser','DEC')`);
    await verifyProjection();
    await db.exec("delete from public.matches where event_name='Projection Test'");
    await verifyProjection();
    assert.deepEqual(await projection(), before);
    await db.exec("set role anon");
    assert.equal((await db.query("select * from private.match_cohort_appearances")).rows.length, 0);
    await assert.rejects(() => db.exec("delete from private.match_cohort_appearances"), /permission denied/);
    await db.exec("reset role");
    assert.equal((await db.query<{allowed:boolean}>(`select has_function_privilege('anon',
      'private.sync_match_cohort_appearances()','EXECUTE') allowed`)).rows[0].allowed, false);
  } finally { await db.close(); }
});
