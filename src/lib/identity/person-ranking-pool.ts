/** Row of current_person_cohort_strength: a cohort row plus its standing (null fields when unrated). */
export type PoolRow = { athlete_key: string; athlete_name: string; team: string; evidence_date: string;
  age_group: string | null; bracket_weight_lbs: number | string | null; strength_rated: boolean;
  strength_score: number | string | null; cohort_rank: number | null; cohort_size: number | null;
  cohort_tier: number | null; tier_unavailable_reason: string | null; strength_weight_band: string | null;
  strength_bracket_weight_lbs: number | string | null };

export type PoolStrengthRow = { athlete_key: string; strength_score: number | string; cohort_rank: number;
  cohort_size: number; cohort_tier: number | null; tier_unavailable_reason: string | null;
  weight_band: string; age_group: string; bracket_weight_lbs: number | string };

/** Split single-pass rows into the cohort rows and the rated-only standing rows the profile builder expects
 * (the same rows current_person_cohorts and current_person_strength returned separately). */
export function splitPoolRows(rows: PoolRow[]) {
  const cohorts = rows.map(row => ({ athlete_key: row.athlete_key, athlete_name: row.athlete_name, team: row.team,
    age_group: row.age_group, bracket_weight_lbs: row.bracket_weight_lbs, evidence_date: row.evidence_date }));
  const strength: PoolStrengthRow[] = rows.filter(row => row.strength_rated).map(row => ({
    athlete_key: row.athlete_key, strength_score: row.strength_score as number | string,
    cohort_rank: row.cohort_rank as number, cohort_size: row.cohort_size as number, cohort_tier: row.cohort_tier,
    tier_unavailable_reason: row.tier_unavailable_reason, weight_band: row.strength_weight_band as string,
    age_group: row.age_group as string, bracket_weight_lbs: row.strength_bracket_weight_lbs as number | string }));
  return { cohorts, strength };
}
