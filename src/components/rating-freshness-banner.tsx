import "server-only";
import Link from "next/link";
import { configured, supabase } from "@/lib/supabase";
import { ratingFreshnessStatus, type ActiveRatingSnapshot } from "@/lib/rating/freshness";

/** No client key, privileged API, or heavyweight fingerprint scan.
 * Exact source-row count (not max date) detects new imports on an old event date.
 * This is a warning-only signal; count equality does not prove source/alias equality.
 */
export async function RatingFreshnessBanner() {
  if (!configured()) return null;
  const db = supabase();
  const [model, source] = await Promise.all([
    db.from("rating_models").select("matches_total,as_of_date,match_cutoff").eq("status", "active").limit(1).maybeSingle(),
    db.from("matches").select("id", { head: true, count: "exact" }),
  ]);
  const status = ratingFreshnessStatus(
    (model.data as ActiveRatingSnapshot | null) ?? null,
    source.count,
    !!model.error || !!source.error,
  );

  if (status.kind === "count_matches") return null;
  if (status.kind === "unavailable") {
    return <aside className="rating-freshness-banner rating-freshness-unavailable" role="status">
      Rating source freshness could not be checked. Displayed ratings may not include the latest imported results.
    </aside>;
  }
  return <aside className="rating-freshness-banner" role="status">
    <strong>{status.kind === "no_model" ? "Ratings not calculated" : "Ratings need recalculation"}</strong>
    <span>{status.kind === "no_model"
      ? `${status.sourceCount.toLocaleString("en-US")} source bouts are recorded, but no opponent-adjusted model is active.`
      : `${status.sourceCount.toLocaleString("en-US")} source bouts are recorded; the active model was calculated from ${status.ratedCount.toLocaleString("en-US")} on ${status.asOfDate}. Current results and ratings may disagree until a new model is validated and activated.`}
    </span>
    <Link href="/results">View results</Link>
  </aside>;
}
