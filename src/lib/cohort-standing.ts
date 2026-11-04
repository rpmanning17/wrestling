export type CohortStanding = {
  strength: number | null;
  cohortRank: number | null;
  cohortSize: number | null;
  cohortTier: number | null;
  tierUnavailableReason: string | null;
  latestAgeGroup: string | null;
  weightBand: string | null;
};

export type CohortStandingRow = {
  age_group: string;
  weight_band: string;
  strength_score: number | string;
  cohort_rank: number;
  cohort_size: number;
  cohort_tier: number | null;
  tier_unavailable_reason: string | null;
};

/** Mapping only. Population/rank/tier math lives exclusively in the database view. */
export function toCohortStanding(row?: CohortStandingRow | null): CohortStanding {
  return {
    strength: row ? Number(row.strength_score) : null,
    cohortRank: row?.cohort_rank ?? null,
    cohortSize: row?.cohort_size ?? null,
    cohortTier: row?.cohort_tier ?? null,
    tierUnavailableReason: row?.tier_unavailable_reason ?? (row ? null : "An active rating and sufficient age/weight evidence are required."),
    latestAgeGroup: row?.age_group ?? null,
    weightBand: row?.weight_band ?? null,
  };
}

export const TIER_SEGMENTS = [10,9,8,7,6,5,4,3,2,1] as const;
export const schedulePercent = (value: number | null) => value == null ? "Unavailable" : `${(value*100).toFixed(0)}%`;
