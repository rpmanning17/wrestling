import Link from "next/link";
import { schedulePercent } from "@/lib/cohort-standing";
import { CLUB_SEASONS, CLUB_SORTS, clubHref, fmt, getClubs, matchPct, type ClubSeason, type ClubSort } from "@/lib/clubs";

export const dynamic = "force-dynamic";

type Params = { season?: string; sort?: string; q?: string };

export default async function ClubsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const season: ClubSeason = CLUB_SEASONS.includes(params.season as ClubSeason) ? params.season as ClubSeason : "ALL";
  const sort: ClubSort = Object.hasOwn(CLUB_SORTS, params.sort ?? "") ? params.sort as ClubSort : "wrestlers";
  const q = (params.q ?? "").slice(0, 80);
  const { clubs, error } = await getClubs(season, sort, q);
  const hasRatings = clubs.some((club) => club.rated_wrestlers > 0);
  const modelSort = !["wrestlers", "bouts"].includes(sort);

  return (
    <main className="page-shell clubs-page">
      <div className="page-title">
        <span className="eyebrow">FLORIDA YOUTH WRESTLING</span>
        <h1>Club scouting</h1>
        <p>Compare the competitive depth and observed results of clubs in our imported Florida tournaments. Wrestlers belong to the team they actually represented at each event.</p>
      </div>
      <form method="get" action="/clubs" className="club-filters" aria-label="Filter club rankings">
        <label>Season
          <select name="season" defaultValue={season}>
            <option value="ALL">All recorded seasons</option>
            {CLUB_SEASONS.filter((s) => s !== "ALL").map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>Sort clubs
          <select name="sort" defaultValue={sort}>
            {Object.entries(CLUB_SORTS).map(([key, title]) => <option key={key} value={key}>{title}</option>)}
          </select>
        </label>
        <label>Club name
          <input type="search" name="q" defaultValue={q} placeholder="Find Alpha, Longwood…" maxLength={80}/>
        </label>
        <button type="submit">Apply</button>
      </form>

      {error ? <section className="empty-state"><h2>Club data not available yet</h2><p>{error}</p></section> : <>
        {!hasRatings && <p className="club-notice">Opponent-adjusted club strength and strength of schedule will appear after the wrestler rating model is calculated and activated. For now these are observed roster and contested-match counts, not a power ranking.</p>}
        {modelSort && !hasRatings && <p className="club-notice">This ranking metric has no active ratings yet. Use “Observed roster” or “Recorded bouts” to compare participation.</p>}
        <div className="club-results-heading"><h2>{q ? "Matching clubs" : "Club rankings"}</h2><span><Link href="/clubs/compare">Compare clubs</Link> · {clubs.length}{clubs.length === 200 ? "+" : ""} clubs displayed</span></div>
        {clubs.length ? <div className="club-list">
          {clubs.map((club, i) => <article className="club-result" key={club.club_key}>
            <div className="club-result-title">
              <span className="club-position">{String(i + 1).padStart(2, "0")}</span>
              <div><h3><Link href={clubHref(club.club_key, season)}>{club.club_name}</Link></h3><small>{club.wrestlers} observed wrestlers · {club.bouts} contested appearances</small></div>
            </div>
            <div className="club-result-stats">
              <div><span>Record</span><strong>{club.wins}–{club.losses}</strong><small>{matchPct(club.wins, club.bouts)}</small></div>
              <div><span>Median Conservative Glicko Rating</span><strong>{fmt(club.median_conservative, 1)}</strong><small>Raw Glicko scale</small></div>
              <div><span>Top-five Conservative Glicko Rating</span><strong>{fmt(club.top_five_conservative, 1)}</strong><small>{club.rated_wrestlers ? `${Math.min(5, club.rated_wrestlers)} rated` : "Not rated"}</small></div>
              <div><span>Schedule Difficulty</span><strong>{schedulePercent(club.schedule_expected_win_pct)}</strong><small>Reference 1,500 expected win %; lower means harder. Average Opponent Glicko Rating: {fmt(club.avg_opponent_rating, 1)}</small></div>
            </div>
          </article>)}
        </div> : <section className="empty-state"><h2>No clubs found</h2><p>Try another spelling or remove a filter.</p></section>}
        <p className="club-footnote">Based on imported matches, not a complete statewide census. A wrestler may represent different clubs across events. Match records include possible genuine rematches; no pair of results is discarded merely because opponents met at the same event. Historical seasons show their contemporary rosters but the Glicko ratings, when available, are <strong>current estimates</strong>, not historical values.</p>
      </>}
    </main>
  );
}
