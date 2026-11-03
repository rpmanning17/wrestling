import Link from "next/link";
import { likelyNolanPool, strongestPool } from "@/lib/scouting";

export const dynamic = "force-dynamic";

export default async function RankingsPage() {
  const [likelyProfiles, strongestProfiles] = await Promise.all([likelyNolanPool(), strongestPool()]);
  return (
    <main className="page-shell rankings-page">
      <div className="page-title"><span className="eyebrow">SCOUTING POOL</span><h1>Most likely for Nolan</h1><p>Six current-season 12U wrestlers with 65–80 lb evidence, ordered by weight fit, recent activity, Orlando-area appearances, and evidence confidence.</p></div>
      <div className="ranking-note"><strong>0–1000 score</strong><span>Strength is scaled within each age/weight cohort; matchup likelihood also considers local activity.</span><Link href="/">Compare a bracket</Link></div>
      <ol className="ranking-list">
        {likelyProfiles.map((profile, index) => <li key={profile.key}><span className="ranking-position">{String(index + 1).padStart(2, "0")}</span><div><h2>{profile.name}</h2><p>{profile.team || "Team not recorded"} · {profile.latestAgeGroup || "Age unknown"} · {profile.latestWeight ? `${profile.latestWeight} lb` : "Weight unknown"}</p><small>{profile.likelihoodReason}</small></div><strong className="ranking-score">{profile.likelihood.toFixed(2)}</strong></li>)}
      </ol>
      {!likelyProfiles.length && <section className="empty-state"><h2>No likely opponents found.</h2><p>Import 12U open age and weight evidence to populate this list.</p></section>}

      <details className="strongest-section">
        <summary>View full strongest list</summary>
        <p>All rated 12U wrestlers in the 70–79 lb cohort, statewide. The cohort’s current strongest is 1000 and its lowest is 0; Orlando proximity does not affect strength.</p>
        <ol className="ranking-list">
          {strongestProfiles.map((profile, index) => <li key={profile.key}><span className="ranking-position">{String(index + 1).padStart(2, "0")}</span><div><h2>{profile.name}</h2><p>{profile.team || "Team not recorded"} · {profile.latestAgeGroup || "Age unknown"} · {profile.latestWeight ? `${profile.latestWeight} lb` : "Weight unknown"}</p><small>{profile.strengthReason}</small></div><strong className="ranking-score">{profile.strength?.toFixed(2) ?? "Unrated"}</strong></li>)}
        </ol>
      </details>
    </main>
  );
}
