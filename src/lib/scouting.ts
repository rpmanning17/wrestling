import "server-only";

import { supabase } from "@/lib/supabase";
import {
  likelihoodExplanation,
  likelihoodScore,
  strengthExplanation,
  strengthScore,
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
  age_group: string;
  experience_division: string;
  bracket_weight_lbs: number | string;
  placement: number | null;
  confidence: string;
};

type NoteRow = {
  id: number;
  wrestler_key: string;
  body: string;
  client_id: string;
  created_at: string;
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

  const [matchResult, entryResult] = await Promise.all([
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
    .slice(0, 8);
  if (!cleanRefs.length) return [];

  const names = [...new Set(cleanRefs.filter((ref) => !ref.unknown && wrestlerKey(ref.name) !== "nolan").map((ref) => ref.name))];
  const keys = cleanRefs.map((ref) => wrestlerKey(ref.name));
  const db = supabase();
  const empty = { data: [] as unknown[] };

  const [winsResult, lossesResult, entriesResult, notesResult] = await Promise.all([
    names.length
      ? db.from("matches").select("id,event_date,event_name,city,weight_class,winner_name,winner_team,loser_name,loser_team,result,win_type").in("winner_name", names).order("event_date", { ascending: false }).limit(1000)
      : empty,
    names.length
      ? db.from("matches").select("id,event_date,event_name,city,weight_class,winner_name,winner_team,loser_name,loser_team,result,win_type").in("loser_name", names).order("event_date", { ascending: false }).limit(1000)
      : empty,
    names.length
      ? db.from("tournament_entries").select("event_date,event_name,city,athlete_name,team,age_group,experience_division,bracket_weight_lbs,placement,confidence").in("athlete_name", names).order("event_date", { ascending: false }).limit(500)
      : empty,
    db.from("wrestler_notes").select("id,wrestler_key,body,client_id,created_at").in("wrestler_key", keys).order("created_at", { ascending: false }).limit(500),
  ]);

  const matches = [...(winsResult.data ?? []), ...(lossesResult.data ?? [])] as MatchRow[];
  const uniqueMatches = [...new Map(matches.map((match) => [match.id, match])).values()];
  const entries = (entriesResult.data ?? []) as EntryRow[];
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
    const wins = wrestlerMatches.filter((match) => normalize(match.winner_name) === target).length;
    const losses = wrestlerMatches.length - wins;
    const decisiveWins = wrestlerMatches.filter(
      (match) => normalize(match.winner_name) === target && /^(f|fall|pin|tf|tech|md)$/i.test(match.win_type.trim()),
    ).length;
    const placements: PlacementSummary[] = wrestlerEntries.map((entry) => ({
      date: entry.event_date,
      event: entry.event_name,
      place: entry.placement,
      ageGroup: entry.age_group,
      division: entry.experience_division,
      weight: Number(entry.bracket_weight_lbs),
      confidence: entry.confidence,
    }));
    const latestEntry = wrestlerEntries[0];
    const latestMatchWeight = wrestlerMatches.map((match) => parseWeight(match.weight_class)).find((weight) => weight != null) ?? null;
    const isNolan = key === "nolan";
    const latestAgeGroup = ref.ageGroup || latestEntry?.age_group || (isNolan ? "12U" : null);
    const latestWeight = ref.weight ?? (latestEntry ? Number(latestEntry.bracket_weight_lbs) : latestMatchWeight) ?? (isNolan ? 71 : null);
    const latestDate = newest([wrestlerMatches[0]?.event_date ?? null, latestEntry?.event_date ?? null]);
    const recentCutoff = "2026-08-01";
    const eventKeys = new Set([
      ...wrestlerMatches.map((match) => `${match.event_date}|${match.event_name}`),
      ...wrestlerEntries.map((entry) => `${entry.event_date}|${entry.event_name}`),
    ]);
    const orlandoKeys = new Set([
      ...wrestlerMatches.filter((match) => ORLANDO_CITIES.has(normalize(match.city))).map((match) => `${match.event_date}|${match.event_name}`),
      ...wrestlerEntries.filter((entry) => ORLANDO_CITIES.has(normalize(entry.city))).map((entry) => `${entry.event_date}|${entry.event_name}`),
    ]);
    const recentKeys = new Set([...eventKeys].filter((eventKey) => eventKey.slice(0, 10) >= recentCutoff));
    const confirmedEvidence = wrestlerEntries.some((entry) => entry.confidence === "confirmed");
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
    const latestTeam = latestEntry?.team || (normalize(wrestlerMatches[0]?.winner_name ?? "") === target ? wrestlerMatches[0]?.winner_team : wrestlerMatches[0]?.loser_team) || ref.team;

    return {
      ...ref,
      name: isNolan ? "Nolan" : ref.name,
      team: latestTeam || undefined,
      key,
      wins,
      losses,
      strength: isNolan && wrestlerMatches.length === 0 ? null : strengthScore(scoreInput),
      strengthReason: isNolan && wrestlerMatches.length === 0 ? "Unrated — Nolan has no imported results yet." : strengthExplanation(scoreInput),
      likelihood: likelihoodScore(scoreInput),
      likelihoodReason: likelihoodExplanation(scoreInput),
      latestAgeGroup,
      latestWeight,
      evidenceConfidence: confirmedEvidence ? "confirmed" : latestAgeGroup || latestWeight ? "derived" : "limited",
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
    .from("tournament_entries")
    .select("athlete_name,team")
    .eq("age_group", "12U")
    .eq("experience_division", "open")
    .in("bracket_weight_lbs", [70, 75])
    .order("event_date", { ascending: false })
    .limit(200);
  const refs = [...new Map(((data ?? []) as Array<{ athlete_name: string; team: string }>).map((row) => [wrestlerKey(row.athlete_name), { name: row.athlete_name, team: row.team }])).values()];
  return (await buildProfiles(refs)).sort((a, b) => (b.strength ?? -1) - (a.strength ?? -1));
}

