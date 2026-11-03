import "server-only";
import { supabase } from "@/lib/supabase";

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
};

export type ClubWrestler = {
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
  median_conservative: "Typical wrestler strength",
  top_five_conservative: "Top five strength",
  avg_conservative: "Average strength",
  avg_opponent_rating: "Opponent strength (SOS)",
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
  };
}

export async function getClubs(
  season: ClubSeason,
  sort: ClubSort,
  query: string,
): Promise<{ clubs: ClubSummary[]; error: string | null }> {
  let request = client()
    .from("club_rankings_current")
    .select("*")
    .eq("season", season)
    .gte("wrestlers", 1)
    .order(sort, { ascending: false, nullsFirst: false })
    .order("bouts", { ascending: false })
    .limit(200);
  const term = query.replace(/[%_,]/g, "").trim().slice(0, 80);
  if (term) request = request.ilike("club_name", `%${term}%`);
  const { data, error } = await request;
  if (error) return { clubs: [], error: "Club analytics are not ready. The database migration may still need to be applied." };
  return { clubs: (data ?? []).map((row) => parseClub(row as Record<string, unknown>)), error: null };
}

export async function getClub(
  key: string,
  season: ClubSeason,
): Promise<{ club: ClubSummary | null; wrestlers: ClubWrestler[]; aliases: string[]; error: string | null }> {
  const [clubQuery, rosterQuery, aliasQuery] = await Promise.all([
    client().from("club_rankings_current").select("*").eq("club_key", key).eq("season", season).maybeSingle(),
    client().from("club_roster_current").select("athlete_key,athlete_name,bouts,wins,losses,rating,rating_deviation,conservative_score,sos_expected_win_pct,avg_opponent_rating,rating_status")
      .eq("club_key", key).eq("season", season).order("bouts", { ascending: false }).limit(150),
    client().from("club_aliases").select("alias_key").eq("club_key", key).order("alias_key"),
  ]);
  if (clubQuery.error || rosterQuery.error) return { club: null, wrestlers: [], aliases: [], error: "Club analytics are not ready." };
  const wrestlers = (rosterQuery.data ?? []).map((row) => ({
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

export function clubHref(key: string, season: ClubSeason) {
  return `/clubs/${encodeURIComponent(key)}?season=${encodeURIComponent(season)}`;
}

export const fmt = (value: number | null, digits = 0): string =>
  value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);

export const matchPct = (wins: number, bouts: number): string =>
  bouts ? `${(100 * wins / bouts).toFixed(1)}%` : "—";
