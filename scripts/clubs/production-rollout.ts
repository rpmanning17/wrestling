import { buildMigration, manifest } from "./generate-normalization";

// Administrator-only rollout envelope. It adds production-data assertions to
// the portable migration; it is not used by an empty development database.
const protectedObjects = ["matches", "wrestler_aliases", "tournament_entries", "tournament_observations",
  "wrestler_evidence", "rating_models", "wrestler_model_ratings", "wrestler_rating_history",
  "wrestler_strength_current"];
export const protectedSnapshot = protectedObjects.map(name => `select '${name}' as object_name,
  count(*) as row_count, md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as checksum
  from public.${name} t`).join("\nunion all\n");

export function productionRollout() {
  const migration = buildMigration(manifest).replace(/^begin;$/m, "").replace(/^commit;$/m, "");
  return `begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.club_aliases in share row exclusive mode;
lock table public.matches,public.wrestler_aliases,public.tournament_entries,
  public.tournament_observations,public.wrestler_evidence,public.rating_models,
  public.wrestler_model_ratings,public.wrestler_rating_history in share mode;
create temporary table protected_before on commit drop as ${protectedSnapshot};
create temporary table aliases_before on commit drop as select * from public.club_aliases;
do $$ begin
  if (select count(*) from public.club_aliases)<>13 or
     (select count(*) from public.matches)<>31845 or
     (select count(*) from public.club_rankings_current where season='ALL')<>1182 then
    raise exception 'Production baseline changed; rerun the read-only audit';
  end if;
end $$;
${migration}
create temporary table protected_after on commit drop as ${protectedSnapshot};
do $$ begin
  if exists (select * from protected_before except select * from protected_after) or
     exists (select * from protected_after except select * from protected_before) then
    raise exception 'Protected raw/history/rating/cohort rows changed';
  end if;
  if exists (select * from aliases_before except select * from public.club_aliases) then
    raise exception 'An existing alias changed';
  end if;
  if (select count(*) from public.club_aliases)<>390 or
     (select count(*) from public.club_rankings_current where season='ALL')<>952 or
     (select count(*) from public.club_roster_current where season='ALL')<>9943 or
     (select sum(bouts) from public.club_rankings_current where season='ALL')<>59850 or
     (select sum(in_house_bouts) from public.club_rankings_current where season='ALL')<>4138 then
    raise exception 'Club normalization projection failed';
  end if;
end $$;
commit;
`;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/production-rollout.ts")) {
  process.stdout.write(productionRollout());
}
