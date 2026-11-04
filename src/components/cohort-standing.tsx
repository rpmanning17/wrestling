import { TIER_SEGMENTS, type CohortStanding as Standing } from "../lib/cohort-standing";

export function CohortTierIndicator({ tier, reason }: { tier: number | null; reason?: string | null }) {
  return <div className="cohort-tier">
    <p className="tier-caption"><strong>{tier == null ? "Cohort Tier unavailable" : `Cohort Tier ${tier}`}</strong></p>
    {tier == null ? <p className="metric-help">{reason || "At least 20 rated wrestlers and unambiguous cohort evidence are required."}</p> : <>
      <div className="tier-segments" role="img" aria-label={`Cohort Tier ${tier} of 10; Tier 1 strongest, Tier 10 weakest`}>
        {TIER_SEGMENTS.map((value) => <span key={value} aria-hidden="true" data-tier={value} className={value===tier ? "tier-segment selected" : "tier-segment"}>{value}</span>)}
      </div>
      <div className="tier-endpoints"><span>Tier 10 · Weakest</span><span>Tier 1 · Strongest</span></div>
      <p className="metric-help">Population deciles, not score bands. Equal ratings share a tier; ties can make groups uneven.</p>
    </>}
  </div>;
}

export function CohortStanding({ standing }: { standing: Standing }) {
  return <section className="cohort-standing" aria-label="Current cohort standing">
    <div className="cohort-strength"><span>Cohort Strength (0–1,000)</span><strong>{standing.strength == null ? "Unavailable" : standing.strength.toFixed(2)}</strong></div>
    <p className="cohort-context">{standing.latestAgeGroup && standing.weightBand ? `${standing.latestAgeGroup} · ${standing.weightBand}` : "Current cohort unavailable"}{standing.cohortRank != null && standing.cohortSize != null ? ` · #${standing.cohortRank} of ${standing.cohortSize}` : ""}</p>
    <CohortTierIndicator tier={standing.cohortTier} reason={standing.tierUnavailableReason} />
    <p className="metric-help">Relative to this observed cohort; not an absolute ability rating or match prediction.</p>
  </section>;
}
