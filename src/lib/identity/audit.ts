import { createHash } from "node:crypto";

export const IDENTITY_AUDIT_VERSION = "identity-audit-v1";
// id,date,event,city,state,bracket,round,winner,team,loser,team,result,method,source_file,source_row
export type AuditMatch = [string,string,string,string,string,string,string,string,string,string,string,string,string,string|null,number|null];
export type ContextRow = { id: number; athlete_name: string; team: string; event_date: string; event_name: string;
  city?: string; state?: string; age_group?: string|null; bracket_weight_lbs?: number|null;
  source_athlete_name?: string; identity_resolution?: string; [key: string]: unknown };
export type IdentitySnapshot = { matches: AuditMatch[];
  aliases: Array<{ alias_key: string; canonical_key: string; canonical_name: string }>;
  clubs: Array<{ alias_key: string; club_key: string }>;
  entries: ContextRow[]; observations: ContextRow[]; source_checksum?: string };
export type AuditDecision = { caseId: string; evidenceHash: string; disposition: "unresolved"|"keep_separate"; reason: string };
export const identityKey = (name: string) => name.replace(/^ +| +$/g, "").toLowerCase();
const clubKey = (name: string) => identityKey(name).replace(/[^a-z0-9]+/g, " ");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const weight = (label: string) => {
  // Only unambiguous numeric bracket labels; no bodyweight/age inference.
  const m = /^(\d{2,3})(?:\s*(?:lb|lbs))?$/i.exec(label.trim());
  const n = m ? Number(m[1]) : NaN;
  return n >= 30 && n <= 400 ? n : null;
};
type Appearance = { row: AuditMatch; key: string; opponent: string; club: string; bracket: number|null; event: string };
type Person = { key: string; labels: Set<string>; appearances: Appearance[]; contexts: Array<{ type: string; row: ContextRow }> };
export type IdentityCase = { caseId: string; evidenceHash: string; kind: string; keys: string[]; labels: string[][];
  priority: number; signals: string[]; affectedSourceBouts: number; opponentKeys: number;
  sourceRecords: AuditMatch[]; contextRecords: Array<{ type: string; row: ContextRow }>; decision?: AuditDecision };

export function validateIdentitySnapshot(value: unknown): IdentitySnapshot {
  if (!value || typeof value !== "object") throw new Error("Snapshot object required");
  const v = value as IdentitySnapshot;
  if (!Array.isArray(v.matches) || v.matches.length > 250000 || !Array.isArray(v.aliases) ||
    !Array.isArray(v.clubs) || !Array.isArray(v.entries) || !Array.isArray(v.observations)) throw new Error("Incomplete or oversized identity snapshot");
  const ids = new Set<string>();
  for (const r of v.matches) {
    if (!Array.isArray(r) || r.length !== 15 || r.slice(0,13).some(c => typeof c !== "string") ||
      (r[13] !== null && typeof r[13] !== "string") || (r[14] !== null && (!Number.isSafeInteger(r[14]) || r[14] <= 1)) || ids.has(r[0])) throw new Error("Invalid/duplicate source match in snapshot");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r[1])) throw new Error("Invalid snapshot date");
    ids.add(r[0]);
  }
  for (const a of v.aliases) if (typeof a.alias_key !== "string" || typeof a.canonical_key !== "string" || typeof a.canonical_name !== "string") throw new Error("Invalid wrestler alias");
  for (const c of v.clubs) if (typeof c.alias_key !== "string" || typeof c.club_key !== "string") throw new Error("Invalid club alias");
  for (const c of [...v.entries,...v.observations]) if (typeof c.athlete_name !== "string" || typeof c.team !== "string" || typeof c.event_date !== "string" || typeof c.event_name !== "string") throw new Error("Invalid entry/observation context");
  return v;
}

