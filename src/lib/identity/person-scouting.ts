import "server-only";
import { supabase } from "@/lib/supabase";
import { type PowerRating, type WrestlerProfile, type WrestlerRef, type WrestlerSuggestion } from "@/lib/scouting-types";
import { likelihoodExplanation, likelihoodScore } from "@/lib/scoring";
import { headToHead, commonOpponents, type Bout } from "@/lib/rating/relations";
import { classifyMethod, CONTESTED_BY_DEFAULT } from "@/lib/rating/outcomes";
import { ageGroupForBout, type BoutAgeEvidence } from "@/lib/bout-age";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ORLANDO_CITIES = new Set(["altamonte springs", "apopka", "clermont", "kissimmee", "lake mary",
  "longwood", "maitland", "ocoee", "orlando", "oviedo", "sanford", "st cloud", "winter garden",
  "winter park", "winter springs"]);
const number = (value: number | string | null | undefined) => value == null ? null : Number(value);
type PersonRow = { id: string; display_name: string };
type MatchRow = { id: string; event_date: string; event_name: string; city: string; weight_class: string;
  winner_name: string; winner_team: string; winner_person_id: string | null;
  loser_name: string; loser_team: string; loser_person_id: string | null; result: string; win_type: string };
type EntryRow = { id: number; event_date: string; event_name: string; city: string; athlete_name: string;
  team: string; age_group: string; bracket_weight_lbs: number | string; division_label: string;
  experience_division: string; placement: number | null; confidence: string };
type ObservationRow = { id: number; event_date: string; event_name: string; city: string; athlete_name: string;
  team: string; age_group: string | null; bracket_weight_lbs: number | string | null;
  bracket_weight_label: string; division_label: string; placement: number; confidence: string };
type CohortRow = { athlete_key: string; age_group: string | null; bracket_weight_lbs: number | string | null;
  team: string; evidence_date: string };
type StrengthRow = { athlete_key: string; strength_score: number | string; cohort_rank: number;
  cohort_size: number; cohort_tier: number | null; tier_unavailable_reason: string | null;
  weight_band: string; age_group: string; bracket_weight_lbs: number | string };
type RatingRow = { model_version: string; as_of_date: string; rating: number | string;
  rating_deviation: number | string; conservative_score: number | string; rating_status: PowerRating["status"];
  match_count: number; avg_opponent_rating: number | string | null; sos_expected_win_pct: number | string | null;
  quality_wins: number; quality_losses: number; pin_pct: number | string | null; bonus_pct: number | string | null;
  win_methods: Record<string, number>; loss_methods: Record<string, number>; avg_win_margin: number | string | null;
  avg_loss_margin: number | string | null; rating_trend: number | string | null };

async function allMatches(ids: string[], side: "winner" | "loser") {
  const output: MatchRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase().rpc("person_match_history", { person_ids: ids, match_side: side })
      .select("id,event_date,event_name,city,weight_class,winner_name,winner_team,winner_person_id,loser_name,loser_team,loser_person_id,result,win_type")
      .order("event_date", { ascending: false })
      .order("id", { ascending: true }).range(from, from + 999);
    if (error) throw new Error("Resolved match history unavailable");
    if (!Array.isArray(data)) throw new Error("Resolved match history returned an invalid response");
    const rows = data as MatchRow[];
    output.push(...rows);
    if (rows.length < 1000) break;
  }
  return output;
}

