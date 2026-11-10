import "server-only";
import { toCohortStanding, type CohortStanding, type CohortStandingRow } from "@/lib/cohort-standing";
import { supabase } from "@/lib/supabase";
import { personModelActive } from "@/lib/identity/read-mode";

/** A club's recorded matches are credited to the team represented AT THE EVENT.
 * Rating columns reflect the current active wrestler model, not past-season ratings.
 */
export type ClubSummary = {
  season: string;
  club_key: string;
  club_name: string;
  bouts: number;
  wins: number;
  losses: number;
  in_house_bouts: number;
  wrestlers: number;
  rated_wrestlers: number;
  avg_conservative: number | null;
  median_conservative: number | null;
  top_five_conservative: number | null;
  avg_rating_deviation: number | null;
  avg_opponent_rating: number | null;
  schedule_expected_win_pct: number | null;
};

export type ClubWrestler = {
  cohort: CohortStanding;
  athlete_key: string;
  athlete_name: string;
  bouts: number;
  wins: number;
  losses: number;
  rating: number | null;
  rating_deviation: number | null;
  conservative_score: number | null;
  sos_expected_win_pct: number | null;
  avg_opponent_rating: number | null;
  rating_status: string | null;
};

export const CLUB_SEASONS = ["ALL", "2026-2027", "2025-2026", "2024-2025"] as const;
export type ClubSeason = typeof CLUB_SEASONS[number];

export const CLUB_SORTS = {
  wrestlers: "Observed roster",
  bouts: "Recorded bouts",
  median_conservative: "Median Conservative Glicko Rating",
  top_five_conservative: "Top-five Conservative Glicko Rating",
  avg_conservative: "Average Conservative Glicko Rating",
  avg_opponent_rating: "Average Opponent Glicko Rating",
} as const;
export type ClubSort = keyof typeof CLUB_SORTS;