/** Candidate discovery only. No confidence score here proves identity or authorizes a merge. */
export function auditIdentities(snapshot: IdentitySnapshot, decisions: AuditDecision[] = []) {
  validateIdentitySnapshot(snapshot);
  const aliases = new Map(snapshot.aliases.map(a => [a.alias_key, a]));
  const clubs = new Map(snapshot.clubs.map(a => [a.alias_key, a.club_key]));
  const resolve = (name: string) => aliases.get(identityKey(name))?.canonical_key ?? identityKey(name);
  const people = new Map<string,Person>();
  let aliasAppearancesHandled = 0, administrativeSelfMatches = 0;
  const person = (name: string) => {
    const key = resolve(name);
    if (!key) return undefined;
    let p = people.get(key);
    if (!p) { p = { key, labels: new Set(), appearances: [], contexts: [] }; people.set(key,p); }
    p.labels.add(name);
    return p;
  };
  const sourceSelf = new Set<string>();
  for (const r of snapshot.matches) {
    for (const [name,team,opp] of [[r[7],r[8],r[9]],[r[9],r[10],r[7]]]) {
      const p = person(name); if (!p) continue;
      if (aliases.has(identityKey(name))) aliasAppearancesHandled++;
      const club = clubs.get(clubKey(team)) ?? `raw:${clubKey(team)}`;
      p.appearances.push({ row:r, key:p.key, opponent:resolve(opp), club, bracket:weight(r[5]),
        event:JSON.stringify([r[1],identityKey(r[2]),identityKey(r[3]),identityKey(r[4])]) });
    }
    if (resolve(r[7]) === resolve(r[9])) {
      if (["F","DEC","TF","MD"].includes(r[12].toUpperCase())) sourceSelf.add(resolve(r[7]));
      else administrativeSelfMatches++;
    }
  }
  for (const [type,rows] of [["entry",snapshot.entries],["observation",snapshot.observations]] as const) {
    for (const row of rows) person(row.athlete_name)?.contexts.push({ type,row });
  }
  const cases: IdentityCase[] = [];
  function add(kind: string, keys: string[], signals: string[], priority: number) {
    keys.sort(); const ps = keys.map(k => people.get(k)!);
    const sourceRecords = [...new Map(ps.flatMap(p => p.appearances.map(a => [a.row[0],a.row] as const))).values()].sort((a,b) => a[0].localeCompare(b[0]));
    const contextRecords = ps.flatMap(p => p.contexts).sort((a,b) => `${a.type}/${a.row.id}`.localeCompare(`${b.type}/${b.row.id}`));
    const caseId = hash([IDENTITY_AUDIT_VERSION,kind,keys]);
    const relevantClubs = [...new Set(ps.flatMap(p => p.appearances.map(a => a.club)))].sort();
    const evidenceHash = hash([IDENTITY_AUDIT_VERSION,keys,sourceRecords,contextRecords,relevantClubs]);
    cases.push({ caseId,evidenceHash,kind,keys,labels:ps.map(p => [...p.labels].sort()),priority,signals,
      affectedSourceBouts:sourceRecords.length,opponentKeys:new Set(ps.flatMap(p => p.appearances.map(a => a.opponent))).size,sourceRecords,contextRecords });
  }
  let geographicCandidates = 0;
  for (const p of people.values()) {
    if (sourceSelf.has(p.key)) add("same_name_source_self_match",[p.key],["Source names resolve to the same identity on both sides; could be a recording error or two people."],10000+p.appearances.length);
    const days = new Map<string,Appearance[]>();
    for (const a of p.appearances) { const group = days.get(a.row[1]) ?? []; group.push(a); days.set(a.row[1],group); }
    const conflicts: string[] = [];
    for (const [date,rows] of days) {
      const unique = [...new Map(rows.map(a => [JSON.stringify([a.event,a.club,a.row[5]]),a])).values()];
      let found = false;
      for (let i=0;i<unique.length && !found;i++) for (let j=i+1;j<unique.length;j++) {
        const a=unique[i],b=unique[j];
        // A club switch or double bracket alone never produces a case.
        if (a.event === b.event || a.club === b.club || a.club === "raw:" || b.club === "raw:") continue;
        const differentStates = a.row[4] && b.row[4] && identityKey(a.row[4]) !== identityKey(b.row[4]);
        const divergentBrackets = a.bracket && b.bracket && Math.max(a.bracket,b.bracket)/Math.min(a.bracket,b.bracket) >= 1.6;
        if (differentStates || divergentBrackets) { conflicts.push(`${date}: different events and clubs plus ${differentStates ? "different recorded states" : "widely separated bracket labels"}`); found=true;break; }
      }
    }
    if (conflicts.length) { add("same_name_context_conflict",[p.key],conflicts,5000+Math.min(1000,p.appearances.length)+conflicts.length*100); geographicCandidates++; }
  }
  // One-character deletion index finds insertions, omissions and substitutions without an all-pairs scan.
  const buckets = new Map<string,Set<string>>();
  for (const key of people.keys()) {
    const compact = key.replace(/[^\p{L}\p{N}]/gu,"");
    if (compact.length < 5 || compact.length > 80) continue;
    const forms = new Set([compact,...Array.from(compact,(_,i) => compact.slice(0,i)+compact.slice(i+1))]);
    for (const form of forms) { const group=buckets.get(form)??new Set();group.add(key);buckets.set(form,group); }
  }
  const proposed = new Set<string>();
  for (const bucket of buckets.values()) {
    const keys=[...bucket].sort();
    for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++) {
      const a=people.get(keys[i])!,b=people.get(keys[j])!, pair=JSON.stringify([a.key,b.key]);
      if (proposed.has(pair)) continue; proposed.add(pair);
      const ac=a.key.replace(/[^\p{L}\p{N}]/gu,""),bc=b.key.replace(/[^\p{L}\p{N}]/gu,"");
      if (!nearName(ac,bc)) continue;
      // Do not suggest combining relatives from surname-only similarity; context must overlap.
      const aClubs=new Set(a.appearances.filter(x=>x.club!=="raw:").map(x=>x.club));
      const sharedClubs=[...new Set(b.appearances.filter(x=>aClubs.has(x.club)).map(x=>x.club))];
      const aOpps=new Set(a.appearances.map(x=>x.opponent));
      const sharedOpps=[...new Set(b.appearances.filter(x=>aOpps.has(x.opponent)).map(x=>x.opponent))];
      const aContexts=new Set(a.appearances.map(x=>JSON.stringify([x.event,x.club,x.row[5]])));
      const sharedContexts=[...new Set(b.appearances.map(x=>JSON.stringify([x.event,x.club,x.row[5]])))].filter(x=>aContexts.has(x)).length;
      const directlyMet=a.appearances.some(x=>x.opponent===b.key);
      if (!sharedClubs.length && !sharedContexts && sharedOpps.length<2 && ac!==bc) continue;
      const signals=[ac===bc?"Names differ only in spacing/punctuation." : "Names are one character apart; similarity alone is not identity evidence.",
        `${sharedClubs.length} reviewed/raw club labels overlap; ${sharedOpps.length} shared opponents; ${sharedContexts} distinct event/club/bracket contexts overlap.`];
      if (directlyMet) signals.push("These names occur as opponents: preserve separately pending source review.");
      add("name_variant_review",[a.key,b.key],signals,(directlyMet?100:1000)+sharedContexts*20+sharedOpps.length*5+Math.min(500,a.appearances.length+b.appearances.length));
    }
  }
  const decisionMap = new Map<string,AuditDecision>();
  for(const d of decisions) {
    if (!d || !["unresolved","keep_separate"].includes(d.disposition) || !d.reason?.trim() || !/^[a-f0-9]{64}$/.test(d.caseId) || !/^[a-f0-9]{64}$/.test(d.evidenceHash) || decisionMap.has(d.caseId)) throw new Error("Invalid/duplicate audit decision");
    decisionMap.set(d.caseId,d);
  }
  let suppressed=0;
  const review=cases.filter(c => { const d=decisionMap.get(c.caseId); if(d?.evidenceHash===c.evidenceHash){c.decision=d;suppressed++;return false;}return true; });
  review.sort((a,b)=>b.priority-a.priority || a.caseId.localeCompare(b.caseId));
  return { version:IDENTITY_AUDIT_VERSION, sourceChecksum:snapshot.source_checksum??null, summary:{ sourceRows:snapshot.matches.length,
    participantAppearances:snapshot.matches.length*2, identities:people.size, entries:snapshot.entries.length, observations:snapshot.observations.length,
    casingVariantsAlreadyHandled:[...people.values()].filter(p=>p.labels.size>1 && new Set([...p.labels].map(identityKey)).size===1).length,
    existingAliasAppearancesHandled:aliasAppearancesHandled, administrativeSelfMatchesAlreadyExcluded:administrativeSelfMatches, sameNameContextCandidates:geographicCandidates,
    totalCases:cases.length,suppressedCases:suppressed,reviewCases:review.length }, cases:review,
    writesPerformed:false, warning:"Candidates are not confirmed identities. No merge, split, raw rewrite or rating activation is performed." };
}

function nearName(a: string,b: string): boolean {
  if(a===b)return true;
  if(Math.abs(a.length-b.length)>1)return false;
  if(a.length===b.length){const diff=[];for(let i=0;i<a.length;i++)if(a[i]!==b[i])diff.push(i);return diff.length===1;}
  if(a.length>b.length)[a,b]=[b,a];
  let i=0,j=0,skips=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;}else{if(++skips>1)return false;j++;}}return true;
}