export async function findPeople(rawQuery: string): Promise<WrestlerSuggestion[]> {
  const query = rawQuery.trim().slice(0, 100);
  if (query.length < 2) return [];
  const term = normalize(query).split(" ").filter(part => part.length >= 2).sort((a, b) => b.length - a.length)[0] ?? query;
  const db = supabase();
  const [direct, variants] = await Promise.all([
    db.from("wrestler_people").select("id,display_name").ilike("display_name", `%${term}%`).limit(100),
    db.from("source_identity_current_rows").select("person_id,recorded_name")
      .ilike("recorded_name", `%${term}%`).not("person_id", "is", null).limit(500),
  ]);
  if (direct.error || variants.error) throw new Error("Person search unavailable");
  const ids = new Set<string>((direct.data ?? []).map(row => row.id));
  const variantNames = new Map<string, string[]>();
  for (const row of variants.data ?? []) {
    if (!row.person_id) continue;
    ids.add(row.person_id);
    const list = variantNames.get(row.person_id) ?? [];
    list.push(row.recorded_name);
    variantNames.set(row.person_id, list);
  }
  if (!ids.size) return [];
  const [people, cohorts] = await Promise.all([
    db.from("wrestler_people").select("id,display_name").in("id", [...ids]),
    db.rpc("person_cohorts_by_ids", { person_ids: [...ids] })
      .select("athlete_key,age_group,bracket_weight_lbs,team,evidence_date"),
  ]);
  if (people.error || cohorts.error) throw new Error("Person search unavailable");
  const cohort = new Map(((cohorts.data ?? []) as CohortRow[]).map(row => [row.athlete_key, row]));
  return ((people.data ?? []) as PersonRow[]).map(person => {
    const alternate = variantNames.get(person.id) ?? [];
    const exact = [person.display_name, ...alternate].some(name => normalize(name) === normalize(query));
    const includes = [person.display_name, ...alternate].some(name => normalize(name).includes(normalize(query)));
    const row = cohort.get(person.id);
    return { name: person.display_name, personId: person.id, team: row?.team || undefined,
      ageGroup: row?.age_group ?? undefined, weight: number(row?.bracket_weight_lbs) ?? undefined,
      evidence: alternate.some(name => name !== person.display_name) ? "Recorded under multiple spellings" : "Resolved wrestler",
      matchScore: exact ? 100 : includes ? 80 : 50 };
  }).sort((a, b) => b.matchScore - a.matchScore || a.name.localeCompare(b.name) || a.personId.localeCompare(b.personId)).slice(0, 8);
}

function power(row: RatingRow | undefined): PowerRating | null {
  if (!row) return null;
  return { modelVersion: row.model_version, asOfDate: row.as_of_date, rating: Number(row.rating),
    rd: Number(row.rating_deviation), conservative: Number(row.conservative_score), status: row.rating_status,
    matchCount: row.match_count, avgOpponentRating: number(row.avg_opponent_rating),
    sosExpectedWinPct: number(row.sos_expected_win_pct), qualityWins: row.quality_wins,
    qualityLosses: row.quality_losses, pinPct: number(row.pin_pct), bonusPct: number(row.bonus_pct),
    winMethods: row.win_methods, lossMethods: row.loss_methods,
    avgWinMargin: number(row.avg_win_margin), avgLossMargin: number(row.avg_loss_margin), trend: number(row.rating_trend) };
}

