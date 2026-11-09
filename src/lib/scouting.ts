import "server-only";
import { personModelActive } from "@/lib/identity/read-mode";
import { buildPersonProfiles, findPeople, personRankingPools } from "@/lib/identity/person-scouting";
import { toCohortStanding } from "@/lib/cohort-standing";

import { supabase } from "@/lib/supabase";
import {
  likelihoodExplanation,
  likelihoodScore,
} from "@/lib/scoring";
import { classifyMethod, CONTESTED_BY_DEFAULT, parseAgeGroup, parseBracketWeight } from "@/lib/rating/outcomes";
import { ageGroupForBout } from "@/lib/bout-age";
import { commonOpponents, headToHead, type Bout } from "@/lib/rating/relations";
import type {
  PlacementSummary,
  PowerRating,
  RatingStatus,
  WrestlerProfile,
  WrestlerRef,
  WrestlerSuggestion,
} from "@/lib/scouting-types";
import { wrestlerKey } from "@/lib/scouting-types";

type MatchRow = {
  id: string;
  event_date: string;
  event_name: string;
  city: string;
  weight_class: string;
  winner_name: string;
  winner_team: string;
  loser_name: string;
  loser_team: string;
  result: string;
  win_type: string;
};

type EntryRow = {
  event_date: string;
  event_name: string;
  city: string;
  athlete_name: string;
  team: string;
  division_label: string;
  age_group: string;
  experience_division: string;
  bracket_weight_lbs: number | string;
  placement: number | null;
  confidence: string;
};

type ObservationRow = {
  event_date: string;
  event_name: string;
  city: string;
  athlete_name: string;
  team: string;
  division_label: string;
  age_group: string | null;
  experience_division: string | null;
  school_level: string | null;
  bracket_weight_label: string;
  bracket_weight_lbs: number | string | null;
  placement: number;
  confidence: string;
  identity_resolution: "exact_existing" | "new_identity" | "ambiguous" | "placeholder";
};

type NoteRow = {
  id: number;
  wrestler_key: string;
  body: string;
  client_id: string;
  created_at: string;
};

type EvidenceRow = {
  athlete_name: string;
  team: string;
  event_date: string;
  event_name: string;
  city: string;
  age_group: string;
  division_birth_year_start: number;
  division_birth_year_end: number;
  experience_division: string | null;
  bracket_weight_lbs: number | string;
  confidence_score: number;
  confidence_label: "confirmed" | "strong" | "moderate" | "limited";
  evidence_type: string;
  reason: string;
};

type RatingRow = {
  athlete_name: string;
  age_group: string;
  division_birth_year_start: number;
  division_birth_year_end: number;
  weight_bucket: number;
  weight_band: string;
  bracket_weight_lbs: number | string;
  evidence_date: string;
  confidence_score: number;
  strength_score: number | string;
  cohort_rank: number;
  cohort_size: number;
  wins: number;
  losses: number;
  best_placement: number | null;
  decisive_wins: number;
};

/** Row of public.wrestler_rating_current (active versioned model; migration 202611030009). */
type PowerRow = {
  athlete_key: string;
  model_version: string;
  as_of_date: string;
  rating: number | string;
  rating_deviation: number | string;
  conservative_score: number | string;
  rating_status: RatingStatus;
  match_count: number;
  avg_opponent_rating: number | string | null;
  sos_expected_win_pct: number | string | null;
  quality_wins: number;
  quality_losses: number;
  pin_pct: number | string | null;
  bonus_pct: number | string | null;
  win_methods: Record<string, number> | null;
  loss_methods: Record<string, number> | null;
  avg_win_margin: number | string | null;
  avg_loss_margin: number | string | null;
  rating_trend: number | string | null;
};

/** Authoritative age/weight estimate, independent of the active rating model. */
type CurrentCohortRow = {
  athlete_key: string;
  age_group: string | null;
  bracket_weight_lbs: number | string | null;
};

type CohortStrengthRow = {
  athlete_key: string;
  bracket_weight_lbs: number | string;
  athlete_name: string;
  age_group: string;
  weight_bucket: number;
  weight_band: string;
  evidence_date: string;
  confidence_score: number;
  strength_score: number | string;
  cohort_rank: number;
  cohort_size: number;
  cohort_tier: number | null;
  tier_unavailable_reason: string | null;
  division_birth_year_start: number;
  division_birth_year_end: number;
};

