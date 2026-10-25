import Link from "next/link";
import { configured, supabase } from "@/lib/supabase";
import { addMatch, deleteMatch } from "./actions";

export const dynamic = "force-dynamic";

const methodOptions = ["F", "DEC", "TF", "MD", "FOR", "DEF", "M FOR", "DQ", "MFFL", "NC"];

export default async function Home({
 searchParams,
}: {
 searchParams: Promise<{ q?: string; season?: string; error?: string }>;
}) {
 if (!configured()) {
  return (
   <main>
    <span className="badge">MAT NOTES · PRIVATE WORKSPACE</span>
    <h1>Your corner.<br />Every season.</h1>
    <p>A private notebook for wrestling results and match preparation.</p>
    <section>
     <h2>Connect your database to begin</h2>
     <p>Follow README.md to finish the private server configuration. Results remain unavailable until setup is complete.</p>
    </section>
   </main>
  );
 }

 const db = supabase();
 const params = await searchParams;
 const search = params.q?.trim().replace(/[%_]/g, "");
 let query = db
  .from("matches")
  .select("*", { count: "exact" })
  .order("event_date", { ascending: false })
  .order("event_name", { ascending: true })
  .limit(200);

 if (search) query = query.ilike("search_text", `%${search}%`);
 if (params.season) query = query.eq("season", params.season.trim());

 const { data: matches, error, count } = await query;

 return (
  <main>
   <header>
    <Link href="/" className="brand">MAT NOTES</Link>
    <span className="badge">PERSONAL NOTEBOOK</span>
   </header>
   <span className="badge">PRIVATE · PROTECTED BY VERCEL</span>
   <h1>Know the history.<br />Prepare for the next match.</h1>
   <p>Search both sides of 11,647 verified 2024–2025 bouts. Results give context, never certainty.</p>

   <section>
    <h2>Match history</h2>
    <form className="filters">
     <label>Athlete, team, or event<input name="q" defaultValue={params.q} placeholder="Search either wrestler" maxLength={100} /></label>
     <label>Season<input name="season" defaultValue={params.season ?? "2024–2025"} placeholder="2024–2025" maxLength={20} /></label>
     <button>Search</button>
     <Link href="/">Clear</Link>
    </form>

    {(error || params.error) && <p role="alert">Unable to complete that request. Check your entry, connection, and database setup.</p>}
    {!error && !matches?.length && <div className="empty">No matching bouts found.</div>}

    {!!matches?.length && (
     <>
      <p>{count?.toLocaleString() ?? matches.length.toLocaleString()} matching bouts. Showing up to 200, newest first.</p>
      <div className="table">
       <table>
        <thead><tr><th>Date / event</th><th>Matchup</th><th>Weight / round</th><th>Result</th><th>Manage</th></tr></thead>
        <tbody>
         {matches.map((match) => (
          <tr key={match.id}>
           <td>{match.event_date}<small>{match.event_name} · {match.season}</small><small>{[match.city, match.state].filter(Boolean).join(", ")}</small></td>
           <td><strong>{match.winner_name}</strong><small>{match.winner_team || "Team not recorded"}</small><small>over {match.loser_name} · {match.loser_team || "Team not recorded"}</small></td>
           <td>{match.weight_class}<small>{match.round || "Round not recorded"}</small></td>
           <td>{match.win_type}<small>{match.result || "Score not recorded"}</small></td>
           <td><form action={deleteMatch}><input type="hidden" name="id" value={match.id} /><button className="secondary">Delete</button></form></td>
          </tr>
         ))}
        </tbody>
       </table>
      </div>
     </>
    )}
   </section>

   <section>
    <h2>Add a verified bout</h2>
    <p>Record only published match information you are permitted to use. Avoid birthdates, contact details, medical details, photos, and other personal information.</p>
    <form action={addMatch} className="grid">
     <label>Winner<input name="winner_name" required maxLength={100} /></label>
     <label>Winner team<input name="winner_team" maxLength={160} /></label>
     <label>Loser<input name="loser_name" required maxLength={100} /></label>
     <label>Loser team<input name="loser_team" maxLength={160} /></label>
     <label>Event<input name="event_name" required maxLength={160} /></label>
     <label>Event date<input name="event_date" type="date" required /></label>
     <label>Season<input name="season" defaultValue="2024–2025" required maxLength={20} /></label>
     <label>Weight class<input name="weight_class" required maxLength={40} /></label>
     <label>Round<input name="round" maxLength={80} /></label>
     <label>Result / score<input name="result" maxLength={80} /></label>
     <label>Win type<select name="win_type">{methodOptions.map((method) => <option key={method}>{method}</option>)}</select></label>
     <label>City<input name="city" maxLength={100} /></label>
     <label>State<input name="state" maxLength={10} /></label>
     <button>Save private bout</button>
    </form>
   </section>

   <footer>Private records · No public athlete profiles · Delete records when no longer needed</footer>
  </main>
 );
}
