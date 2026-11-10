import assert from "node:assert/strict";
import { readFileSync,readdirSync } from "node:fs";
import { it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

it("indexed person history preserves every field, held opposite sides, same-name separation and complete pagination under RLS",async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
      create schema extensions;grant usage on schema extensions to anon;
      create function extensions.digest(data text,kind text) returns bytea language sql immutable
       as $$select sha256(convert_to(data,'UTF8'))$$;`);
    for(const file of readdirSync("supabase/migrations").filter(f=>f.endsWith(".sql")).sort())
      await db.exec(readFileSync("supabase/migrations/"+file,"utf8"));
    const a="11111111-1111-4111-8111-111111111111",b="22222222-2222-4222-8222-222222222222";
    await db.exec(`insert into public.matches(event_date,season,event_name,weight_class,winner_name,loser_name,win_type,source_file,source_row)
      select date '2026-11-07','2026','Repeated Open','12U 75','Shared Name','Shared Name','DEC','history-fixture',n
      from generate_series(1,1002) n;
      insert into public.wrestler_people(id,display_name) values ('${a}','Person A'),('${b}','Person B');
      insert into public.identity_decisions(authority,disposition,source_checksum,rationale)
      values ('owner_confirmed','separate_people','fixture','Independent source-side people');
      insert into public.identity_assignment_batches(decision_id) select id from public.identity_decisions;
      select private.assign_source_identity(batch.id,s.kind,m.id::text,s.person_id,0,'Shared Name',d.id)
      from public.matches m cross join lateral
      (values ('match_winner','${a}'::uuid),('match_loser',case when m.source_row=1002 then null else '${b}'::uuid end)) s(kind,person_id)
      cross join public.identity_assignment_batches batch cross join public.identity_decisions d;`);
    const fields="id,event_date,event_name,city,weight_class,winner_name,winner_team,winner_person_id,loser_name,loser_team,loser_person_id,result,win_type";
    for(const [side,ids] of [["winner",[a,a]],["loser",[b]]] as const) {
      const expected=(await db.query(`select ${fields} from public.person_matches
        where ${side}_person_id=any($1::uuid[]) order by event_date desc,id`,[ids])).rows;
      const actual=(await db.query("select * from public.person_match_history($1,$2) order by event_date desc,id",[ids,side])).rows;
      assert.deepEqual(actual,expected);
      const first=(await db.query("select * from public.person_match_history($1,$2) order by event_date desc,id limit 1000",[ids,side])).rows;
      const rest=(await db.query("select * from public.person_match_history($1,$2) order by event_date desc,id offset 1000",[ids,side])).rows;
      assert.deepEqual([...first,...rest],expected);
      assert.ok(expected.length>1000);
    }
    assert.equal((await db.query("select * from public.person_match_history('{}','winner')")).rows.length,0);
    await assert.rejects(()=>db.query("select * from public.person_match_history($1,'invalid')",[[a]]),/Invalid match side/);
    await db.exec("set role anon");
    assert.equal((await db.query("select * from public.person_match_history($1,'winner')",[[a]])).rows.length,0);
    await db.exec("reset role");
    await db.exec(`create or replace function private.personal_app_request_is_valid() returns boolean language sql stable
      as $$select coalesce(current_setting('request.headers',true)::jsonb->>'x-personal-app-key','')='test-key'$$;
      select set_config('request.headers','{"x-personal-app-key":"test-key"}',false);
      set role anon;`);
    assert.equal((await db.query("select * from public.person_match_history($1,'winner')",[[a]])).rows.length,1002);
    assert.equal((await db.query("select * from public.person_match_history($1,'loser')",[[a]])).rows.length,0);
    await db.exec("reset role");
    assert.equal((await db.query<{allowed:boolean}>(`select has_function_privilege('authenticated','public.person_match_history(uuid[],text)','execute') allowed`)).rows[0].allowed,false);
  } finally {await db.close();}
});