const num = (value: number | string | null | undefined) => (value == null ? null : Number(value));
const identity = (name: string) => name.trim().toLowerCase(); // matches SQL lower(trim()) used by the rating tables

function toPowerRating(row: PowerRow): PowerRating {
  return {
    modelVersion: row.model_version,
    asOfDate: row.as_of_date,
    rating: Number(row.rating),
    rd: Number(row.rating_deviation),
    conservative: Number(row.conservative_score),
    status: row.rating_status,
    matchCount: row.match_count,
    avgOpponentRating: num(row.avg_opponent_rating),
    sosExpectedWinPct: num(row.sos_expected_win_pct),
    qualityWins: row.quality_wins,
    qualityLosses: row.quality_losses,
    pinPct: num(row.pin_pct),
    bonusPct: num(row.bonus_pct),
    winMethods: row.win_methods ?? {},
    lossMethods: row.loss_methods ?? {},
    avgWinMargin: num(row.avg_win_margin),
    avgLossMargin: num(row.avg_loss_margin),
    trend: num(row.rating_trend),
  };
}

type AliasRow = {
  alias_key: string;
  alias_name: string;
  canonical_name: string;
};

const ORLANDO_CITIES = new Set([
  "altamonte springs",
  "apopka",
  "clermont",
  "kissimmee",
  "lake mary",
  "longwood",
  "maitland",
  "ocoee",
  "orlando",
  "oviedo",
  "sanford",
  "st cloud",
  "st. cloud",
  "winter garden",
  "winter park",
  "winter springs",
]);

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const validName = (value: string) => value.trim().replace(/\s+/g, " ").slice(0, 100);

function editDistance(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return rows[a.length][b.length];
}

function nameMatchScore(query: string, candidate: string) {
  const q = normalize(query);
  const c = normalize(candidate);
  if (q === c) return 100;
  if (c.includes(q) || q.includes(c)) return 90;
  const qTokens = q.split(" ");
  const cTokens = c.split(" ");
  const tokenHits = qTokens.filter((token) => cTokens.some((other) => other.includes(token) || token.includes(other))).length;
  const similarity = 1 - editDistance(q, c) / Math.max(q.length, c.length, 1);
  return Math.round(Math.max(similarity * 80, (tokenHits / Math.max(1, qTokens.length)) * 75));
}

