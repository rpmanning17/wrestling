"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteWrestlerNote, loadProfiles, saveWrestlerNote, searchWrestlers } from "@/app/compare-actions";
import type { WrestlerNote, WrestlerProfile, WrestlerRef, WrestlerSuggestion } from "@/lib/scouting-types";
import { wrestlerKey } from "@/lib/scouting-types";

const COMPARE_KEY = "matnotes.compare.v1";
const PENDING_KEY = "matnotes.pending-notes.v1";
type PendingNote = { wrestlerName: string; body: string; clientId: string };

function safeStoredRefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(COMPARE_KEY) || "[]") as WrestlerRef[];
    return Array.isArray(parsed) ? parsed.filter((item) => item?.name).slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function CompareBuilder() {
  const [refs, setRefs] = useState<WrestlerRef[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [profiles, setProfiles] = useState<WrestlerProfile[]>([]);
  const [query, setQuery] = useState("");
  const [pasteList, setPasteList] = useState("");
  const [suggestions, setSuggestions] = useState<WrestlerSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useState<"likelihood" | "strength">("likelihood");
  const [message, setMessage] = useState("");
  const requestId = useRef(0);

  const refreshProfiles = useCallback(async (nextRefs: WrestlerRef[]) => {
    const id = ++requestId.current;
    if (!nextRefs.length) {
      setProfiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const nextProfiles = await loadProfiles(nextRefs);
      if (id === requestId.current) setProfiles(nextProfiles);
    } catch {
      if (id === requestId.current) setMessage("Could not refresh scouting data. Your comparison is still saved on this device.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = safeStoredRefs();
      setRefs(saved);
      setHydrated(true);
      void refreshProfiles(saved);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshProfiles]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(COMPARE_KEY, JSON.stringify(refs));
  }, [hydrated, refs]);

  const flushPending = useCallback(async () => {
    let pending: PendingNote[] = [];
    try {
      pending = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]") as PendingNote[];
    } catch {
      localStorage.removeItem(PENDING_KEY);
    }
    if (!pending.length || !navigator.onLine) return;
    const remaining: PendingNote[] = [];
    for (const note of pending) {
      try { await saveWrestlerNote(note); } catch { remaining.push(note); }
    }
    localStorage.setItem(PENDING_KEY, JSON.stringify(remaining));
    if (remaining.length < pending.length) void refreshProfiles(refs);
  }, [refs, refreshProfiles]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => void flushPending(), 0);
    window.addEventListener("online", flushPending);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", flushPending);
    };
  }, [flushPending, hydrated]);

  const addRef = (ref: WrestlerRef) => {
    setMessage("");
    setRefs((current) => {
      if (current.some((item) => wrestlerKey(item.name) === wrestlerKey(ref.name))) return current;
      if (current.length >= 8) {
        setMessage("A comparison can hold up to 8 wrestlers.");
        return current;
      }
      const next = [...current, ref];
      void refreshProfiles(next);
      return next;
    });
    setQuery("");
    setSuggestions([]);
  };

  const updateRef = (key: string, changes: Partial<WrestlerRef>) => {
    setRefs((current) => {
      const next = current.map((ref) => wrestlerKey(ref.name) === key ? { ...ref, ...changes } : ref);
      void refreshProfiles(next);
      return next;
    });
  };

  const removeRef = (key: string) => {
    setRefs((current) => {
      const next = current.filter((ref) => wrestlerKey(ref.name) !== key);
      void refreshProfiles(next);
      return next;
    });
  };

  const runSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setMessage("");
    try {
      const found = await searchWrestlers(query);
      setSuggestions(found);
      if (!found.length) setMessage("No close result found. Add the name as a temporary wrestler below.");
    } catch {
      setMessage("Search is unavailable right now. You can still add a temporary wrestler.");
    } finally {
      setSearching(false);
    }
  };

  const addList = async () => {
    const names = pasteList.split(/[\n,]+/).map((name) => name.trim()).filter(Boolean).slice(0, 8 - refs.length);
    if (!names.length) return;
    setSearching(true);
    const resolved = await Promise.all(names.map(async (name) => {
      try {
        const [best] = await searchWrestlers(name);
        return best && best.matchScore >= 55 ? best : { name, unknown: true };
      } catch {
        return { name, unknown: true };
      }
    }));
    const existing = new Set(refs.map((ref) => wrestlerKey(ref.name)));
    const next = [...refs];
    for (const ref of resolved) {
      const key = wrestlerKey(ref.name);
      if (!existing.has(key) && next.length < 8) {
        next.push(ref);
        existing.add(key);
      }
    }
    setRefs(next);
    setPasteList("");
    setSearching(false);
    void refreshProfiles(next);
  };

  const newComparison = () => {
    if (!window.confirm("Clear this comparison and start a new one?")) return;
    localStorage.removeItem(COMPARE_KEY);
    setRefs([]);
    setProfiles([]);
    setSuggestions([]);
    setMessage("");
  };

  const addNote = async (profile: WrestlerProfile, body: string) => {
    const clientId = crypto.randomUUID().replaceAll("-", "");
    const optimistic: WrestlerNote = { id: -Number.parseInt(clientId.slice(0, 8), 16), wrestlerKey: profile.key, body, clientId, createdAt: "" };
    setProfiles((current) => current.map((item) => item.key === profile.key ? { ...item, notes: [optimistic, ...item.notes] } : item));
    const pending = { wrestlerName: profile.name, body, clientId };
    try {
      const saved = await saveWrestlerNote(pending);
      setProfiles((current) => current.map((item) => item.key === profile.key ? { ...item, notes: item.notes.map((note) => note.clientId === clientId ? saved : note) } : item));
    } catch {
      let queue: PendingNote[] = [];
      try { queue = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]") as PendingNote[]; } catch { /* start a clean queue */ }
      localStorage.setItem(PENDING_KEY, JSON.stringify([...queue.filter((item) => item.clientId !== clientId), pending]));
      setMessage("That note is saved on this device and will sync when the connection returns.");
    }
  };

  const removeNote = async (profileKey: string, note: WrestlerNote) => {
    setProfiles((current) => current.map((item) => item.key === profileKey ? { ...item, notes: item.notes.filter((saved) => saved.clientId !== note.clientId) } : item));
    if (note.id < 0) {
      try {
        const queue = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]") as PendingNote[];
        localStorage.setItem(PENDING_KEY, JSON.stringify(queue.filter((item) => item.clientId !== note.clientId)));
      } catch { /* nothing else to delete */ }
      return;
    }
    try { await deleteWrestlerNote(note.id); } catch { setMessage("The note could not be deleted from the server. Refresh to try again."); }
  };

  const sorted = useMemo(() => [...profiles].sort((a, b) => mode === "strength"
    ? (b.strength ?? -1) - (a.strength ?? -1)
    : b.likelihood - a.likelihood), [mode, profiles]);

  return (
    <main className="page-shell compare-page">
      <section className="compare-hero">
        <div>
          <span className="eyebrow">TOURNAMENT MODE</span>
          <h1>Who’s in the bracket?</h1>
          <p>Add the names you see in Flo. Mat Notes will pull together results, age and weight evidence, rankings, and your notes.</p>
        </div>
        <button className="text-button" type="button" onClick={newComparison} disabled={!refs.length}>New comparison</button>
      </section>

      <section className="builder-panel" aria-label="Build comparison">
        <form className="name-search" onSubmit={runSearch}>
          <label htmlFor="wrestler-search">Find one wrestler</label>
          <div className="input-action">
            <input id="wrestler-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name from the bracket" autoComplete="off" maxLength={100} />
            <button disabled={searching || query.trim().length < 2}>{searching ? "Finding…" : "Find"}</button>
          </div>
        </form>

        {!!suggestions.length && (
          <div className="suggestions" aria-label="Search results">
            {suggestions.map((suggestion) => (
              <button key={`${suggestion.name}-${suggestion.team}`} type="button" onClick={() => addRef(suggestion)}>
                <strong>{suggestion.name}</strong>
                <span>{suggestion.team || "Team not recorded"} · {suggestion.evidence}</span>
              </button>
            ))}
          </div>
        )}

        {query.trim().length >= 2 && !suggestions.length && !searching && (
          <button className="outline-button full-button" type="button" onClick={() => addRef({ name: query.trim(), unknown: true })}>Add “{query.trim()}” as temporary</button>
        )}

        <details className="quick-list">
          <summary>Add a whole bracket list</summary>
          <p>Paste up to eight names, separated by commas or new lines. Close matches are selected automatically.</p>
          <textarea value={pasteList} onChange={(event) => setPasteList(event.target.value)} placeholder={"Gabriel Abbasi\nAdrian Garcia\nJude Demsick"} rows={4} />
          <button type="button" onClick={addList} disabled={searching || !pasteList.trim() || refs.length >= 8}>Add list</button>
        </details>
      </section>

      {!!message && <p className="status-message" role="status">{message}</p>}

      {!!refs.length && (
        <section className="comparison-section">
          <div className="section-heading">
            <div><span className="eyebrow">{refs.length} OF 8 WRESTLERS</span><h2>Bracket comparison</h2></div>
            <div className="segmented" aria-label="Sort comparison">
              <button type="button" className={mode === "likelihood" ? "active" : ""} onClick={() => setMode("likelihood")}>Likely for Nolan</button>
              <button type="button" className={mode === "strength" ? "active" : ""} onClick={() => setMode("strength")}>Strongest</button>
            </div>
          </div>

          <div className="selected-strip" aria-label="Selected wrestlers">
            {refs.map((ref) => <span key={wrestlerKey(ref.name)}>{ref.name}<button type="button" aria-label={`Remove ${ref.name}`} onClick={() => removeRef(wrestlerKey(ref.name))}>×</button></span>)}
          </div>

          {loading && !profiles.length ? <div className="loading-card">Building the comparison…</div> : (
            <div className="profile-grid">
              {sorted.map((profile, index) => (
                <ProfileCard key={profile.key} profile={profile} rank={index + 1} sortMode={mode} onUpdate={(changes) => updateRef(profile.key, changes)} onAddNote={(body) => addNote(profile, body)} onDeleteNote={(note) => removeNote(profile.key, note)} />
              ))}
            </div>
          )}
        </section>
      )}

      {!refs.length && hydrated && (
        <section className="empty-state"><span className="empty-number">01</span><h2>Start with the names on the bracket.</h2><p>This comparison stays on this device through refreshes and browser closings until you choose New comparison.</p></section>
      )}
    </main>
  );
}

