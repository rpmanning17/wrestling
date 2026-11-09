"use client";
import { CohortStanding } from "@/components/cohort-standing";
import { GlickoMetrics } from "@/components/glicko-metrics";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteWrestlerNote, loadProfiles, saveWrestlerNote, searchWrestlers } from "@/app/compare-actions";
import type { PowerRating, WrestlerNote, WrestlerProfile, WrestlerRef, WrestlerSuggestion } from "@/lib/scouting-types";
import { wrestlerKey } from "@/lib/scouting-types";

const COMPARE_KEY = "matnotes.compare.v1";
const PENDING_KEY = "matnotes.pending-notes.v1";
type PendingNote = { wrestlerName: string; personId?: string; body: string; clientId: string };
const refKey = (ref: WrestlerRef) => ref.personId ?? wrestlerKey(ref.name);

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
  const [searchResolved, setSearchResolved] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useState<"likelihood" | "strength">("likelihood");
  const [message, setMessage] = useState("");
  const requestId = useRef(0);
  const suggestionRequestId = useRef(0);

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
      if (id === requestId.current) {
        setProfiles(nextProfiles);
        const canonicalRefs = nextRefs.map((ref, index) => ({
          ...ref,
          name: nextProfiles[index]?.name ?? ref.name,
          team: nextProfiles[index]?.team ?? ref.team,
        }));
        const uniqueRefs = [...new Map(canonicalRefs.map((ref) => [refKey(ref), ref])).values()].slice(0, 8);
        setRefs((current) => JSON.stringify(current) === JSON.stringify(uniqueRefs) ? current : uniqueRefs);
      }
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
      if (current.some((item) => refKey(item) === refKey(ref))) return current;
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
    setActiveSuggestion(-1);
    setSearchResolved(false);
  };

  const updateRef = (key: string, changes: Partial<WrestlerRef>) => {
    setRefs((current) => {
      const next = current.map((ref) => refKey(ref) === key ? { ...ref, ...changes } : ref);
      void refreshProfiles(next);
      return next;
    });
  };

  const removeRef = (key: string) => {
    setRefs((current) => {
      const next = current.filter((ref) => refKey(ref) !== key);
      void refreshProfiles(next);
      return next;
    });
  };

  // Suggestions appear automatically after a short pause while typing.
  // Request IDs prevent slower, stale responses from overwriting newer names.
  useEffect(() => {
    const name = query.trim();
    if (name.length < 2) return;
    const id = ++suggestionRequestId.current;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchWrestlers(name).then((found) => {
        if (id !== suggestionRequestId.current) return;
        setSuggestions(found);
        setActiveSuggestion(-1);
        setSearchResolved(true);
      }).catch(() => {
        if (id !== suggestionRequestId.current) return;
        setSuggestions([]);
        setSearchResolved(false);
      }).finally(() => {
        if (id === suggestionRequestId.current) setSearching(false);
      });
    }, 280);
    return () => {
      window.clearTimeout(timer);
      suggestionRequestId.current += 1;
    };
  }, [query]);

  const runSearch = async (event: FormEvent) => {
    event.preventDefault();
    const name = query.trim();
    if (name.length < 2) return;
    const id = ++suggestionRequestId.current;
    setSearching(true);
    setMessage("");
    try {
      const found = await searchWrestlers(name);
      if (id !== suggestionRequestId.current) return;
      setSuggestions(found);
      setActiveSuggestion(-1);
      setSearchResolved(true);
      if (!found.length) setMessage("No close result found. Add the name as a temporary wrestler below.");
    } catch {
      if (id === suggestionRequestId.current) setMessage("Search is unavailable right now. You can still add a temporary wrestler.");
    } finally {
      if (id === suggestionRequestId.current) setSearching(false);
    }
  };


  const addList = async () => {
    const names = pasteList.split(/[\n,]+/).map((name) => name.trim()).filter(Boolean).slice(0, 8 - refs.length);
    if (!names.length) return;
    setSearching(true);
    const resolved = await Promise.all(names.map(async (name) => {
      try {
        const suggestions = await searchWrestlers(name);
        const [best] = suggestions;
        if (best?.personId && suggestions.some(candidate => candidate.personId !== best.personId &&
          candidate.matchScore === best.matchScore && wrestlerKey(candidate.name) === wrestlerKey(best.name)))
          return { name, unknown: true };
        return best && best.matchScore >= 55 ? best : { name, unknown: true };
      } catch {
        return { name, unknown: true };
      }
    }));
    const existing = new Set(refs.map(refKey));
    const next = [...refs];
    for (const ref of resolved) {
      const key = refKey(ref);
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
    const pending = { wrestlerName: profile.name, personId: profile.personId, body, clientId };
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
            <input id="wrestler-search" value={query} onChange={(event) => {
              setQuery(event.target.value);
              setSuggestions([]);
              setSearchResolved(false);
              setActiveSuggestion(-1);
              setMessage("");
            }} onKeyDown={(event) => {
              if (event.key === "Escape") { setSuggestions([]); setActiveSuggestion(-1); }
              if (event.key === "ArrowDown" && suggestions.length) {
                event.preventDefault();
                setActiveSuggestion((current) => Math.min(current + 1, suggestions.length - 1));
              }
              if (event.key === "ArrowUp" && suggestions.length) {
                event.preventDefault();
                setActiveSuggestion((current) => Math.max(current - 1, 0));
              }
              if (event.key === "Enter" && activeSuggestion >= 0 && suggestions[activeSuggestion]) {
                event.preventDefault();
                addRef(suggestions[activeSuggestion]);
              }
            }} role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0}
              aria-controls="athlete-suggestions"
              aria-activedescendant={activeSuggestion >= 0 ? "athlete-suggestion-" + activeSuggestion : undefined}
              placeholder="Start typing a wrestler’s name" autoComplete="off" maxLength={100} />
            <button disabled={searching || query.trim().length < 2}>{searching ? "Finding…" : "Find"}</button>
          </div>
        </form>

        {!!suggestions.length && (
          <div id="athlete-suggestions" className="suggestions" role="listbox" aria-label="Matching athletes">
            {suggestions.map((suggestion, index) => (
              <button id={"athlete-suggestion-" + index} role="option" aria-selected={activeSuggestion === index}
                className={activeSuggestion === index ? "selected" : ""}
                key={suggestion.personId ?? `${suggestion.name}-${suggestion.team}`} type="button" onClick={() => addRef(suggestion)}>
                <strong>{suggestion.name}</strong>
                <span>{suggestion.ageGroup ? suggestion.ageGroup + " division" : "Age not known"} · {suggestion.weight ? suggestion.weight + (suggestion.evidence.startsWith("Owner-supplied") ? " lb reported" : " lb estimate") : "Weight not known"} · {suggestion.team || "Club not recorded"}</span>
              </button>
            ))}
          </div>
        )}

        {query.trim().length >= 2 && searchResolved && !suggestions.length && !searching && (
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
              <button type="button" className={mode === "strength" ? "active" : ""} onClick={() => setMode("strength")}>Cohort Strength</button>
            </div>
          </div>

          <div className="selected-strip" aria-label="Selected wrestlers">
            {refs.map((ref) => <span key={refKey(ref)}>{ref.name}<button type="button" aria-label={`Remove ${ref.name}`} onClick={() => removeRef(refKey(ref))}>×</button></span>)}
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
  void sortMode; // Sorting never changes the numerical rating scale displayed.
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
      {profile.identityUnresolved ? <span className="temporary-label">Identity unresolved — select a search result</span>
        : profile.unknown && <span className="temporary-label">Temporary wrestler</span>}

      <CohortStanding standing={profile} />
      <p className="matchup-likelihood"><strong>Matchup Likelihood (0–1,000): {profile.likelihood.toFixed(2)}</strong><span>Opponent relevance and fit, not wrestling ability.</span></p>

      {profile.powerRating && <GlickoRatingStrip rating={profile.powerRating} />}

      <dl className="facts">
        <div><dt>Record</dt><dd>{profile.wins}-{profile.losses}</dd></div>
        <div><dt>Age group</dt><dd>{profile.latestAgeGroup || "Unknown"}</dd></div>
        <div><dt>Birth years</dt><dd>{profile.birthYearStart && profile.birthYearEnd ? `${profile.birthYearStart}–${profile.birthYearEnd}` : "Unknown"}</dd></div>
        <div><dt>Weight</dt><dd>{profile.latestWeight ? `${profile.latestWeight} lb estimate` : "Unknown"}</dd></div>
        <div><dt>Cohort</dt><dd>{profile.cohortRank && profile.cohortSize ? `#${profile.cohortRank} of ${profile.cohortSize}` : "Unrated"}</dd></div>
        <div><dt>Latest</dt><dd>{profile.latestDate || "No result"}</dd></div>
      </dl>

      {profile.unknown && !profile.identityUnresolved && (
        <div className="manual-evidence">
          <label>Age group<select value={profile.ageGroup || ""} onChange={(event) => onUpdate({ ageGroup: event.target.value || undefined })}><option value="">Unknown</option><option>10U</option><option>12U</option><option>14U</option></select></label>
          <label>Weight<input type="number" min="40" max="400" value={profile.weight || ""} onChange={(event) => onUpdate({ weight: event.target.value ? Number(event.target.value) : undefined })} placeholder="lbs" /></label>
          <label>Team<input value={profile.team || ""} onChange={(event) => onUpdate({ team: event.target.value })} placeholder="Optional" /></label>
        </div>
      )}

      <p className="score-reason"><strong>Why likely:</strong> {profile.likelihoodReason}</p>
      <p className="score-reason"><strong>Why strong:</strong> {profile.strengthReason}</p>

      {profile.powerRating && <RatingDetails profile={profile} rating={profile.powerRating} />}

      <details className="profile-details">
        <summary>History & notes</summary>
        {!!profile.placements.length && <div className="history-block"><h4>Placements</h4>{profile.placements.map((placement) => <p key={`${placement.date}-${placement.event}-${placement.division}-${placement.weightLabel}-${placement.place ?? "entry"}`}>{placement.place ? `${placement.place}${ordinal(placement.place)}` : "Entered"} · {placement.ageGroup ? `${placement.ageGroup} · ` : ""}{placement.division} · {placement.weightLabel === "HWT" ? "HWT" : `${placement.weightLabel} lb`}<span>{placement.event} · {placement.date}{placement.confidence === "identity review" ? " · identity review" : ""}</span></p>)}</div>}
        <div className="history-block"><h4>Recent bouts</h4>{profile.bouts.length ? profile.bouts.map((bout) => <p key={bout.id}><b className={bout.outcome === "W" ? "win" : "loss"}>{bout.outcome}</b> vs {bout.opponent}<span>{bout.event} · {bout.date} · {bout.ageGroup ?? "Age —"} · {bout.weight} · {bout.result}</span></p>) : <p>No imported bouts.</p>}</div>
        <div className="notes-block">
          <h4>Scouting notes</h4>
          {!profile.identityUnresolved && <form onSubmit={submitNote}><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={4000} placeholder="Dated note about stance, setups, tendencies…" /><button disabled={!note.trim()}>Save note</button></form>}
          {profile.notes.map((saved) => <div className="saved-note" key={saved.clientId}><time>{saved.createdAt ? new Date(saved.createdAt).toLocaleString() : "Just now"}</time>{saved.id < 0 && <em>Queued to sync</em>}<p>{saved.body}</p><button type="button" onClick={() => onDeleteNote(saved)}>Delete</button></div>)}
        </div>
      </details>
    </article>
  );
}

const pct = (value: number | null) => (value == null ? "—" : `${(value * 100).toFixed(0)}%`);
const METHOD_LABELS: Record<string, string> = { decision: "Dec", major_decision: "MD", tech_fall: "TF", fall: "Fall" };

function methodLine(methods: Record<string, number>) {
  const parts = Object.entries(METHOD_LABELS).filter(([kind]) => methods[kind]).map(([kind, label]) => `${methods[kind]} ${label}`);
  return parts.length ? parts.join(" · ") : "—";
}

/** Rating ± uncertainty, the conservative ranking score and the confidence status, always shown together. */
function GlickoRatingStrip({ rating }: { rating: PowerRating }) {
  return (
    <div><GlickoMetrics rating={rating.rating} rd={rating.rd} conservative={rating.conservative} status={rating.status} schedule={rating.sosExpectedWinPct} opponent={rating.avgOpponentRating} /><p className="metric-help">{rating.matchCount} rated bouts</p></div>
  );
}

function RatingDetails({ profile, rating }: { profile: WrestlerProfile; rating: PowerRating }) {
  const trend = rating.trend;
  return (
    <details className="profile-details rating-details">
      <summary>Rating details</summary>
      <dl className="facts">
        <div><dt>Average Opponent Glicko Rating</dt><dd>{rating.avgOpponentRating == null ? "—" : rating.avgOpponentRating.toFixed(0)}</dd></div>
        <div><dt>Schedule Difficulty</dt><dd>{pct(rating.sosExpectedWinPct)}</dd></div>
        <div><dt>Quality wins–losses</dt><dd>{rating.qualityWins}–{rating.qualityLosses}</dd></div>
        <div><dt>Pin %</dt><dd>{pct(rating.pinPct)}</dd></div>
        <div><dt>Bonus %</dt><dd>{pct(rating.bonusPct)}</dd></div>
        <div><dt>Trend (90 d)</dt><dd>{trend == null ? "—" : `${trend > 0 ? "+" : ""}${trend.toFixed(0)}`}</dd></div>
        <div><dt>Wins by</dt><dd>{methodLine(rating.winMethods)}</dd></div>
        <div><dt>Losses by</dt><dd>{methodLine(rating.lossMethods)}</dd></div>
        <div><dt>Avg margin W / L</dt><dd>{rating.avgWinMargin == null ? "—" : rating.avgWinMargin.toFixed(1)} / {rating.avgLossMargin == null ? "—" : rating.avgLossMargin.toFixed(1)}</dd></div>
      </dl>
      <p className="rating-footnote">Schedule Difficulty is the expected win percentage of a reference 1,500-rated wrestler; lower means harder opposition. Glicko Rating starts at 1,500 and has no fixed upper limit. RD is rating uncertainty. Conservative Glicko Rating subtracts the model’s configured uncertainty adjustment. Opponent strength uses opponents&apos; current ratings and explains the schedule only; it is not added to the rating. Model {rating.modelVersion}, through {rating.asOfDate}.</p>
      {!!profile.headToHead.length && <div className="history-block"><h4>Head-to-head</h4>{profile.headToHead.map((line) => <p key={line.opponent}>{line.wins}–{line.losses} vs {line.opponent}<span>last {line.lastDate}</span></p>)}</div>}
      {!!profile.commonOpponents.length && <div className="history-block"><h4>Common opponents</h4>{profile.commonOpponents.map((line) => <p key={`${line.other}-${line.opponent}`}>{line.opponent}<span>{profile.name} {line.mine.wins}–{line.mine.losses} · {line.other} {line.theirs.wins}–{line.theirs.losses}</span></p>)}</div>}
    </details>
  );
}

function ordinal(value: number) {
  if (value % 100 >= 11 && value % 100 <= 13) return "th";
  return value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th";
}