export async function findWrestlers(rawQuery: string): Promise<WrestlerSuggestion[]> {
  if (await personModelActive()) return findPeople(rawQuery);
  const query = validName(rawQuery);
  if (query.length < 2) return [];
  const db = supabase();
  const token = normalize(query)
    .split(" ")
    .filter((part) => part.length >= 2)
    .sort((a, b) => b.length - a.length)[0] ?? normalize(query);
  const searchToken = token.replace(/[%_]/g, "");

  const [matchResult, entryResult, evidenceResult, observationResult, aliasResult] = await Promise.all([
    db.from("matches")
      .select("winner_name,winner_team,loser_name,loser_team,event_date,weight_class")
      .ilike("search_text", "%" + searchToken + "%")
      .order("event_date", { ascending: false }).limit(120),
    db.from("tournament_entries")
      .select("athlete_name,team,age_group,bracket_weight_lbs,event_date")
      .ilike("athlete_name", "%" + searchToken + "%")
      .order("event_date", { ascending: false }).limit(80),
    db.from("wrestler_evidence")
      .select("athlete_name,team,age_group,bracket_weight_lbs,confidence_label,event_date")
      .ilike("athlete_name", "%" + searchToken + "%")
      .order("event_date", { ascending: false }).limit(100),
    db.from("tournament_observations")
      .select("athlete_name,team,division_label,age_group,bracket_weight_lbs,bracket_weight_label,placement,event_date,identity_resolution")
      .ilike("athlete_name", "%" + searchToken + "%")
      .neq("identity_resolution", "placeholder")
      .order("event_date", { ascending: false }).limit(100),
    db.from("wrestler_aliases").select("alias_key,alias_name,canonical_name")
      .ilike("alias_name", "%" + searchToken + "%").limit(30),
  ]);

  // Search names are kept canonical where an explicit reviewed alias exists.
  // Never merge people merely because they share a name, club, or weight.
  const aliases = new Map<string, string>(((aliasResult.data ?? []) as AliasRow[])
    .map((row): [string, string] => [wrestlerKey(row.alias_name), row.canonical_name]));

  type Candidate = {
    name: string; team: string; ageGroup?: string; weight?: number;
    evidence: string; score: number;
    teamDate: string; ageDate: string; weightDate: string;
  };
  const found = new Map<string, Candidate>();
  const bracketWeight = (value: unknown): number | undefined => {
    if (value == null || value === "") return undefined;
    const number = Number(value);
    return Number.isFinite(number) && number >= 30 && number <= 400 ? number : undefined;
  };
  const add = (
    sourceName: string, team: string | null | undefined, evidence: string,
    date = "", ageGroup?: string | null, weight?: number,
  ) => {
    if (!sourceName) return;
    const name = aliases.get(wrestlerKey(sourceName)) || sourceName.trim();
    const score = Math.max(nameMatchScore(query, sourceName), nameMatchScore(query, name));
    if (score < 35) return;
    const key = wrestlerKey(name);
    let candidate = found.get(key);
    if (!candidate) {
      candidate = { name, team: "", evidence, score, teamDate: "", ageDate: "", weightDate: "" };
      found.set(key, candidate);
    }
    if (score > candidate.score) {
      candidate.score = score;
      candidate.evidence = evidence;
    }
    if (team?.trim() && (!candidate.team || date >= candidate.teamDate)) {
      candidate.team = team.trim();
      candidate.teamDate = date;
    }
    if (ageGroup?.trim() && (!candidate.ageGroup || date >= candidate.ageDate)) {
      candidate.ageGroup = ageGroup.trim();
      candidate.ageDate = date;
    }
    if (weight !== undefined && (!candidate.weight || date >= candidate.weightDate)) {
      candidate.weight = weight;
      candidate.weightDate = date;
    }
  };

  for (const row of (matchResult.data ?? []) as Array<Pick<MatchRow,
    "winner_name" | "winner_team" | "loser_name" | "loser_team" | "event_date" | "weight_class">>) {
    const age = parseAgeGroup(row.weight_class);
    const weight = parseBracketWeight(row.weight_class) ?? undefined;
    add(row.winner_name, row.winner_team, "Recorded match", row.event_date, age, weight);
    add(row.loser_name, row.loser_team, "Recorded match", row.event_date, age, weight);
  }
  for (const row of (entryResult.data ?? []) as Array<Pick<EntryRow,
    "athlete_name" | "team" | "age_group" | "bracket_weight_lbs" | "event_date">>) {
    add(row.athlete_name, row.team, "Tournament entry", row.event_date, row.age_group, bracketWeight(row.bracket_weight_lbs));
  }
  for (const row of (evidenceResult.data ?? []) as Array<Pick<EvidenceRow,
    "athlete_name" | "team" | "age_group" | "bracket_weight_lbs" | "event_date">>) {
    add(row.athlete_name, row.team, "Age and weight evidence", row.event_date, row.age_group, bracketWeight(row.bracket_weight_lbs));
  }
  for (const row of (observationResult.data ?? []) as Array<Pick<ObservationRow,
    "athlete_name" | "team" | "age_group" | "bracket_weight_lbs" | "bracket_weight_label" | "event_date">>) {
    add(row.athlete_name, row.team, "Tournament observation", row.event_date,
      row.age_group, bracketWeight(row.bracket_weight_lbs) ?? parseBracketWeight(row.bracket_weight_label) ?? undefined);
  }
  for (const row of (aliasResult.data ?? []) as AliasRow[]) {
    add(row.alias_name, "", "Also listed as " + row.alias_name);
  }

  // Nolan is not yet in the imported match results. Keep his manually supplied
  // information distinct from inferred tournament bracket weight.
  if (normalize(query) === "nolan") {
    found.set("nolan", {
      name: "Nolan", team: "Alpha", ageGroup: "12U", weight: 69,
      evidence: "Owner-supplied weight; not an imported tournament result",
      score: 100, teamDate: "", ageDate: "", weightDate: "",
    });
  }

  const cohortResult = await db.from("wrestler_cohort_current")
    .select("athlete_key,age_group,bracket_weight_lbs")
    .in("athlete_key", [...found.values()].map((item) => identity(item.name)));
  if (cohortResult.error) throw new Error("Current cohort classification unavailable");
  const cohorts = new Map(((cohortResult.data ?? []) as CurrentCohortRow[]).map((row) => [row.athlete_key, row]));
  for (const item of found.values()) {
    if (item.evidence.startsWith("Owner-supplied")) continue;
    const cohort = cohorts.get(identity(item.name));
    item.ageGroup = cohort?.age_group ?? undefined;
    item.weight = num(cohort?.bracket_weight_lbs) ?? undefined;
  }
  return [...found.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((item) => ({
      name: item.name,
      team: item.team || undefined,
      ageGroup: item.ageGroup,
      weight: item.weight,
      evidence: item.evidence,
      matchScore: item.score,
    }));
}

const newest = (dates: Array<string | null>) => dates.filter(Boolean).sort().at(-1) ?? null;
export async function buildProfiles(refs: WrestlerRef[], knownCohorts?: CurrentCohortRow[]): Promise<WrestlerProfile[]> {
  if (await personModelActive()) return buildPersonProfiles(refs);
  const cleanRefs = refs
    .map((ref) => ({ ...ref, name: validName(ref.name) }))
    .filter((ref) => ref.name)
    .slice(0, 120);
  if (!cleanRefs.length) return [];

  const db = supabase();
  const requestedKeys = cleanRefs.map((ref) => normalize(ref.name));
  const { data: aliasData } = await db
    .from("wrestler_aliases")
    .select("alias_key,alias_name,canonical_name")
    .in("alias_key", requestedKeys);
  const aliases = new Map(((aliasData ?? []) as AliasRow[]).map((row) => [row.alias_key, row.canonical_name]));
  const resolvedRefs = cleanRefs.map((ref) => {
    const canonicalName = aliases.get(normalize(ref.name));
    return canonicalName ? { ...ref, name: canonicalName } : ref;
  });
  const names = [...new Set(resolvedRefs.filter((ref) => !ref.unknown && wrestlerKey(ref.name) !== "nolan").map((ref) => ref.name))];
  const keys = resolvedRefs.map((ref) => wrestlerKey(ref.name));
  const empty = { data: [] as unknown[] };

  const ratingKeys = [...new Set(names.map(identity))];
  const [winsResult, lossesResult, entriesResult, observationsResult, evidenceResult, ratingsResult, notesResult, activeModelResult, powerResult, cohortResult] = await Promise.all([
    names.length
      ? db.from("matches").select("id,event_date,event_name,city,weight_class,winner_name,winner_team,loser_name,loser_team,result,win_type").in("winner_name", names).order("event_date", { ascending: false }).limit(1000)
      : empty,
    names.length
      ? db.from("matches").select("id,event_date,event_name,city,weight_class,winner_name,winner_team,loser_name,loser_team,result,win_type").in("loser_name", names).order("event_date", { ascending: false }).limit(1000)
      : empty,
    names.length
      ? db.from("tournament_entries").select("event_date,event_name,city,athlete_name,team,division_label,age_group,experience_division,bracket_weight_lbs,placement,confidence").in("athlete_name", names).order("event_date", { ascending: false }).limit(500)
      : empty,
    names.length
      ? db.from("tournament_observations").select("event_date,event_name,city,athlete_name,team,division_label,age_group,experience_division,school_level,bracket_weight_label,bracket_weight_lbs,placement,confidence,identity_resolution").in("athlete_name", names).neq("identity_resolution", "placeholder").order("event_date", { ascending: false }).limit(1000)
      : empty,
    names.length
      ? db.from("wrestler_evidence").select("athlete_name,team,event_date,event_name,city,age_group,division_birth_year_start,division_birth_year_end,experience_division,bracket_weight_lbs,confidence_score,confidence_label,evidence_type,reason,source_match_id").in("athlete_name", names).order("event_date", { ascending: false }).limit(2500)
      : empty,
    names.length
      ? db.from("wrestler_ratings").select("athlete_name,age_group,division_birth_year_start,division_birth_year_end,weight_bucket,weight_band,bracket_weight_lbs,evidence_date,confidence_score,strength_score,cohort_rank,cohort_size,wins,losses,best_placement,decisive_wins").in("athlete_name", names).limit(1000)
      : empty,
    db.from("wrestler_notes").select("id,wrestler_key,body,client_id,created_at").in("wrestler_key", keys).order("created_at", { ascending: false }).limit(500),
    // Opponent-adjusted model. Errors (view not migrated yet) are tolerated: the legacy view is the fallback.
    db.from("wrestler_rating_current").select("model_version").limit(1),
    ratingKeys.length
      ? db.from("wrestler_rating_current").select("athlete_key,model_version,as_of_date,rating,rating_deviation,conservative_score,rating_status,match_count,avg_opponent_rating,sos_expected_win_pct,quality_wins,quality_losses,pin_pct,bonus_pct,win_methods,loss_methods,avg_win_margin,avg_loss_margin,rating_trend").in("athlete_key", ratingKeys)
      : empty,
    names.length
      ? db.from("wrestler_strength_current").select("athlete_key,athlete_name,bracket_weight_lbs,age_group,weight_bucket,weight_band,evidence_date,confidence_score,strength_score,cohort_rank,cohort_size,cohort_tier,tier_unavailable_reason,division_birth_year_start,division_birth_year_end").in("athlete_key", ratingKeys).limit(1000)
      : empty,
  ]);
  if ("error" in cohortResult && cohortResult.error) throw new Error("Current cohort standing unavailable. Try again.");
  const currentCohorts: CurrentCohortRow[] = knownCohorts ?? ((cohortResult.data ?? []) as CohortStrengthRow[]).map((row) => ({
    athlete_key: row.athlete_key, age_group: row.age_group, bracket_weight_lbs: row.bracket_weight_lbs,
  }));
  const missingCohortKeys = ratingKeys.filter((key) => !currentCohorts.some((row) => row.athlete_key === key));
  if (missingCohortKeys.length) {
    const missing = await db.from("wrestler_cohort_current").select("athlete_key,age_group,bracket_weight_lbs").in("athlete_key", missingCohortKeys);
    if (missing.error) throw new Error("Current cohort classification unavailable. Try again.");
    currentCohorts.push(...(missing.data ?? []) as CurrentCohortRow[]);
  }
  // A model counts as active only if the view answered without error and returned a row.
  const modelActive = !("error" in activeModelResult && activeModelResult.error) && ((activeModelResult.data as unknown[] | null) ?? []).length > 0;
  const powerRows = modelActive ? ((powerResult.data ?? []) as PowerRow[]) : [];
  const cohortRows = modelActive ? ((cohortResult.data ?? []) as CohortStrengthRow[]) : [];

  const matches = [...(winsResult.data ?? []), ...(lossesResult.data ?? [])] as MatchRow[];
  const uniqueMatches = [...new Map(matches.map((match) => [match.id, match])).values()];
  const entries = (entriesResult.data ?? []) as EntryRow[];
  const observations = (observationsResult.data ?? []) as ObservationRow[];
  const evidence = (evidenceResult.data ?? []) as EvidenceRow[];
  const ratings = (ratingsResult.data ?? []) as RatingRow[];
  const notes = (notesResult.data ?? []) as NoteRow[];

  // Head-to-head and common opponents only make sense for a handful of wrestlers (the comparison view),
  // and use the same contested-bout definition as the rating model.
  const withRelations = resolvedRefs.length > 1 && resolvedRefs.length <= 8;
  const relationBouts: Bout[] = withRelations
    ? uniqueMatches
        .filter((match) => CONTESTED_BY_DEFAULT.includes(classifyMethod(match.win_type, match.result)))
        .map((match) => ({
          date: match.event_date,
          winnerKey: normalize(match.winner_name),
          loserKey: normalize(match.loser_name),
          winnerName: match.winner_name,
          loserName: match.loser_name,
        }))
    : [];
  const displayNames = new Map(resolvedRefs.map((ref) => [normalize(ref.name), ref.name]));

  return resolvedRefs.map((ref) => {
    const key = wrestlerKey(ref.name);
    const target = normalize(ref.name);
    const wrestlerMatches = uniqueMatches
      .filter((match) => normalize(match.winner_name) === target || normalize(match.loser_name) === target)
      .sort((a, b) => b.event_date.localeCompare(a.event_date));
    const wrestlerEntries = entries
      .filter((entry) => normalize(entry.athlete_name) === target)
      .sort((a, b) => b.event_date.localeCompare(a.event_date));
    const wrestlerObservations = observations
      .filter((observation) => normalize(observation.athlete_name) === target)
      .sort((a, b) => b.event_date.localeCompare(a.event_date));
    const wrestlerEvidence = evidence
      .filter((item) => normalize(item.athlete_name) === target)
      .sort((a, b) => b.event_date.localeCompare(a.event_date) || b.confidence_score - a.confidence_score);
    const wins = wrestlerMatches.filter((match) => normalize(match.winner_name) === target).length;
    const losses = wrestlerMatches.length - wins;
    const decisiveWins = wrestlerMatches.filter(
      (match) => normalize(match.winner_name) === target && /^(f|fall|pin|tf|tech|md)$/i.test(match.win_type.trim()),
    ).length;
    const entryPlacements: PlacementSummary[] = wrestlerEntries.map((entry) => ({
      date: entry.event_date,
      event: entry.event_name,
      place: entry.placement,
      ageGroup: entry.age_group,
      division: entry.division_label || entry.experience_division,
      weight: Number(entry.bracket_weight_lbs),
      weightLabel: String(Number(entry.bracket_weight_lbs)),
      confidence: entry.confidence,
    }));
    const observedPlacements: PlacementSummary[] = wrestlerObservations.map((observation) => ({
      date: observation.event_date,
      event: observation.event_name,
      place: observation.placement,
      ageGroup: observation.age_group,
      division: observation.division_label,
      weight: observation.bracket_weight_lbs == null ? null : Number(observation.bracket_weight_lbs),
      weightLabel: observation.bracket_weight_label,
      confidence: observation.identity_resolution === "ambiguous" ? "identity review" : observation.confidence,
    }));
    const placements = [...new Map(
      [...entryPlacements, ...observedPlacements].map((placement) => [
        `${placement.date}|${placement.event}|${placement.division}|${placement.weightLabel}|${placement.place ?? "entry"}`,
        placement,
      ]),
    ).values()];
    const latestEntry = wrestlerEntries[0];
    const latestEvidence = wrestlerEvidence[0];
    const currentCohort = currentCohorts.find((row) => row.athlete_key === identity(ref.name));
    const isNolan = key === "nolan";
    const latestAgeGroup = currentCohort?.age_group ?? (isNolan ? "12U" : null);
    const latestWeight = num(currentCohort?.bracket_weight_lbs) ?? (isNolan ? 71 : null);
    const latestObservation = wrestlerObservations[0];
    const latestDate = newest([wrestlerMatches[0]?.event_date ?? null, latestEvidence?.event_date ?? null, latestEntry?.event_date ?? null, latestObservation?.event_date ?? null]);
    const recentCutoff = "2026-08-01";
    const eventKeys = new Set([
      ...wrestlerMatches.map((match) => `${match.event_date}|${match.event_name}`),
      ...wrestlerEntries.map((entry) => `${entry.event_date}|${entry.event_name}`),
      ...wrestlerEvidence.map((item) => `${item.event_date}|${item.event_name}`),
      ...wrestlerObservations.map((item) => `${item.event_date}|${item.event_name}`),
    ]);
    const orlandoKeys = new Set([
      ...wrestlerMatches.filter((match) => ORLANDO_CITIES.has(normalize(match.city))).map((match) => `${match.event_date}|${match.event_name}`),
      ...wrestlerEntries.filter((entry) => ORLANDO_CITIES.has(normalize(entry.city))).map((entry) => `${entry.event_date}|${entry.event_name}`),
      ...wrestlerEvidence.filter((item) => ORLANDO_CITIES.has(normalize(item.city))).map((item) => `${item.event_date}|${item.event_name}`),
      ...wrestlerObservations.filter((item) => ORLANDO_CITIES.has(normalize(item.city))).map((item) => `${item.event_date}|${item.event_name}`),
    ]);
    const recentKeys = new Set([...eventKeys].filter((eventKey) => eventKey.slice(0, 10) >= recentCutoff));
    const confirmedEvidence = wrestlerEvidence.some((item) => item.confidence_label === "confirmed") || wrestlerEntries.some((entry) => entry.confidence === "confirmed") || wrestlerObservations.some((item) => item.confidence === "confirmed");
    const scoreInput = {
      wins,
      losses,
      decisiveWins,
      latestDate,
      bestPlacement: placements.map((placement) => placement.place).filter((place): place is number => place != null).sort((a, b) => a - b)[0] ?? null,
      latestAgeGroup,
      latestWeight,
      orlandoAppearances: orlandoKeys.size,
      recentAppearances: recentKeys.size,
      tournamentCount: eventKeys.size,
      confirmedEvidence,
    };
    const desiredBucket = latestWeight == null ? null : Math.floor(latestWeight / 10) * 10;
    const wrestlerRatings = ratings
      .filter((rating) => normalize(rating.athlete_name) === target)
      .sort((a, b) => {
        const aFit = (latestAgeGroup === a.age_group ? 2 : 0) + (desiredBucket === a.weight_bucket ? 1 : 0);
        const bFit = (latestAgeGroup === b.age_group ? 2 : 0) + (desiredBucket === b.weight_bucket ? 1 : 0);
        return bFit - aFit || b.evidence_date.localeCompare(a.evidence_date) || b.confidence_score - a.confidence_score;
      });
    const legacyRating = wrestlerRatings[0];
    // Opponent-adjusted model (when one is active): power rating plus cohort rank/0-1000 display.
    const powerRow = modelActive ? powerRows.find((row) => row.athlete_key === identity(ref.name)) : undefined;
    const powerRating = powerRow ? toPowerRating(powerRow) : null;
    const cohortRow = modelActive ? cohortRows.find((row) =>
      normalize(row.athlete_name) === target && row.age_group === latestAgeGroup && row.weight_bucket === desiredBucket) : undefined;
    const rating = modelActive ? cohortRow : legacyRating;
    const strength = rating ? Number(rating.strength_score) : null;
    const strengthReason = modelActive
      ? cohortRow && powerRating
        ? `${powerRating.rating.toFixed(0)} ± ${powerRating.rd.toFixed(0)} · ${powerRating.status} · #${cohortRow.cohort_rank} of ${cohortRow.cohort_size} in ${cohortRow.age_group} ${cohortRow.weight_band}`
        : powerRating
          ? `Rated ${powerRating.rating.toFixed(0)} ± ${powerRating.rd.toFixed(0)}, but no age/weight cohort evidence to rank within.`
          : isNolan ? "Unrated — Nolan has no imported results yet." : "Unrated — no contested bouts in the rating model."
      : legacyRating
        ? `${wins}-${losses} in ${wins + losses} recorded bouts · #${legacyRating.cohort_rank} of ${legacyRating.cohort_size} in ${legacyRating.age_group} ${legacyRating.weight_band}`
        : isNolan ? "Unrated — Nolan has no imported results yet." : "Unrated — no recorded bouts in a supported age/weight cohort.";
    const otherKeys = withRelations ? resolvedRefs.map((other) => normalize(other.name)).filter((other) => other !== target) : [];
    const h2h = withRelations ? headToHead(relationBouts, target, otherKeys, displayNames) : [];
    const common = withRelations ? commonOpponents(relationBouts, target, otherKeys, displayNames) : [];
    const latestTeam = latestEvidence?.team || latestEntry?.team || latestObservation?.team || (normalize(wrestlerMatches[0]?.winner_name ?? "") === target ? wrestlerMatches[0]?.winner_team : wrestlerMatches[0]?.loser_team) || ref.team;
    const evidenceConfidence = latestEvidence?.confidence_label ?? (confirmedEvidence ? "confirmed" : latestAgeGroup || latestWeight ? "limited" : "limited");

    return {
      ...ref,
      name: isNolan ? "Nolan" : ref.name,
      team: latestTeam || undefined,
      key,
      wins,
      losses,
      ratingSource: modelActive ? "opponent_adjusted" as const : "legacy" as const,
      powerRating,
      headToHead: h2h.map((line) => ({ opponent: line.opponentName, wins: line.wins, losses: line.losses, lastDate: line.lastDate })),
      commonOpponents: common.flatMap((summary) =>
        summary.shared.map((line) => ({ other: summary.otherName, opponent: line.opponentName, mine: line.mine, theirs: line.theirs }))),
      strength: isNolan && wrestlerMatches.length === 0 ? null : strength,
      strengthReason,
      likelihood: likelihoodScore(scoreInput),
      likelihoodReason: likelihoodExplanation(scoreInput),
      latestAgeGroup,
      latestWeight,
      birthYearStart: null,
      birthYearEnd: null,
      cohortRank: rating?.cohort_rank ?? null,
      cohortSize: rating?.cohort_size ?? null,
      cohortTier: toCohortStanding(cohortRow).cohortTier,
      tierUnavailableReason: toCohortStanding(cohortRow).tierUnavailableReason,
      weightBand: rating?.weight_band ?? null,
      evidenceConfidence,
      latestDate,
      bouts: wrestlerMatches.slice(0, 8).map((match) => {
        const won = normalize(match.winner_name) === target;
        return {
          id: match.id,
          date: match.event_date,
          event: match.event_name,
          opponent: won ? match.loser_name : match.winner_name,
          outcome: won ? "W" as const : "L" as const,
          result: [match.win_type, match.result].filter(Boolean).join(" · "),
          weight: match.weight_class,
          ageGroup: ageGroupForBout(match, wrestlerEvidence),
        };
      }),
      placements: placements.slice(0, 8),
      notes: notes
        .filter((note) => note.wrestler_key === key)
        .map((note) => ({ id: note.id, wrestlerKey: note.wrestler_key, body: note.body, clientId: note.client_id, createdAt: note.created_at })),
    };
  });
}

export async function strongestPool() {
  // Active opponent-adjusted model first; the legacy heuristic view is the fallback.
  const adjusted = await supabase()
    .from("wrestler_strength_current")
    .select("athlete_name,team,strength_score,age_group,bracket_weight_lbs")
    .eq("age_group", "12U")
    .eq("weight_bucket", 70)
    .order("conservative_score", { ascending: false })
    .limit(200);
  const active = await supabase().from("wrestler_rating_current").select("model_version").limit(1);
  if (!adjusted.error && ((adjusted.data ?? []).length || (active.data ?? []).length)) {
    const rows = adjusted.data as Array<{ athlete_name: string; team: string; age_group: string; bracket_weight_lbs: number | string }>;
    const refs = [...new Map(rows.map((row) => [wrestlerKey(row.athlete_name), { name: row.athlete_name, team: row.team, ageGroup: row.age_group, weight: Number(row.bracket_weight_lbs) }])).values()];
    return (await buildProfiles(refs)).filter((p) => p.latestAgeGroup === "12U" && p.latestWeight != null && Math.floor(p.latestWeight / 10) === 7).sort((a, b) => (b.strength ?? -1) - (a.strength ?? -1));
  }
  const { data } = await supabase()
    .from("wrestler_ratings")
    .select("athlete_name,team,strength_score,age_group,bracket_weight_lbs")
    .eq("age_group", "12U")
    .eq("weight_bucket", 70)
    .order("strength_score", { ascending: false })
    .limit(200);
  const refs = [...new Map(((data ?? []) as Array<{ athlete_name: string; team: string; age_group: string; bracket_weight_lbs: number | string }>).map((row) => [wrestlerKey(row.athlete_name), { name: row.athlete_name, team: row.team, ageGroup: row.age_group, weight: Number(row.bracket_weight_lbs) }])).values()];
  return (await buildProfiles(refs)).filter((p) => p.latestAgeGroup === "12U" && p.latestWeight != null && Math.floor(p.latestWeight / 10) === 7).sort((a, b) => (b.strength ?? -1) - (a.strength ?? -1));
}

export async function likelyNolanPool() {
  const { data } = await supabase()
    .from("wrestler_cohort_current")
    .select("athlete_name,team,age_group,bracket_weight_lbs")
    .eq("age_group", "12U")
    .gte("bracket_weight_lbs", 65)
    .lte("bracket_weight_lbs", 80)
    .order("evidence_date", { ascending: false })
    .limit(800);
  const refs = [...new Map(((data ?? []) as Array<{ athlete_name: string; team: string; age_group: string; bracket_weight_lbs: number | string }>).map((row) => [wrestlerKey(row.athlete_name), { name: row.athlete_name, team: row.team, ageGroup: row.age_group, weight: Number(row.bracket_weight_lbs) }])).values()];
  return (await buildProfiles(refs)).filter((p) => p.latestAgeGroup === "12U" && p.latestWeight != null && p.latestWeight >= 65 && p.latestWeight <= 80).sort((a, b) => b.likelihood - a.likelihood).slice(0, 6);
}

/** Both ranking lists share their candidate and classification snapshot. */
export async function rankingPools() {
  if (await personModelActive()) return personRankingPools();
  const { data, error } = await supabase().from("wrestler_cohort_current")
    .select("athlete_key,athlete_name,team,age_group,bracket_weight_lbs")
    .eq("age_group", "12U").gte("bracket_weight_lbs", 65).lte("bracket_weight_lbs", 80)
    .order("evidence_date", { ascending: false }).limit(120);
  if (error) throw new Error("Current ranking classification unavailable");
  const rows = (data ?? []) as Array<CurrentCohortRow & { athlete_name: string; team: string }>;
  const profiles = await buildProfiles(rows.map((row) => ({ name: row.athlete_name, team: row.team })), rows);
  return {
    likelyProfiles: [...profiles].sort((a,b) => b.likelihood-a.likelihood).slice(0,6),
    strongestProfiles: profiles.filter((p) => p.latestWeight != null && Math.floor(p.latestWeight/10) === 7)
      .sort((a,b) => (b.strength ?? -1)-(a.strength ?? -1)),
  };
}
