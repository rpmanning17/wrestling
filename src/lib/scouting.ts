import "server-only";

import { supabase } from "@/lib/supabase";
import {
  likelihoodExplanation,
  likelihoodScore,
} from "@/lib/scoring";
import type {
  PlacementSummary,
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
  const query = validName(rawQuery);
  if (query.length < 2) return [];
  const db = supabase();
  const token = normalize(query)
    .split(" ")
    .filter((part) => part.length >= 2)
    .sort((a, b) => b.length - a.length)[0] ?? normalize(query);

  const [matchResult, entryResult, evidenceResult, observationResult] = await Promise.all([
    db
      .from("matches")
      .select("winner_name,winner_team,loser_name,loser_team,event_date")
      .ilike("search_text", `%${token.replace(/[%_]/g, "")}%`)
      .order("event_date", { ascending: false })
      .limit(120),
    db
      .from("tournament_entries")
      .select("athlete_name,team,age_group,bracket_weight_lbs,event_date")
      .ilike("athlete_name", `%${token.replace(/[%_]/g, "")}%`)
      .order("event_date", { ascending: false })
      .limit(80),
    db
      .from("wrestler_evidence")
      .select("athlete_name,team,age_group,bracket_weight_lbs,confidence_label,event_date")
      .ilike("athlete_name", `%${token.replace(/[%_]/g, "")}%`)
      .order("event_date", { ascending: false })
      .limit(100),
    db
      .from("tournament_observations")
      .select("athlete_name,team,division_label,bracket_weight_label,placement,event_date,identity_resolution")
      .ilike("athlete_name", `%${token.replace(/[%_]/g, "")}%`)
      .neq("identity_resolution", "placeholder")
      .order("event_date", { ascending: false })
      .limit(100),
  ]);

  const found = new Map<string, { name: string; team: string; evidence: string; score: number }>();
  const add = (name: string, team: string, evidence: string) => {
    const score = nameMatchScore(query, name);
    if (score < 35) return;
    const key = wrestlerKey(name);
    const existing = found.get(key);
    if (!existing || score > existing.score) found.set(key, { name, team, evidence, score });
  };

  for (const row of (matchResult.data ?? []) as Pick<MatchRow, "winner_name" | "winner_team" | "loser_name" | "loser_team">[]) {
    add(row.winner_name, row.winner_team, "Recorded match history");
    add(row.loser_name, row.loser_team, "Recorded match history");
  }
  for (const row of (entryResult.data ?? []) as Array<Pick<EntryRow, "athlete_name" | "team" | "age_group" | "bracket_weight_lbs">>) {
    add(row.athlete_name, row.team, `${row.age_group} · ${Number(row.bracket_weight_lbs)} lb entry`);
  }
  for (const row of (evidenceResult.data ?? []) as Array<Pick<EvidenceRow, "athlete_name" | "team" | "age_group" | "bracket_weight_lbs" | "confidence_label">>) {
    add(row.athlete_name, row.team, `${row.age_group} · ${Number(row.bracket_weight_lbs)} lb · ${row.confidence_label} evidence`);
  }
  for (const row of (observationResult.data ?? []) as Array<Pick<ObservationRow, "athlete_name" | "team" | "division_label" | "bracket_weight_label" | "placement">>) {
    add(row.athlete_name, row.team, `${row.division_label} · ${row.bracket_weight_label} bracket · placed ${row.placement}`);
  }

  if (normalize(query).includes("nolan")) {
    found.set("nolan", {
      name: "Nolan",
      team: "Alpha",
      evidence: "12U open · 69 lb now · projected 71 lb",
      score: normalize(query) === "nolan" ? 100 : 85,
    });
  }

  return [...found.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((item) => ({
      name: item.name,
      team: item.team || undefined,
      evidence: item.evidence,
      matchScore: item.score,
    }));
}

const newest = (dates: Array<string | null>) => dates.filter(Boolean).sort().at(-1) ?? null;
const parseWeight = (value: string) => {
  const matches = value.match(/\d+(?:\.\d+)?/g);
  if (!matches?.length) return null;
  const numbers = matches.map(Number).filter((number) => number >= 40 && number <= 400);
  return numbers.length ? numbers.at(-1)! : null;
};

export async function buildProfiles(refs: WrestlerRef[]): Promise<WrestlerProfile[]> {
  const cleanRefs = refs
    .map((ref) => ({ ...ref, name: validName(ref.name) }))
    .filter((ref) => ref.name)
    .slice(0, 120);
  if (!cleanRefs.length) return [];

  const names = [...new Set(cleanRefs.filter((ref) => !ref.unknown && wrestlerKey(ref.name) !== "nolan").map((ref) => ref.name))];
  const keys = cleanRefs.map((ref) => wrestlerKey(ref.name));
  const db = supabase();
  const empty = { data: [] as unknown[] };

  const [winsResult, lossesResult, entriesResult, observationsResult, evidenceResult, ratingsResult, notesResult] = await Promise.all([
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
      ? db.from("wrestler_evidence").select("athlete_name,team,event_date,event_name,city,age_group,division_birth_year_start,division_birth_year_end,experience_division,bracket_weight_lbs,confidence_score,confidence_label,evidence_type,reason").in("athlete_name", names).order("event_date", { ascending: false }).limit(2500)
      : empty,
    names.length
      ? db.from("wrestler_ratings").select("athlete_name,age_group,division_birth_year_start,division_birth_year_end,weight_bucket,weight_band,bracket_weight_lbs,evidence_date,confidence_score,strength_score,cohort_rank,cohort_size,wins,losses,best_placement,decisive_wins").in("athlete_name", names).limit(1000)
      : empty,
    db.from("wrestler_notes").select("id,wrestler_key,body,client_id,created_at").in("wrestler_key", keys).order("created_at", { ascending: false }).limit(500),
  ]);

  const matches = [...(winsResult.data ?? []), ...(lossesResult.data ?? [])] as MatchRow[];
  const uniqueMatches = [...new Map(matches.map((match) => [match.id, match])).values()];
  const entries = (entriesResult.data ?? []) as EntryRow[];
  const observations = (observationsResult.data ?? []) as ObservationRow[];
  const evidence = (evidenceResult.data ?? []) as EvidenceRow[];
  const ratings = (ratingsResult.data ?? []) as RatingRow[];
  const notes = (notesResult.data ?? []) as NoteRow[];

  return cleanRefs.map((ref) => {
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
    const requestedBucket = ref.weight == null ? null : Math.floor(ref.weight / 10) * 10;
    const cohortEvidence = wrestlerEvidence.filter((item) =>
      (!ref.ageGroup || item.age_group === ref.ageGroup)
      && (requestedBucket == null || Math.floor(Number(item.bracket_weight_lbs) / 10) * 10 === requestedBucket));
    const latestEvidence = cohortEvidence[0] ?? wrestlerEvidence[0];
    const latestMatchWeight = wrestlerMatches.map((match) => parseWeight(match.weight_class)).find((weight) => weight != null) ?? null;
    const isNolan = key === "nolan";
    const latestAgeGroup = ref.ageGroup || latestEvidence?.age_group || latestEntry?.age_group || (isNolan ? "12U" : null);
    const latestWeight = ref.weight ?? (latestEvidence ? Number(latestEvidence.bracket_weight_lbs) : latestEntry ? Number(latestEntry.bracket_weight_lbs) : latestMatchWeight) ?? (isNolan ? 71 : null);
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
    const rating = wrestlerRatings[0];
    const strength = rating ? Number(rating.strength_score) : null;
    const strengthReason = rating
      ? `${wins}-${losses} in ${wins + losses} recorded bouts · #${rating.cohort_rank} of ${rating.cohort_size} in ${rating.age_group} ${rating.weight_band}`
      : isNolan ? "Unrated — Nolan has no imported results yet." : "Unrated — no recorded bouts in a supported age/weight cohort.";
    const latestTeam = latestEvidence?.team || latestEntry?.team || latestObservation?.team || (normalize(wrestlerMatches[0]?.winner_name ?? "") === target ? wrestlerMatches[0]?.winner_team : wrestlerMatches[0]?.loser_team) || ref.team;
    const evidenceConfidence = latestEvidence?.confidence_label ?? (confirmedEvidence ? "confirmed" : latestAgeGroup || latestWeight ? "limited" : "limited");

    return {
      ...ref,
      name: isNolan ? "Nolan" : ref.name,
      team: latestTeam || undefined,
      key,
      wins,
      losses,
      strength: isNolan && wrestlerMatches.length === 0 ? null : strength,
      strengthReason,
      likelihood: likelihoodScore(scoreInput),
      likelihoodReason: likelihoodExplanation(scoreInput),
      latestAgeGroup,
      latestWeight,
      birthYearStart: rating?.division_birth_year_start ?? latestEvidence?.division_birth_year_start ?? null,
      birthYearEnd: rating?.division_birth_year_end ?? latestEvidence?.division_birth_year_end ?? null,
      cohortRank: rating?.cohort_rank ?? null,
      cohortSize: rating?.cohort_size ?? null,
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
  const { data } = await supabase()
    .from("wrestler_ratings")
    .select("athlete_name,team,strength_score,age_group,bracket_weight_lbs")
    .eq("age_group", "12U")
    .eq("weight_bucket", 70)
    .order("strength_score", { ascending: false })
    .limit(200);
  const refs = [...new Map(((data ?? []) as Array<{ athlete_name: string; team: string; age_group: string; bracket_weight_lbs: number | string }>).map((row) => [wrestlerKey(row.athlete_name), { name: row.athlete_name, team: row.team, ageGroup: row.age_group, weight: Number(row.bracket_weight_lbs) }])).values()];
  return (await buildProfiles(refs)).sort((a, b) => (b.strength ?? -1) - (a.strength ?? -1));
}

export async function likelyNolanPool() {
  const { data } = await supabase()
    .from("wrestler_evidence")
    .select("athlete_name,team,age_group,bracket_weight_lbs,confidence_score")
    .eq("age_group", "12U")
    .gte("bracket_weight_lbs", 65)
    .lte("bracket_weight_lbs", 80)
    .order("event_date", { ascending: false })
    .limit(800);
  const refs = [...new Map(((data ?? []) as Array<{ athlete_name: string; team: string; age_group: string; bracket_weight_lbs: number | string }>).map((row) => [wrestlerKey(row.athlete_name), { name: row.athlete_name, team: row.team, ageGroup: row.age_group, weight: Number(row.bracket_weight_lbs) }])).values()];
  return (await buildProfiles(refs)).sort((a, b) => b.likelihood - a.likelihood).slice(0, 6);
}
