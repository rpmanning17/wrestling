import { parseAgeGroup, parseBracketWeight } from "./rating/outcomes";

/** Only bracket-specific evidence may label an individual bout. A wrestler's current age cohort is not proof of a past bracket. */
export type BoutAgeEvidence = {
  source_match_id?: string | null;
  event_date: string;
  event_name: string;
  athlete_name: string;
  age_group: string | null;
  bracket_weight_lbs: string | number | null;
  confidence_label: string;
};

type BoutForAge = {
  id: string;
  event_date: string;
  event_name: string;
  weight_class: string;
  winner_name: string;
  loser_name: string;
};

const key = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const confirmedAge = (value: string | null) => {
  const match = /^(6|8|10|12|14|16|18)U$/i.exec(value?.trim() ?? "");
  return match ? `${match[1]}U` : null;
};

export function ageGroupForBout(bout: BoutForAge, evidence: readonly BoutAgeEvidence[]): string | null {
  // Source brackets with an explicit age label outrank inferred or old cohort evidence.
  const label = parseAgeGroup(bout.weight_class);
  if (label) return label;

  const ageSet = (rows: readonly BoutAgeEvidence[]) =>
    [...new Set(rows.map(row => confirmedAge(row.age_group)).filter((age): age is string => age != null))];

  const direct = ageSet(evidence.filter(row => row.source_match_id === bout.id
    && ["strong", "confirmed"].includes(row.confidence_label)));
  if (direct.length === 1) return direct[0];
  if (direct.length > 1) return null;

  const bracketWeight = parseBracketWeight(bout.weight_class);
  if (bracketWeight == null) return null;
  const participants = new Set([key(bout.winner_name), key(bout.loser_name)]);
  const candidates = ageSet(evidence.filter(row =>
    row.event_date === bout.event_date
    && key(row.event_name) === key(bout.event_name)
    && participants.has(key(row.athlete_name))
    && ["strong", "confirmed"].includes(row.confidence_label)
    && row.bracket_weight_lbs != null
    && Number(row.bracket_weight_lbs) === bracketWeight));
  // Contradictory same-day bracket evidence is ambiguous, not permission to guess.
  return candidates.length === 1 ? candidates[0] : null;
}