async function loadResolvedPersonProfiles(refs: WrestlerRef[], knownCohorts?: CohortRow[]): Promise<WrestlerProfile[]> {
  const db = supabase();
  const ids = refs.map(ref => ref.personId).filter((id): id is string => Boolean(id && UUID.test(id)));
  if (ids.length !== refs.length) throw new Error("Select a resolved wrestler from search before viewing a person profile");
  const cohortsResult = knownCohorts ? { data: knownCohorts, error: null }
    : await db.rpc("person_cohorts_by_ids", { person_ids: ids })
      .select("athlete_key,age_group,bracket_weight_lbs,team,evidence_date");
  if (cohortsResult.error) throw new Error("Resolved profile classification unavailable");
  const ages = [...new Set(((cohortsResult.data ?? []) as CohortRow[])
    .flatMap(row => row.age_group?.match(/^(\d+)U$/)?.[1] ?? []).map(Number))];
  const standings = async () => {
    const results = await Promise.all(ages.map(age => db.rpc("current_person_strength", { target_age: age })
      .select("athlete_key,strength_score,cohort_rank,cohort_size,cohort_tier,tier_unavailable_reason,weight_band,age_group,bracket_weight_lbs")
      .in("athlete_key", ids)));
    return { data: results.flatMap(result => result.data ?? []), error: results.find(result => result.error)?.error };
  };
  const [peopleResult, strengthResult, ratingsResult, notesResult] = await Promise.all([
    db.from("wrestler_people").select("id,display_name").in("id", ids),
    standings(),
    db.from("person_rating_current").select("person_id,model_version,as_of_date,rating,rating_deviation,conservative_score,rating_status,match_count,avg_opponent_rating,sos_expected_win_pct,quality_wins,quality_losses,pin_pct,bonus_pct,win_methods,loss_methods,avg_win_margin,avg_loss_margin,rating_trend").in("person_id", ids),
    db.from("wrestler_notes").select("id,person_id,wrestler_key,body,client_id,created_at").in("person_id", ids).order("created_at", { ascending: false }).limit(500),
  ]);
  if (peopleResult.error || cohortsResult.error || strengthResult.error || ratingsResult.error || notesResult.error)
    throw new Error("Resolved profile data unavailable");
  const people = new Map(((peopleResult.data ?? []) as PersonRow[]).map(row => [row.id, row]));
  const cohorts = new Map(((cohortsResult.data ?? []) as CohortRow[]).map(row => [row.athlete_key, row]));
  const strength = new Map(((strengthResult.data ?? []) as StrengthRow[]).map(row => [row.athlete_key, row]));
  const ratings = new Map(((ratingsResult.data ?? []) as Array<RatingRow & { person_id: string }>).map(row => [row.person_id, row]));
  const [winnerMatches, loserMatches, entriesResult, observationsResult] = await Promise.all([
    allMatches(ids, "winner"), allMatches(ids, "loser"),
    db.from("person_tournament_entries").select("id,person_id,event_date,event_name,city,athlete_name,team,age_group,bracket_weight_lbs,division_label,experience_division,placement,confidence").in("person_id", ids).limit(1000),
    db.from("person_tournament_observations").select("id,person_id,event_date,event_name,city,athlete_name,team,age_group,bracket_weight_lbs,bracket_weight_label,division_label,placement,confidence").in("person_id", ids).limit(1000),
  ]);
  if (entriesResult.error || observationsResult.error) throw new Error("Resolved placements unavailable");
  const details = ids.map(id => ({ id,
    matches: [...new Map([...winnerMatches, ...loserMatches]
      .filter(row => row.winner_person_id === id || row.loser_person_id === id).map(row => [row.id, row])).values()],
    entries: ((entriesResult.data ?? []) as Array<EntryRow & { person_id: string }>).filter(row => row.person_id === id),
    observations: ((observationsResult.data ?? []) as Array<ObservationRow & { person_id: string }>).filter(row => row.person_id === id),
  }));
  const allBouts = [...new Map(details.flatMap(item => item.matches).map(row => [row.id, row])).values()];
  const recentRows = [...new Map(details.flatMap(item => item.matches.slice(0, 8)).map(row => [row.id, row])).values()];
  const recentNames = [...new Set(recentRows.flatMap(row => [row.winner_name, row.loser_name]))];
  const recentDates = [...new Set(recentRows.map(row => row.event_date))];
  const boutAgeResult = recentRows.length
    ? await db.from("wrestler_evidence")
      .select("source_match_id,event_date,event_name,athlete_name,age_group,bracket_weight_lbs,confidence_label")
      .in("athlete_name", recentNames).in("event_date", recentDates).limit(2500)
    : { data: [] };
  if ("error" in boutAgeResult && boutAgeResult.error) throw new Error("Bout age evidence unavailable");
  const boutAgeEvidence = (boutAgeResult.data ?? []) as BoutAgeEvidence[];
  const relations: Bout[] = allBouts.filter(row => row.winner_person_id && row.loser_person_id &&
    CONTESTED_BY_DEFAULT.includes(classifyMethod(row.win_type, row.result))).map(row => ({
      date: row.event_date, winnerKey: row.winner_person_id!, loserKey: row.loser_person_id!,
      winnerName: people.get(row.winner_person_id!)?.display_name ?? row.winner_name,
      loserName: people.get(row.loser_person_id!)?.display_name ?? row.loser_name,
    }));
  const display = new Map([...people].map(([id, row]) => [id, row.display_name]));
  return refs.map(ref => {
    const id = ref.personId!;
    const person = people.get(id);
    if (!person) throw new Error("Resolved wrestler no longer exists");
    const detail = details.find(item => item.id === id)!;
    const matches = detail.matches.sort((a, b) => b.event_date.localeCompare(a.event_date));
    const entries = detail.entries.sort((a, b) => b.event_date.localeCompare(a.event_date));
    const observations = detail.observations.sort((a, b) => b.event_date.localeCompare(a.event_date));
    const wins = matches.filter(row => row.winner_person_id === id).length;
    const losses = matches.filter(row => row.loser_person_id === id).length;
    const placements = [
      ...entries.map(row => ({ date: row.event_date, event: row.event_name, place: row.placement,
        ageGroup: row.age_group, division: row.division_label || row.experience_division,
        weight: Number(row.bracket_weight_lbs), weightLabel: String(row.bracket_weight_lbs), confidence: row.confidence })),
      ...observations.map(row => ({ date: row.event_date, event: row.event_name, place: row.placement,
        ageGroup: row.age_group, division: row.division_label, weight: number(row.bracket_weight_lbs),
        weightLabel: row.bracket_weight_label, confidence: row.confidence })),
    ].sort((a, b) => b.date.localeCompare(a.date));
    const cohort = cohorts.get(id);
    const standing = strength.get(id);
    const powerRating = power(ratings.get(id));
    const latestAgeGroup = cohort?.age_group ?? null;
    const latestWeight = number(cohort?.bracket_weight_lbs);
    const latestDate = [matches[0]?.event_date, entries[0]?.event_date, observations[0]?.event_date]
      .filter((date): date is string => Boolean(date)).sort().at(-1) ?? null;
    const eventIds = new Set([...matches, ...entries, ...observations].map(row => `${row.event_date}|${row.event_name}`));
    const orlando = new Set([...matches, ...entries, ...observations]
      .filter(row => ORLANDO_CITIES.has(normalize(row.city)))
      .map(row => `${row.event_date}|${row.event_name}`));
    const recent = [...eventIds].filter(value => value.slice(0, 10) >= "2026-08-01");
    const scoreInput = { wins, losses, decisiveWins: matches.filter(row => row.winner_person_id === id &&
      /^(f|fall|pin|tf|tech|md)$/i.test(row.win_type.trim())).length,
      latestDate, bestPlacement: placements.map(row => row.place).filter((value): value is number => value != null)
        .sort((a, b) => a - b)[0] ?? null, latestAgeGroup, latestWeight,
      orlandoAppearances: orlando.size, recentAppearances: recent.length, tournamentCount: eventIds.size,
      confirmedEvidence: entries.some(row => row.confidence === "confirmed") ||
        observations.some(row => row.confidence === "confirmed") };
    const otherIds = ids.filter(other => other !== id);
    const h2h = ids.length > 1 ? headToHead(relations, id, otherIds, display) : [];
    const common = ids.length > 1 ? commonOpponents(relations, id, otherIds, display) : [];
    const latestMatch = matches[0];
    const team = cohort?.team || entries[0]?.team || observations[0]?.team ||
      (latestMatch?.winner_person_id === id ? latestMatch?.winner_team : latestMatch?.loser_team) || ref.team;
    return { ...ref, personId: id, name: person.display_name, team: team || undefined, key: id,
      wins, losses, ratingSource: "opponent_adjusted" as const, powerRating,
      headToHead: h2h.map(row => ({ opponent: row.opponentName, wins: row.wins, losses: row.losses, lastDate: row.lastDate })),
      commonOpponents: common.flatMap(summary => summary.shared.map(row => ({ other: summary.otherName,
        opponent: row.opponentName, mine: row.mine, theirs: row.theirs }))),
      strength: standing ? Number(standing.strength_score) : null,
      strengthReason: standing && powerRating
        ? `${powerRating.rating.toFixed(0)} ± ${powerRating.rd.toFixed(0)} · ${powerRating.status} · #${standing.cohort_rank} of ${standing.cohort_size} in ${standing.age_group} ${standing.weight_band}`
        : powerRating ? `Rated ${powerRating.rating.toFixed(0)} ± ${powerRating.rd.toFixed(0)}, but no age/weight cohort evidence to rank within.`
          : "Unrated — no contested bouts in the rating model.",
      likelihood: likelihoodScore(scoreInput), likelihoodReason: likelihoodExplanation(scoreInput),
      latestAgeGroup, latestWeight, birthYearStart: null, birthYearEnd: null,
      cohortRank: standing?.cohort_rank ?? null, cohortSize: standing?.cohort_size ?? null,
      cohortTier: standing?.cohort_tier ?? null, tierUnavailableReason: standing?.tier_unavailable_reason ?? null,
      weightBand: standing?.weight_band ?? null,
      evidenceConfidence: scoreInput.confirmedEvidence ? "confirmed" as const : "limited" as const,
      latestDate,
      bouts: matches.slice(0, 8).map(row => ({ id: row.id, date: row.event_date, event: row.event_name,
        opponent: row.winner_person_id === id ? row.loser_name : row.winner_name,
        outcome: row.winner_person_id === id ? "W" as const : "L" as const,
        result: [row.win_type, row.result].filter(Boolean).join(" · "), weight: row.weight_class,
        ageGroup: ageGroupForBout(row, boutAgeEvidence) })),
      placements: placements.slice(0, 8),
      notes: ((notesResult.data ?? []) as Array<{ id: number; person_id: string; wrestler_key: string;
        body: string; client_id: string; created_at: string }>).filter(note => note.person_id === id)
        .map(note => ({ id: note.id, wrestlerKey: note.wrestler_key, body: note.body,
          clientId: note.client_id, createdAt: note.created_at })),
    };
  });
}

