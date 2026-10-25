import Link from "next/link";
import { configured, supabase } from "@/lib/supabase";
import { addResult, deleteResult } from "./actions";

export const dynamic = "force-dynamic";

const fields = [
 ["athlete", "Athlete", 100],
 ["opponent", "Opponent", 100],
 ["event_name", "Event", 160],
 ["season", "Season (e.g. 2026–2027)", 20],
 ["division", "Age / weight division", 80],
] as const;

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
 let query = db.from("results").select("*").order("event_date", { ascending: false }).limit(200);

 if (params.q) query = query.ilike("athlete", `%${params.q.replace(/[%_]/g, "")}%`);
 if (params.season) query = query.eq("season", params.season);

 const { data: results, error } = await query;

 return (
  <main>
   <header>
    <Link href="/" className="brand">MAT NOTES</Link>
    <span className="badge">PERSONAL NOTEBOOK</span>
   </header>
   <span className="badge">PRIVATE · PROTECTED BY VERCEL</span>
   <h1>Know the history.<br />Prepare for the next match.</h1>
   <p>Search this year and seasons past. Results give context, never certainty.</p>

   <section>
    <h2>Match history</h2>
    <form className="filters">
     <label>Athlete<input name="q" defaultValue={params.q} placeholder="Search athlete" maxLength={100} /></label>
     <label>Season<input name="season" defaultValue={params.season} placeholder="2026–2027" maxLength={20} /></label>
     <button>Search</button>
     <Link href="/">Clear</Link>
    </form>

    {(error || params.error) && <p role="alert">Unable to complete that request. Check your entry, connection, and database setup.</p>}
    {!error && !results?.length && <div className="empty">No results yet. Add your first verified match below.</div>}

    {!!results?.length && (
     <>
      <p>Up to 200 matches, newest first. Filter to narrow your search.</p>
      <div className="table">
       <table>
        <thead><tr><th>Date / event</th><th>Athlete / opponent</th><th>Division</th><th>Result</th><th>Source</th><th>Manage</th></tr></thead>
        <tbody>
         {results.map((result) => (
          <tr key={result.id}>
           <td>{result.event_date}<small>{result.event_name} · {result.season}</small></td>
           <td>{result.athlete}<small>vs. {result.opponent}</small></td>
           <td>{result.division}</td>
           <td>{result.outcome}<small>{result.method}</small></td>
           <td>{result.source_url?.startsWith("https://") ? <a href={result.source_url} target="_blank" rel="noreferrer">Original result</a> : "Not recorded"}</td>
           <td><form action={deleteResult}><input type="hidden" name="id" value={result.id} /><button className="secondary">Delete</button></form></td>
          </tr>
         ))}
        </tbody>
       </table>
      </div>
     </>
    )}
   </section>

   <section>
    <h2>Add a verified result</h2>
    <p>Use a short name or alias where practical. Store only results you are permitted to use.</p>
    <form action={addResult} className="grid">
     {fields.map(([name, label, max]) => <label key={name}>{label}<input name={name} required maxLength={max} /></label>)}
     <label>Event date<input name="event_date" type="date" required /></label>
     <label>Outcome<select name="outcome"><option>Win</option><option>Loss</option><option>Draw</option></select></label>
     <label>Method / score<input name="method" maxLength={80} /></label>
     <label>Original result URL<input type="url" name="source_url" placeholder="https://" maxLength={2048} /></label>
     <button>Save private result</button>
    </form>
   </section>

   <footer>Private records · No public athlete profiles · Delete records when no longer needed</footer>
  </main>
 );
}
