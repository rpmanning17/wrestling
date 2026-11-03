import Link from "next/link";
import { notFound } from "next/navigation";
import { CLUB_SEASONS, clubHref, fmt, getClub, matchPct, type ClubSeason } from "@/lib/clubs";

export const dynamic = "force-dynamic";

export default async function ClubProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ clubKey: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const [{ clubKey }, query] = await Promise.all([params, searchParams]);
  const key = decodeURIComponent(clubKey);
  const season: ClubSeason = CLUB_SEASONS.includes(query.season as ClubSeason) ? query.season as ClubSeason : "ALL";
  const { club, wrestlers, aliases, error } = await getClub(key, season);

  if (error) return <main className="page-shell"><Link href="/clubs">← Clubs</Link><section className="empty-state"><h1>Club data unavailable</h1><p>{error}</p></section></main>;
  if (!club) notFound();

  return <main className="page-shell club-profile">
    <Link className="club-back" href={`/clubs?season=${encodeURIComponent(season)}`}>← All clubs</Link>
    <div className="page-title">
      <span className="eyebrow">CLUB SCOUTING</span>
      <h1>{club.club_name}</h1>
      <p>{club.wrestlers} observed wrestlers across {club.bouts} contested match appearances in the selected reporting period.</p>
    </div>
    <form className="club-season-form" method="get" action={clubHref(key, "ALL").split("?")[0]}>
      <label>Reporting season
        <select name="season" defaultValue={season}>{CLUB_SEASONS.map((s) => <option key={s} value={s}>{s === "ALL" ? "All seasons" : s}</option>)}</select>
      </label>
      <button type="submit">View</button>
    </form>
    <div className="club-profile-metrics">
      <div><span>Contested record</span><strong>{club.wins}–{club.losses}</strong><small>{matchPct(club.wins, club.bouts)} recorded win rate</small></div>
      <div><span>Roster depth</span><strong>{club.wrestlers}</strong><small>Unique observed wrestlers</small></div>
      <div><span>Typical wrestler</span><strong>{fmt(club.median_conservative, 1)}</strong><small>Conservative strength</small></div>
      <div><span>Elite five</span><strong>{fmt(club.top_five_conservative, 1)}</strong><small>Average top-five strength</small></div>
      <div><span>Schedule quality</span><strong>{fmt(club.avg_opponent_rating, 1)}</strong><small>Avg opponent rating</small></div>
      <div><span>Ratings coverage</span><strong>{club.rated_wrestlers}/{club.wrestlers}</strong><small>Wrestlers with current ratings</small></div>
    </div>
    {club.rated_wrestlers === 0 && <p className="club-notice">Power and SOS will populate when a validated opponent-adjusted model becomes active. These records describe imported appearances, not an exhaustive club roster.</p>}
    {!!aliases.length && <p className="club-alias-line"><strong>Mapped source labels:</strong> {aliases.join(", ")}. Related programs are kept separate unless their organizational identity is verified.</p>}
    <div className="club-results-heading"><h2>Observed wrestler roster</h2><span>{wrestlers.length}{wrestlers.length === 150 ? "+" : ""} listed</span></div>
    <div className="club-athlete-list">
      {wrestlers.map((wrestler) => <div className="club-athlete" key={wrestler.athlete_key}>
        <div><strong>{wrestler.athlete_name}</strong><small>{wrestler.wins}–{wrestler.losses} from {wrestler.bouts} contested appearances</small></div>
        <div className="club-athlete-numbers"><span>Power <strong>{fmt(wrestler.conservative_score, 1)}</strong></span><span>SOS <strong>{fmt(wrestler.avg_opponent_rating, 1)}</strong></span></div>
      </div>)}
    </div>
    <p className="club-footnote">A wrestler may appear on multiple clubs’ historical rosters if they represented different teams. Only recorded contested bouts are counted; forfeits are excluded. Rating figures are current estimates, even when viewing an earlier season. Similar names such as Spartan RTC and Lake Highland Prep are not automatically combined.</p>
  </main>;
}