function ProfileCard({ profile, rank, sortMode, onUpdate, onAddNote, onDeleteNote }: {
  profile: WrestlerProfile;
  rank: number;
  sortMode: "likelihood" | "strength";
  onUpdate: (changes: Partial<WrestlerRef>) => void;
  onAddNote: (body: string) => void;
  onDeleteNote: (note: WrestlerNote) => void;
}) {
  const [note, setNote] = useState("");
  const primaryScore = sortMode === "strength" ? profile.strength : profile.likelihood;
  const submitNote = (event: FormEvent) => {
    event.preventDefault();
    if (!note.trim()) return;
    onAddNote(note.trim());
    setNote("");
  };

  return (
    <article className="profile-card">
      <div className="profile-topline"><span>#{rank}</span><span className={`confidence ${profile.evidenceConfidence}`}>{profile.evidenceConfidence} evidence</span></div>
      <h3>{profile.name}</h3>
      <p className="team-line">{profile.team || "Team not recorded"}</p>
      {profile.unknown && <span className="temporary-label">Temporary wrestler</span>}

      <div className="primary-score"><strong>{primaryScore == null ? "—" : primaryScore.toFixed(2)}</strong><span>{sortMode === "strength" ? "Strength" : "Matchup likelihood"}</span></div>
      <div className="score-pair"><div><span>Likelihood</span><strong>{profile.likelihood.toFixed(2)}</strong></div><div><span>Strength</span><strong>{profile.strength == null ? "Unrated" : profile.strength.toFixed(2)}</strong></div></div>

      <dl className="facts">
        <div><dt>Record</dt><dd>{profile.wins}-{profile.losses}</dd></div>
        <div><dt>Age group</dt><dd>{profile.latestAgeGroup || "Unknown"}</dd></div>
        <div><dt>Birth years</dt><dd>{profile.birthYearStart && profile.birthYearEnd ? `${profile.birthYearStart}–${profile.birthYearEnd}` : "Unknown"}</dd></div>
        <div><dt>Weight</dt><dd>{profile.latestWeight ? `${profile.latestWeight} lb` : "Unknown"}</dd></div>
        <div><dt>Cohort</dt><dd>{profile.cohortRank && profile.cohortSize ? `#${profile.cohortRank} of ${profile.cohortSize}` : "Unrated"}</dd></div>
        <div><dt>Latest</dt><dd>{profile.latestDate || "No result"}</dd></div>
      </dl>

      {profile.unknown && (
        <div className="manual-evidence">
          <label>Age group<select value={profile.ageGroup || ""} onChange={(event) => onUpdate({ ageGroup: event.target.value || undefined })}><option value="">Unknown</option><option>10U</option><option>12U</option><option>14U</option></select></label>
          <label>Weight<input type="number" min="40" max="400" value={profile.weight || ""} onChange={(event) => onUpdate({ weight: event.target.value ? Number(event.target.value) : undefined })} placeholder="lbs" /></label>
          <label>Team<input value={profile.team || ""} onChange={(event) => onUpdate({ team: event.target.value })} placeholder="Optional" /></label>
        </div>
      )}

      <p className="score-reason"><strong>Why likely:</strong> {profile.likelihoodReason}</p>
      <p className="score-reason"><strong>Why strong:</strong> {profile.strengthReason}</p>

      <details className="profile-details">
        <summary>History & notes</summary>
        {!!profile.placements.length && <div className="history-block"><h4>Placements</h4>{profile.placements.map((placement) => <p key={`${placement.date}-${placement.event}-${placement.division}-${placement.weightLabel}-${placement.place ?? "entry"}`}>{placement.place ? `${placement.place}${ordinal(placement.place)}` : "Entered"} · {placement.ageGroup ? `${placement.ageGroup} · ` : ""}{placement.division} · {placement.weightLabel === "HWT" ? "HWT" : `${placement.weightLabel} lb`}<span>{placement.event} · {placement.date}{placement.confidence === "identity review" ? " · identity review" : ""}</span></p>)}</div>}
        <div className="history-block"><h4>Recent bouts</h4>{profile.bouts.length ? profile.bouts.map((bout) => <p key={bout.id}><b className={bout.outcome === "W" ? "win" : "loss"}>{bout.outcome}</b> vs {bout.opponent}<span>{bout.event} · {bout.date} · {bout.weight} · {bout.result}</span></p>) : <p>No imported bouts.</p>}</div>
        <div className="notes-block">
          <h4>Scouting notes</h4>
          <form onSubmit={submitNote}><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={4000} placeholder="Dated note about stance, setups, tendencies…" /><button disabled={!note.trim()}>Save note</button></form>
          {profile.notes.map((saved) => <div className="saved-note" key={saved.clientId}><time>{saved.createdAt ? new Date(saved.createdAt).toLocaleString() : "Just now"}</time>{saved.id < 0 && <em>Queued to sync</em>}<p>{saved.body}</p><button type="button" onClick={() => onDeleteNote(saved)}>Delete</button></div>)}
        </div>
      </details>
    </article>
  );
}

function ordinal(value: number) {
  if (value % 100 >= 11 && value % 100 <= 13) return "th";
  return value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th";
}
