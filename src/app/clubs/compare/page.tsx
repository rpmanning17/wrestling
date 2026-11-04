import Link from "next/link";
import { schedulePercent } from "@/lib/cohort-standing";
import { CLUB_SEASONS, clubHref, fmt, getClub, getClubs, matchPct, type ClubSeason, type ClubSummary } from "@/lib/clubs";

export const dynamic = "force-dynamic";

export default async function CompareClubsPage({ searchParams }: {
  searchParams: Promise<{ a?: string; b?: string; season?: string }>;
}) {
  const query = await searchParams;
  const season: ClubSeason = CLUB_SEASONS.includes(query.season as ClubSeason) ? query.season as ClubSeason : "ALL";
  const { clubs, error } = await getClubs(season, "wrestlers", "");
  const aKey = query.a ?? "";
  const bKey = query.b ?? "";
  const selected = async (key: string): Promise<ClubSummary | null> =>
    !key ? null : clubs.find((c) => c.club_key === key) ?? (await getClub(key, season)).club;
  const [a, b] = await Promise.all([selected(aKey), selected(bKey)]);

  const metrics: Array<{ label: string; describe: string; value: (club: ClubSummary) => string }> = [
    { label: "Schedule Difficulty", describe: "Reference 1,500 expected win %; lower means harder opposition", value: (club) => schedulePercent(club.schedule_expected_win_pct) },
    { label: "Observed wrestlers", describe: "Unique athletes representing the club", value: (club) => String(club.wrestlers) },
    { label: "Contested bouts", describe: "Appearances in imported matches", value: (club) => String(club.bouts) },
    { label: "Win percentage", describe: "Recorded bouts, not strength-adjusted", value: (club) => matchPct(club.wins, club.bouts) },
    { label: "Median Conservative Glicko Rating", describe: "Median current conservative rating", value: (club) => fmt(club.median_conservative, 1) },
    { label: "Top-five Conservative Glicko Rating", describe: "Top five current conservative ratings", value: (club) => fmt(club.top_five_conservative, 1) },
    { label: "Average Conservative Glicko Rating", describe: "Mean current conservative rating", value: (club) => fmt(club.avg_conservative, 1) },
    { label: "Average Opponent Glicko Rating", describe: "Mean current rating of actual opponents", value: (club) => fmt(club.avg_opponent_rating, 1) },
    { label: "Rated wrestlers", describe: "Matches linked to active rating model", value: (club) => String(club.rated_wrestlers) },
  ];
  return <main className="page-shell clubs-page">
    <Link className="club-back" href="/clubs">← Club rankings</Link>
    <div className="page-title"><span className="eyebrow">SIDE-BY-SIDE SCOUTING</span><h1>Compare clubs</h1><p>Compare size, results, and opponent-adjusted strength without disguising them behind one composite club score.</p></div>
    <form action="/clubs/compare" method="get" className="club-filters">
      <label>Season<select name="season" defaultValue={season}>{CLUB_SEASONS.map((s) => <option key={s} value={s}>{s === "ALL" ? "All seasons" : s}</option>)}</select></label>
      <label>First club<select name="a" defaultValue={aKey}><option value="">Choose club</option>{clubs.map((club) => <option key={club.club_key} value={club.club_key}>{club.club_name}</option>)}</select></label>
      <label>Second club<select name="b" defaultValue={bKey}><option value="">Choose club</option>{clubs.map((club) => <option key={club.club_key} value={club.club_key}>{club.club_name}</option>)}</select></label>
      <button type="submit">Compare</button>
    </form>
    {error && <p className="club-notice">{error}</p>}
    {a && b ? <>
      {(!a.rated_wrestlers || !b.rated_wrestlers) && <p className="club-notice">Glicko and schedule metrics metrics require an active opponent-adjusted rating model. Missing values are shown as dashes.</p>}
      <div className="club-compare-head"><span>Metric</span><strong><Link href={clubHref(a.club_key,season)}>{a.club_name}</Link></strong><strong><Link href={clubHref(b.club_key,season)}>{b.club_name}</Link></strong></div>
      {metrics.map((metric) => <div className="club-compare-row" key={metric.label}>
        <div><strong>{metric.label}</strong><small>{metric.describe}</small></div>
        <strong>{metric.value(a)}</strong><strong>{metric.value(b)}</strong>
      </div>)}
      <p className="club-footnote">Ratings are current wrestler estimates, even if comparing earlier-season rosters. These are observed Florida tournament results, not official club standings. Do not infer coaching causality or permanent affiliation from participation.</p>
    </> : <p className="club-notice">Select two clubs to compare their observed tournament results and current rating-based strength.</p>}
  </main>;
}