const unresolvedProfile = (ref: WrestlerRef): WrestlerProfile => ({
  ...ref, unknown: true, identityUnresolved: true, key: `unresolved:${normalize(ref.name)}`, wins: 0, losses: 0,
  ratingSource: "opponent_adjusted", powerRating: null, headToHead: [], commonOpponents: [],
  strength: null, strengthReason: "Choose a resolved wrestler from search to view a verified profile.",
  likelihood: 0, likelihoodReason: "Identity unresolved", latestAgeGroup: null, latestWeight: null,
  birthYearStart: null, birthYearEnd: null, cohortRank: null, cohortSize: null, cohortTier: null,
  tierUnavailableReason: "Identity unresolved", weightBand: null, evidenceConfidence: "limited",
  latestDate: null, bouts: [], placements: [], notes: [],
});

export async function buildPersonProfiles(refs: WrestlerRef[], knownCohorts?: CohortRow[]): Promise<WrestlerProfile[]> {
  const resolved = await Promise.all(refs.map(async ref => {
    if (ref.personId && UUID.test(ref.personId)) return ref;
    if (ref.unknown) return ref;
    const candidates = (await findPeople(ref.name)).filter(candidate => normalize(candidate.name) === normalize(ref.name));
    return candidates.length === 1 ? { ...ref, personId: candidates[0].personId } : ref;
  }));
  const valid = resolved.filter(ref => ref.personId && UUID.test(ref.personId));
  const profiles = valid.length ? await loadResolvedPersonProfiles(valid, knownCohorts) : [];
  const byId = new Map(profiles.map(profile => [profile.personId, profile]));
  return resolved.map(ref => ref.personId && byId.has(ref.personId)
    ? byId.get(ref.personId)! : unresolvedProfile(ref));
}

export async function personRankingPools() {
  const { data, error } = await supabase().rpc("current_person_cohorts", { target_age: 12 })
    .select("athlete_key,athlete_name,team,age_group,bracket_weight_lbs,evidence_date")
    .eq("age_group", "12U").gte("bracket_weight_lbs", 65).lte("bracket_weight_lbs", 80)
    .order("evidence_date", { ascending: false }).limit(120);
  if (error) throw new Error("Person cohort classification unavailable");
  const refs = ((data ?? []) as Array<{ athlete_key: string; athlete_name: string; team: string }>).map(row =>
    ({ personId: row.athlete_key, name: row.athlete_name, team: row.team }));
  const profiles = await buildPersonProfiles(refs, (data ?? []) as CohortRow[]);
  return { likelyProfiles: [...profiles].sort((a, b) => b.likelihood - a.likelihood).slice(0, 6),
    strongestProfiles: profiles.filter(profile => profile.latestWeight != null && Math.floor(profile.latestWeight / 10) === 7)
      .sort((a, b) => (b.strength ?? -1) - (a.strength ?? -1)) };
}
