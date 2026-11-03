import Link from "next/link";
import { strongestPool } from "@/lib/scouting";

export const dynamic = "force-dynamic";

export default async function RankingsPage() {
  const profiles = await strongestPool();
  return (
    <main className="page-shell rankings-page">
      <div className="page-title"><span className="eyebrow">SCOUTING POOL</span><h1>Strongest list</h1><p>12U open wrestlers with confirmed 70 or 75 lb entry evidence. Scores use imported results, placements, recent form, decisive wins, and sample reliability.</p></div>
      <div className="ranking-note"><strong>0–1000 rating</strong><span>Transparent estimate, not an official ranking.</span><Link href="/">Compare a bracket</Link></div>
      <ol className="ranking-list">
        {profiles.map((profile) => <li key={profile.key}><span className="ranking-position">{String(profiles.indexOf(profile) + 1).padStart(2, "0")}</span><div><h2>{profile.name}</h2><p>{profile.team || "Team not recorded"} · {profile.latestAgeGroup || "Age unknown"} · {profile.latestWeight ? `${profile.latestWeight} lb` : "Weight unknown"}</p><small>{profile.strengthReason}</small></div><strong className="ranking-score">{profile.strength?.toFixed(2) ?? "Unrated"}</strong></li>)}
      </ol>
      {!profiles.length && <section className="empty-state"><h2>No ranked wrestlers found.</h2><p>Import 12U open 70/75 lb entry evidence to populate this list.</p></section>}
    </main>
  );
}