const client = () => supabase();
const nullableNumber = (value: number | string | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

function parseClub(row: Record<string, unknown>): ClubSummary {
  const n = (key: string) => Number(row[key] ?? 0);
  const opt = (key: string) => nullableNumber(row[key] as number | string | null | undefined);
  return {
    season: String(row.season ?? ""),
    club_key: String(row.club_key ?? ""),
    club_name: String(row.club_name ?? ""),
    bouts: n("bouts"),
    wins: n("wins"),
    losses: n("losses"),
    in_house_bouts: n("in_house_bouts"),
    wrestlers: n("wrestlers"),
    rated_wrestlers: n("rated_wrestlers"),
    avg_conservative: opt("avg_conservative"),
    median_conservative: opt("median_conservative"),
    top_five_conservative: opt("top_five_conservative"),
    avg_rating_deviation: opt("avg_rating_deviation"),
    avg_opponent_rating: opt("avg_opponent_rating"),
    schedule_expected_win_pct: opt("schedule_expected_win_pct"),
  };
}

export async function getClubs(
  season: ClubSeason,
  sort: ClubSort,
  query: string,
): Promise<{ clubs: ClubSummary[]; error: string | null }> {
  const personMode = await personModelActive();
  if (personMode) return getPersonClubs(season,sort,query);
  let request = client().from("club_rankings_current")
    .select("*")
    .eq("season", season)
    .gte("wrestlers", 1)
    .order(sort, { ascending: false, nullsFirst: false })
    .order("bouts", { ascending: false })
    .limit(200);
  const term = query.replace(/[%_,]/g, "").trim().slice(0, 80);
  if (term) request = request.ilike("club_name", `%${term}%`);
  const { data, error } = await request;
  if (error || !Array.isArray(data)) return { clubs: [], error: "Club analytics are not ready. The database migration may still need to be applied." };
  return { clubs: data.map((row: Record<string, unknown>) => parseClub(row)), error: null };
}

async function getPersonClubs(season: ClubSeason, sort: ClubSort, query: string) {
  let request = client().rpc("person_club_directory", { target_season: season, target_sort: sort })
    .select("club_key").order("sort_value", { ascending: false, nullsFirst: false })
    .order("bouts", { ascending: false }).limit(200);
  const term = query.replace(/[%_,]/g, "").trim().slice(0, 80);
  if (term) request = request.ilike("club_name", `%${term}%`);
  const directory = await request;
  if (directory.error || !Array.isArray(directory.data)) return { clubs: [], error: "Club directory unavailable. Try again." };
  const keys = (directory.data as Array<{ club_key: string }>).map(row => row.club_key);
  const summaries = new Map<string, ClubSummary>();
  // Keep both each query's source population and concurrent database work bounded.
  for (let from = 0; from < keys.length; from += 8) {
    const results = await Promise.all([keys.slice(from,from+4), keys.slice(from+4,from+8)]
      .filter(batch => batch.length).map(batch => client().rpc("person_club_rankings_for_keys", {
        target_season: season, target_keys: batch,
      }).select("*")));
    for (const result of results) {
      if (result.error || !Array.isArray(result.data)) return { clubs: [], error: "Complete club summaries unavailable. Try again." };
      for (const row of result.data as Array<Record<string, unknown>>) {
        const club = parseClub(row);
        if (summaries.has(club.club_key)) return { clubs: [], error: "Club summaries returned duplicate records." };
        summaries.set(club.club_key,club);
      }
    }
  }
  if (summaries.size !== keys.length || keys.some(key => !summaries.has(key)))
    return { clubs: [], error: "Club summaries were incomplete. Try again." };
  return { clubs: keys.map(key => summaries.get(key)!), error: null };
}

export async function getClub(
  key: string,
  season: ClubSeason,
): Promise<{ club: ClubSummary | null; wrestlers: ClubWrestler[]; aliases: string[]; error: string | null }> {
  const personMode = await personModelActive();
  const [clubQuery, rosterQuery, aliasQuery] = await Promise.all([
    (personMode ? client().rpc("person_club_rankings_for_season", { target_season: season, target_club: key })
      : client().from("club_rankings_current")).select("*").eq("club_key", key).eq("season", season).maybeSingle(),
    (personMode ? client().rpc("person_club_roster_for_season", { target_season: season, target_club: key })
      : client().from("club_roster_current")).select("athlete_key,athlete_name,bouts,wins,losses,rating,rating_deviation,conservative_score,sos_expected_win_pct,avg_opponent_rating,rating_status")
      .eq("club_key", key).eq("season", season).order("bouts", { ascending: false }).limit(150),
    client().from("club_aliases").select("alias_key").eq("club_key", key).order("alias_key"),
  ]);
  if (clubQuery.error || rosterQuery.error || !Array.isArray(rosterQuery.data)) return { club: null, wrestlers: [], aliases: [], error: "Club analytics are not ready." };
  const rosterRows = rosterQuery.data as Array<Omit<ClubWrestler, "cohort">>;
  const keys = rosterRows.map((row) => row.athlete_key);
  const cohortQuery = keys.length ? personMode ? await personRosterStandings(keys) : await client().from("wrestler_strength_current")
    .select("athlete_key,age_group,weight_band,strength_score,cohort_rank,cohort_size,cohort_tier,tier_unavailable_reason")
    .in("athlete_key", keys) : { data: [], error: null };
  if (cohortQuery.error) return { club: null, wrestlers: [], aliases: [], error: "Current cohort standings are unavailable. Try again." };
  const cohorts = new Map((cohortQuery.data ?? []).map((row) => [row.athlete_key, row as CohortStandingRow]));
  const wrestlers = rosterRows.map((row) => ({
    cohort: toCohortStanding(cohorts.get(row.athlete_key)),
    athlete_key: String(row.athlete_key),
    athlete_name: String(row.athlete_name),
    bouts: Number(row.bouts),
    wins: Number(row.wins),
    losses: Number(row.losses),
    rating: nullableNumber(row.rating),
    rating_deviation: nullableNumber(row.rating_deviation),
    conservative_score: nullableNumber(row.conservative_score),
    sos_expected_win_pct: nullableNumber(row.sos_expected_win_pct),
    avg_opponent_rating: nullableNumber(row.avg_opponent_rating),
    rating_status: row.rating_status ?? null,
  }));
  return {
    club: clubQuery.data ? parseClub(clubQuery.data as Record<string, unknown>) : null,
    wrestlers,
    aliases: (aliasQuery.data ?? []).map((alias) => alias.alias_key as string),
    error: null,
  };
}

async function personRosterStandings(keys: string[]) {
  const cohorts = await client().rpc("person_cohorts_by_ids", { person_ids: keys }).select("age_group");
  if (cohorts.error || !Array.isArray(cohorts.data)) return { data: [], error: cohorts.error ?? new Error("Invalid cohort response") };
  const ages = [...new Set((cohorts.data as Array<{ age_group: string | null }>).flatMap(row =>
    String(row.age_group ?? "").match(/^(\d+)U$/)?.[1] ?? []).map(Number))];
  const results = await Promise.all(ages.map(age => client().rpc("current_person_strength", { target_age: age })
    .select("athlete_key,age_group,weight_band,strength_score,cohort_rank,cohort_size,cohort_tier,tier_unavailable_reason")
    .in("athlete_key", keys)));
  return { data: results.flatMap(result => result.data ?? []), error: results.find(result => result.error)?.error };
}

export function clubHref(key: string, season: ClubSeason) {
  return `/clubs/${encodeURIComponent(key)}?season=${encodeURIComponent(season)}`;
}

export const fmt = (value: number | null, digits = 0): string =>
  value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);

export const matchPct = (wins: number, bouts: number): string =>
  bouts ? `${(100 * wins / bouts).toFixed(1)}%` : "—";
