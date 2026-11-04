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
