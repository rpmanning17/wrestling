import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type Member = {
  source_name: string; source_club_key: string | null; alias_key: string;
  relationship: "alias" | "team" | "program"; existing: boolean;
};
export type Manifest = { version: number; approval: string; groups: {
  club_key: string; canonical_name: string; members: Member[];
}[] };
export const migrationName = "20261104161040_approved_club_normalization.sql";
export const ledger = "private.club_normalization_20261104_inserted";
export const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "config/club-normalization.approved.json"), "utf8")) as Manifest;

// Match PostgreSQL trim(text): trim ASCII spaces BEFORE replacing punctuation.
// In particular, do not trim the replacement result.
export const aliasKey = (name: string) => name.replace(/^ +| +$/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ");

export function validateManifest(input: Manifest) {
  const keys = new Set<string>();
  const clubs = new Set<string>();
  for (const group of input.groups) {
    if (!group.club_key || !group.canonical_name || clubs.has(group.club_key)) throw new Error("Duplicate or empty canonical club key");
    clubs.add(group.club_key);
    for (const row of group.members) {
      if (row.alias_key !== aliasKey(row.source_name)) throw new Error(`Incorrect SQL alias key: ${row.source_name}`);
      if (keys.has(row.alias_key)) throw new Error(`Duplicate alias key: ${JSON.stringify(row.alias_key)}`);
      if (!["alias", "team", "program"].includes(row.relationship)) throw new Error("Invalid relationship");
      keys.add(row.alias_key);
    }
  }
  return input.groups.flatMap(group => group.members.map(row => ({ ...row, club_key: group.club_key, canonical_name: group.canonical_name })));
}

export function buildMigration(input: Manifest) {
  const rows = validateManifest(input);
  const json = JSON.stringify(rows).replace(/'/g, "''");
  const inserts = rows.filter(row => !row.existing).length;
  return `-- Generated from config/club-normalization.approved.json. Do not edit by hand.
-- Finite reviewed aliases only; source matches, ratings and histories remain untouched.
begin;
set local lock_timeout = '5s';
lock table public.club_aliases in share row exclusive mode;
create temporary table normalization_plan on commit drop as
select * from jsonb_to_recordset('${json}'::jsonb) as x(
  source_name text, source_club_key text, alias_key text, relationship text,
  existing boolean, club_key text, canonical_name text);
alter table normalization_plan add primary key (alias_key);
do $$
begin
  if exists (select 1 from normalization_plan where alias_key <>
    regexp_replace(lower(trim(source_name)), '[^a-z0-9]+', ' ', 'g')) then
    raise exception 'Alias key differs from exact database normalizer';
  end if;
  if exists (select 1 from normalization_plan p join public.club_aliases a using(alias_key)
    where (p.club_key,p.canonical_name,p.relationship) is distinct from
      (a.club_key,a.canonical_name,a.relationship)) then
    raise exception 'Approved club alias conflicts with an existing canonical mapping';
  end if;
  if exists (select 1 from normalization_plan p left join public.club_aliases a using(alias_key)
    where p.existing is distinct from (a.alias_key is not null)) then
    raise exception 'Existing alias baseline changed; stop rather than overwrite';
  end if;
end $$;
-- Private, inaccessible ledger contains ONLY rows actually inserted by this migration.
create table ${ledger} (like public.club_aliases including defaults including constraints);
alter table ${ledger} add primary key(alias_key);
alter table ${ledger} enable row level security;
revoke all on ${ledger} from public, anon, authenticated, service_role;
with inserted as (
  insert into public.club_aliases(alias_key,club_key,canonical_name,relationship)
  select alias_key,club_key,canonical_name,relationship from normalization_plan where not existing
  returning *
)
insert into ${ledger} select * from inserted;
do $$ begin
  if (select count(*) from ${ledger}) <> ${inserts} then
    raise exception 'Unexpected club alias insert count';
  end if;
end $$;
commit;
`;
}

export function buildRollback() {
  return `-- Run separately as database administrator; never part of normal migration replay.
-- Aborts if any inserted alias has changed or disappeared since the migration.
begin;
set local lock_timeout = '5s';
lock table public.club_aliases in share row exclusive mode;
do $$ begin
  if exists (select 1 from ${ledger} i left join public.club_aliases a using(alias_key)
    where to_jsonb(a) is distinct from to_jsonb(i)) then
    raise exception 'An inserted alias changed; rollback requires reconciliation';
  end if;
end $$;
delete from public.club_aliases a using ${ledger} i
where a.alias_key=i.alias_key;
drop table ${ledger};
commit;
`;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/generate-normalization.ts")) {
  writeFileSync(path.join("supabase/migrations", migrationName), buildMigration(manifest));
  writeFileSync("supabase/rollbacks/20261104_approved_club_normalization.sql", buildRollback());
}
