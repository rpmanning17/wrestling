import Link from "next/link";
import { addMatch, deleteMatch } from "@/app/actions";
import { configured, supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const methodOptions = ["F", "DEC", "TF", "MD", "FOR", "DEF", "M FOR", "DQ", "MFFL", "NC"];

export default async function ResultsPage({ searchParams }: { searchParams: Promise<{ q?: string; season?: string; error?: string }> }) {
  const params = await searchParams;
  if (!configured()) return <main className="page-shell"><h1>Results database is not connected.</h1></main>;
  const search = params.q?.trim().replace(/[%_]/g, "");
  let query = supabase().from("matches").select("*", { count: "exact" }).order("event_date", { ascending: false }).order("event_name", { ascending: true }).limit(200);
  if (search) query = query.ilike("search_text", `%${search}%`);
  if (params.season) query = query.eq("season", params.season.trim());
  const { data: matches, error, count } = await query;

  return (
    <main className="page-shell results-page">
      <div className="page-title"><span className="eyebrow">FULL DATABASE</span><h1>Results</h1><p>Search athletes, teams, and events across all imported seasons.</p></div>
      <section className="light-panel">
        <form className="filters">
          <label>Athlete, team, or event<input name="q" defaultValue={params.q} placeholder="Search either wrestler" maxLength={100} /></label>
          <label>Season<input name="season" defaultValue={params.season} placeholder="2026–2027" maxLength={20} /></label>
          <button>Search</button><Link href="/results">Clear</Link>
        </form>
        {(error || params.error) && <p className="status-message" role="alert">Unable to complete that request.</p>}
        {!error && !matches?.length && <div className="empty-table">No matching bouts found.</div>}
        {!!matches?.length && <><p>{count?.toLocaleString() ?? matches.length.toLocaleString()} matching bouts. Showing up to 200, newest first.</p><div className="table-wrap"><table><thead><tr><th>Date / event</th><th>Matchup</th><th>Weight / round</th><th>Result</th><th>Manage</th></tr></thead><tbody>{matches.map((match) => <tr key={match.id}><td>{match.event_date}<small>{match.event_name} · {match.season}</small><small>{[match.city, match.state].filter(Boolean).join(", ")}</small></td><td><strong>{match.winner_name}</strong><small>{match.winner_team || "Team not recorded"}</small><small>over {match.loser_name} · {match.loser_team || "Team not recorded"}</small></td><td>{match.weight_class}<small>{match.round || "Round not recorded"}</small></td><td>{match.win_type}<small>{match.result || "Score not recorded"}</small></td><td><form action={deleteMatch}><input type="hidden" name="id" value={match.id} /><button className="danger-link">Delete</button></form></td></tr>)}</tbody></table></div></>}
      </section>
      <details className="light-panel add-bout"><summary>Add a missing bout</summary><form action={addMatch} className="form-grid">
        <label>Winner<input name="winner_name" required maxLength={100} /></label><label>Winner team<input name="winner_team" maxLength={160} /></label><label>Loser<input name="loser_name" required maxLength={100} /></label><label>Loser team<input name="loser_team" maxLength={160} /></label><label>Event<input name="event_name" required maxLength={160} /></label><label>Event date<input name="event_date" type="date" required /></label><label>Season<input name="season" defaultValue="2026–2027" required maxLength={20} /></label><label>Weight class<input name="weight_class" required maxLength={40} /></label><label>Round<input name="round" maxLength={80} /></label><label>Result / score<input name="result" maxLength={80} /></label><label>Win type<select name="win_type">{methodOptions.map((method) => <option key={method}>{method}</option>)}</select></label><label>City<input name="city" maxLength={100} /></label><label>State<input name="state" maxLength={10} /></label><button>Save bout</button>
      </form></details>
    </main>
  );
}

