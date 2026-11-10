import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;
const migrations = path.join(process.cwd(), "supabase", "migrations");
const count = async (query: string) => Number((await db.query<{ n: number }>(query)).rows[0].n);

const bout = (season: string, round: string, winner: string, winnerTeam: string, loser: string, loserTeam: string) => `
  insert into public.matches (event_date, season, event_name, weight_class, round, winner_name, winner_team, loser_name, loser_team, result, win_type)
  values ('2026-10-24', '${season}', 'Fall Open', '12U 70', '${round}', '${winner}', '${winnerTeam}', '${loser}', '${loserTeam}', '5-3', 'DEC')`;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create schema extensions;
    create function extensions.digest(data text, kind text) returns bytea language sql immutable
      as $$ select sha256(convert_to(data, 'UTF8')) $$;
  `);
  for (const filename of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(migrations, filename), "utf8"));
  }
  await db.exec(`
    create or replace function private.personal_app_request_is_valid() returns boolean language sql stable
    as $$ select coalesce(current_setting('request.headers', true)::jsonb ->> 'x-personal-app-key', '') = 'test-key' $$;
    grant usage on schema private to anon;
  `);
  await db.exec([
    bout("2026–2027", "Round 1", "A One", "Alpha WC", "B Two", "Lake Highland Prep"),
    bout("2026-2027", "Round 2", "B Two", "LHP", "A One", "Alpha Wrestling Club"),
    bout("2026–2027", "Final", "C Three", "SpartanRTC@LHP", "D Four", "Alpha Miami Grappling"),
    bout("2026–2027", "Round 1", "A One", "Alpha", "E Five", "Spartan RTC"),
  ].join(";\n"));
});
after(async () => { await db.close(); });

describe("event-specific club normalization and rankings", () => {
  it("keeps every person club metric and season/club subset identical with a live person model", async () => {
    await db.exec("begin");
    try {
      await db.exec(`insert into public.wrestler_people(display_name)
        select distinct name from (select winner_name name from public.matches union select loser_name from public.matches)n;
        insert into public.identity_decisions(authority,disposition,source_checksum,rationale)
        values('administrative','separate_people','fixture','Independent club fixture');
        insert into public.identity_assignment_batches(decision_id) select id from public.identity_decisions;
        insert into public.source_identity_current_rows(source_kind,source_id,recorded_name,person_id,revision,batch_id)
        select s.kind,m.id::text,s.name,p.id,1,b.id from public.matches m
        cross join lateral(values('match_winner',m.winner_name),('match_loser',m.loser_name))s(kind,name)
        join public.wrestler_people p on p.display_name=s.name cross join public.identity_assignment_batches b;
        insert into public.rating_models(model_version,status,identity_scheme,assignment_fingerprint,config,config_hash,input_fingerprint,
        as_of_date,match_cutoff,rating_period_policy,rating_period_days,uncertainty_k,provisional_rd,established_rd,recency_policy,matches_total,matches_rated,wrestlers_rated)
        values('club-fixture','building','person_uuid',repeat('c',64),'{}',repeat('a',64),repeat('b',64),'2026-11-09','2026-11-08','fixed_1d',1,1,120,80,'glicko2_inactivity_rd_growth',4,4,5);
        insert into public.wrestler_model_ratings(model_id,person_id,athlete_key,athlete_name,rating,rating_deviation,volatility,
        conservative_score,rating_status,match_count,wins,losses,first_match_date,last_match_date)
        select m.id,p.id,p.id::text,p.display_name,1400+100*row_number()over(order by p.display_name),100,0.06,
        1300+100*row_number()over(order by p.display_name),'developing',
        (select count(*) from public.matches where winner_name=p.display_name or loser_name=p.display_name),
        (select count(*) from public.matches where winner_name=p.display_name),
        (select count(*) from public.matches where loser_name=p.display_name),'2026-10-24','2026-10-24'
        from public.wrestler_people p cross join public.rating_models m;
        update public.rating_models set status='active',assignment_fingerprint=(
        select encode(sha256(convert_to(string_agg(source_kind||chr(31)||source_id||chr(31)||
        encode(convert_to(recorded_name,'UTF8'),'hex')||chr(31)||coalesce(person_id::text,''),
        chr(10) order by source_kind collate "C",source_id collate "C"),'UTF8')),'hex') from public.source_identity_current_rows);`);
      const rows = async (view: string) => (await db.query<Record<string, unknown>>(`select * from public.${view} order by season,club_key${view.includes("roster") ? ",athlete_key" : ""}`)).rows;
      const clubs = await rows("person_club_rankings_current");
      const roster = await rows("person_club_roster_current");
      assert.ok(clubs.length > 0 && roster.length > 0);
      const verifyInputs = async () => assert.equal(await count(`select count(*) n
        from private.match_cohort_appearances p join public.matches m on m.id=p.source_match_id
        left join public.source_identity_current_rows a on a.source_id=m.id::text
          and a.source_kind=case p.side when 'winner' then 'match_winner' else 'match_loser' end
        left join public.source_identity_current_rows o on o.source_id=m.id::text
          and o.source_kind=case p.side when 'winner' then 'match_loser' else 'match_winner' end
        where p.person_id is distinct from a.person_id or p.club_opponent_person_id is distinct from o.person_id
          or p.club_season is distinct from replace(m.season,'–','-') or p.club_win_type is distinct from m.win_type
          or p.club_opponent_team is distinct from case p.side when 'winner' then m.loser_team else m.winner_team end
          or p.club_alias_key is distinct from regexp_replace(lower(trim(p.team)),'[^a-z0-9]+',' ','g')
          or p.club_contested is distinct from (upper(trim(m.win_type)) in('F','DEC','MD','TF'))`),0);
      await verifyInputs();
      const verifyCounts = async () => {
        const actual = (await db.query(`select season,team,person_id,bouts,wins,losses from private.club_person_source_counts order by season,team,person_id`)).rows;
        const expected = (await db.query(`select p.club_season season,p.team,p.person_id,count(*)::integer bouts,
          count(*) filter(where side='winner')::integer wins,count(*) filter(where side='loser')::integer losses
          from private.match_cohort_appearances p where p.club_contested and p.person_id is not null
          and p.club_opponent_person_id is not null and p.person_id<>p.club_opponent_person_id and nullif(trim(p.team),'') is not null
          group by p.club_season,p.team,p.person_id order by season,team,person_id`)).rows;
        assert.deepEqual(actual,expected);
      };
      await verifyCounts();
      await db.exec("savepoint projection_changes");
      await db.exec("update public.matches set season='2025-2026',winner_team='Edited-Team!',loser_team='Other Team',win_type='F'");
      await verifyInputs();
      await verifyCounts();
      await db.exec("update public.source_identity_current_rows set person_id=null where source_kind='match_winner'");
      await verifyInputs();
      await verifyCounts();
      await db.exec("delete from public.source_identity_current_rows where source_kind='match_loser'");
      await verifyInputs();
      await verifyCounts();
      assert.equal((await db.query("select * from public.person_club_rankings_for_season('ALL',null)")).rows.length,0);
      await db.exec("rollback to projection_changes");
      await verifyInputs();
      await verifyCounts();
      assert.deepEqual(await rows("person_club_rankings_current"),clubs);
      for (const season of ["ALL", "2026-2027"]) {
        const summaries = (await db.query<Record<string, unknown>>(`select * from public.person_club_rankings_for_season($1,null) order by season,club_key`, [season])).rows;
        assert.deepEqual(summaries, clubs.filter(row => row.season === season));
        for (const sort of ["wrestlers","bouts","avg_conservative","median_conservative","top_five_conservative","avg_opponent_rating"]) {
          const directory = (await db.query(`select * from public.person_club_directory($1,$2) order by club_key`,[season,sort])).rows;
          assert.deepEqual(directory,summaries.map(row => ({club_key:row.club_key,club_name:row.club_name,
            bouts:row.bouts,wrestlers:row.wrestlers,sort_value:row[sort]==null ? null : String(row[sort])})));
        }
        assert.deepEqual((await db.query(`select * from public.person_club_rankings_for_keys($1,$2) order by season,club_key`,
          [season,[...summaries.map(row => row.club_key),...summaries.map(row => row.club_key)]])).rows,summaries);
        for (const club of summaries) {
          assert.deepEqual((await db.query(`select * from public.person_club_roster_for_season($1,$2) order by season,club_key,athlete_key`, [season,club.club_key])).rows,
            roster.filter(row => row.season === season && row.club_key === club.club_key));
        }
      }
      const oldSql = readFileSync(path.join(migrations,"20261105182000_person_club_views.sql"),"utf8")
        .replace(/^begin;|^commit;/gmi,"").replace(/create view /g,"create or replace view ");
      await db.exec(oldSql);
      assert.deepEqual(await rows("person_club_rankings_current"),clubs);
      assert.deepEqual(await rows("person_club_roster_current"),roster);
      await db.exec("set local role anon");
      await db.exec(`select set_config('request.headers','{}',true)`);
      assert.equal((await db.query("select * from public.person_club_rankings_for_season('ALL',null)")).rows.length,0);
      assert.equal((await db.query("select * from public.person_club_roster_for_season('ALL',null)")).rows.length,0);
      assert.equal((await db.query("select * from public.person_club_directory('ALL','wrestlers')")).rows.length,0);
      assert.equal((await db.query("select * from public.person_club_rankings_for_keys('ALL',array['alpha-wrestling-club'])")).rows.length,0);
      assert.equal((await db.query("select * from private.club_person_source_counts")).rows.length,0);
      await assert.rejects(()=>db.exec("delete from private.club_person_source_counts"),/permission denied/);
    } finally { await db.exec("rollback"); }
  });
  it("preserves punctuation-boundary spaces in alias keys and resolves each exact key", async () => {
    // PostgreSQL trims BEFORE replacing punctuation. A final JS trim would
    // silently collapse the two Gateway keys and the two Sunset keys.
    const rows = (await db.query<{ label: string; key: string }>(`
      select label, regexp_replace(lower(trim(label)), '[^a-z0-9]+', ' ', 'g') as key
      from (values ('Gateway (Fort Myers)'), ('Gateway Fort Myers'),
        ('Sunset sniper.'), ('Sunset sniper')) as labels(label)
    `)).rows;
    assert.deepEqual(rows.map((row) => row.key), [
      "gateway fort myers ", "gateway fort myers", "sunset sniper ", "sunset sniper",
    ]);
    assert.equal(new Set(rows.map((row) => row.key)).size, 4);
    await db.exec("begin");
    try {
      // Use synthetic canonical keys so this regression remains independent of
      // the reviewed production mapping and of any future alias migration.
      await db.exec(`
        delete from public.club_aliases where alias_key in
          ('gateway fort myers ', 'gateway fort myers', 'sunset sniper ', 'sunset sniper');
        insert into public.club_aliases(alias_key,club_key,canonical_name) values
          ('gateway fort myers ', 'fixture-gateway', 'Fixture Gateway'),
          ('gateway fort myers', 'fixture-gateway', 'Fixture Gateway'),
          ('sunset sniper ', 'fixture-sunset', 'Fixture Sunset'),
          ('sunset sniper', 'fixture-sunset', 'Fixture Sunset');
      `);
      await db.exec([
        bout("2026-2027", "Key 1", "Key A", "Gateway (Fort Myers)", "Key B", "Sunset sniper."),
        bout("2026-2027", "Key 2", "Key A", "Gateway Fort Myers", "Key B", "Sunset sniper"),
      ].join(";\n"));
      const rosters = (await db.query<{ club_key: string; bouts: number }>(`
        select club_key,bouts from public.club_roster_current
        where season='ALL' and club_key in ('fixture-gateway','fixture-sunset') order by club_key
      `)).rows;
      assert.deepEqual(rosters, [
        { club_key: "fixture-gateway", bouts: 2 }, { club_key: "fixture-sunset", bouts: 2 },
      ]);
      assert.equal(await count(`select count(*) as n from public.matches
        where round in ('Key 1','Key 2')`), 2);
      assert.equal(await count(`select count(distinct winner_team) as n from public.matches
        where round in ('Key 1','Key 2')`), 2);
    } finally {
      await db.exec("rollback");
    }
  });

  it("groups confirmed aliases but never merges unrelated Alpha clubs or Spartan RTC into LHP", async () => {
    const rows = (await db.query<{ club_key: string; bouts: number; wins: number; losses: number; wrestlers: number }>(`
      select club_key, bouts, wins, losses, wrestlers from public.club_rankings_current
      where season='ALL' order by club_key`)).rows;
    const byClub = new Map(rows.map((row) => [row.club_key, row]));
    assert.equal(byClub.get("alpha-wrestling-club")?.bouts, 3);
    assert.equal(byClub.get("alpha-wrestling-club")?.wins, 2);
    assert.equal(byClub.get("lake-highland-prep")?.bouts, 2);
    assert.equal(byClub.get("spartan-rtc")?.bouts, 2);
    assert.equal(byClub.get("raw:alpha miami grappling")?.bouts, 1);
    assert.notEqual(byClub.get("spartan-rtc")?.club_key, byClub.get("lake-highland-prep")?.club_key);
    assert.equal(byClub.get("alpha-wrestling-club")?.wrestlers, 1);
  });

  it("retains two recorded contests between the same wrestlers at the same event", async () => {
    assert.equal(await count(`select count(*)::int as n from public.matches
      where (winner_name='A One' and loser_name='B Two') or (winner_name='B Two' and loser_name='A One')`), 2);
    const rows = (await db.query<{ season: string; bouts: number }>(`
      select season,bouts from public.club_rankings_current where club_key='lake-highland-prep' and season='2026-2027'`)).rows;
    assert.equal(rows[0].bouts, 2);
  });

  it("never treats a season label with an en dash as a separate season", async () => {
    assert.equal(await count(`select count(*)::int as n from public.club_rankings_current
      where club_key='alpha-wrestling-club' and season='2026-2027'`), 1);
  });

  it("preserves event-specific rosters without assigning every athlete to their newest club", async () => {
    const rows = (await db.query<{ club_key: string; athlete_name: string; bouts: number }>(`
      select club_key, athlete_name, bouts from public.club_roster_current
      where season='ALL' and athlete_name='A One' order by club_key`)).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].club_key, "alpha-wrestling-club");
    assert.equal(rows[0].bouts, 3);
  });

  it("shows no fictional ratings before a model is activated", async () => {
    const rows = (await db.query<{ median_conservative: number | null; avg_opponent_rating: number | null }>(`
      select median_conservative,avg_opponent_rating from public.club_rankings_current
      where season='ALL' and club_key='alpha-wrestling-club'`)).rows;
    assert.equal(rows[0].median_conservative, null);
    assert.equal(rows[0].avg_opponent_rating, null);
  });

  it("requires the personal app authorization header for club data", async () => {
    await db.exec("reset role");
    await db.exec(`select set_config('request.headers', '{}', false)`);
    await db.exec("set role anon");
    assert.equal(await count("select count(*)::int as n from public.club_aliases"), 0);
    assert.equal(await count("select count(*)::int as n from public.club_rankings_current"), 0);
    await db.exec("reset role");
    await db.exec(`select set_config('request.headers', '{"x-personal-app-key":"test-key"}', false)`);
    await db.exec("set role anon");
    assert.ok(await count("select count(*)::int as n from public.club_aliases") > 0);
    assert.ok(await count("select count(*)::int as n from public.club_rankings_current") > 0);
    await db.exec("reset role");
  });
});
