/** A deliberately narrow source-count check, NOT a claim of full input-fingerprint equality.
 * The active model was calculated from a frozen source snapshot. Imported/deleted bouts
 * change the count; edits and alias changes may not. Do not label equal counts "up to date".
 */
export type ActiveRatingSnapshot = {
  matches_total: number;
  as_of_date: string;
  match_cutoff: string | null;
};

export type RatingFreshnessStatus =
  | { kind: "no_model"; sourceCount: number }
  | { kind: "changed"; sourceCount: number; ratedCount: number; asOfDate: string }
  | { kind: "count_matches" }
  | { kind: "unavailable" };

export function ratingFreshnessStatus(
  active: ActiveRatingSnapshot | null,
  sourceCount: number | null,
  failed = false,
): RatingFreshnessStatus {
  if (failed || sourceCount == null || !Number.isSafeInteger(sourceCount) || sourceCount < 0) return { kind: "unavailable" };
  if (!active) return sourceCount > 0 ? { kind: "no_model", sourceCount } : { kind: "count_matches" };
  if (!Number.isSafeInteger(active.matches_total) || active.matches_total < 0) return { kind: "unavailable" };
  if (sourceCount !== active.matches_total) {
    return { kind: "changed", sourceCount, ratedCount: active.matches_total, asOfDate: active.as_of_date };
  }
  return { kind: "count_matches" };
}
