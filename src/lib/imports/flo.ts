import { createHash } from "node:crypto";
import { MATCH_IMPORT_COLUMNS, parseCsv, validateNormalizedMatchCsv, type MatchImportRow } from "./matches-csv";
import { decodeFlo, FLO_LIMITS } from "./flo-archive";

export const FLO_VERSION = "flo-results-v1";
export const FLO_HEADERS = ["Date", "Weight", "Round", "Winning Wrestler", "Winning Team", "Result", "Win Type", "Losing Wrestler", "Losing Team", "City", "State", "Event"];
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export type BaselineRow = Omit<MatchImportRow, "source_file" | "source_row"> & { source_file: string | null; source_row: number | null };
const fields = MATCH_IMPORT_COLUMNS.filter(c => c !== "source_file" && c !== "source_row" && c !== "season");
export const boutSignature = (row: BaselineRow) => sha256(JSON.stringify([FLO_VERSION, ...fields.map(c => row[c])]));
const eventKey = (r: BaselineRow) => JSON.stringify([r.event_date, r.event_name, r.city, r.state]);
const pairKey = (r: BaselineRow) => JSON.stringify([eventKey(r), r.weight_class, ...[r.winner_name, r.loser_name].sort()]);
export function csvRecord(cells: unknown[]): string { return cells.map(c => '"' + String(c).replaceAll('"', '""') + '"').join(","); }
export function normalizedCsv(rows: MatchImportRow[]): string {
  return [csvRecord([...MATCH_IMPORT_COLUMNS]), ...rows.map(r => csvRecord(MATCH_IMPORT_COLUMNS.map(c => r[c])))].join("\n") + "\n";
}

// Length prefixes distinguish null, delimiters, newlines and Unicode without JSON serializer differences.
export function baselineFingerprint(rows: BaselineRow[]): string {
  const encoded = rows.map(r => MATCH_IMPORT_COLUMNS.map(c => r[c] === null ? "-:" : `${Buffer.byteLength(String(r[c]), "utf8")}:${r[c]}`).join(""));
  encoded.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return sha256(encoded.join("\n"));
}
export const databaseFingerprintSql = () => {
  const encoded = MATCH_IMPORT_COLUMNS.map(c => `case when ${c} is null then '-:' else octet_length(${c}::text)::text || ':' || ${c}::text end`).join(" || ");
  return `select encode(sha256(convert_to(coalesce(string_agg(encoded, E'\\n' order by encoded collate "C"), ''), 'UTF8')), 'hex') from (select ${encoded} as encoded from public.matches) s`;
};

export function validateBaseline(value: unknown): BaselineRow[] {
  if (!Array.isArray(value) || value.length > 250000) throw new Error("Baseline must be a complete matches JSON array (max 250000)");
  return value.map((r, i) => {
    if (!r || typeof r !== "object") throw new Error(`Invalid baseline row ${i}`);
    for (const c of MATCH_IMPORT_COLUMNS) {
      if (c === "source_row" ? r[c] !== null && (!Number.isSafeInteger(r[c]) || r[c] <= 1) :
        c === "source_file" && r[c] === null ? false : typeof r[c] !== "string") throw new Error(`Invalid baseline ${c} at ${i}`);
    }
    const row = Object.fromEntries(MATCH_IMPORT_COLUMNS.map(c => [c, r[c]])) as BaselineRow;
    return row;
  });
}

export type FloRecord = { member: string; fileSha256: string; sourceRow: number; raw: string[];
  normalized?: MatchImportRow; signature?: string; status: "accepted" | "already_seen" | "blocked";
  issues: string[]; administrative: boolean; repeatedPair: boolean };
export type FloMember = { path: string; bytes: Buffer; error?: string; containerSha256?: string };
export type FloManifest = ReturnType<typeof prepareFlo>;

export function prepareFlo(members: FloMember[], season: string, baseline?: BaselineRow[]) {
  if (!season.trim() || season.length > 20) throw new Error("Explicit reviewed season required (max 20 characters)");
  const started = Date.now();
  const records: FloRecord[] = [];
  const files: Array<{ path: string; sha256: string; bytes: number; error?: string; rows: number; containerSha256?: string }> = [];
  const known = new Map<string, BaselineRow[]>(), oldPairs = new Set<string>(), names = new Set<string>();
  for (const r of baseline ?? []) {
    const sig = boutSignature(r);
    known.set(sig, [...(known.get(sig) ?? []), r]); oldPairs.add(pairKey(r));
    names.add(r.winner_name); names.add(r.loser_name);
  }
  let totalBytes = 0;
  if (!members.length || members.length > FLO_LIMITS.members) throw new Error("Member count limit");
  for (const member of members) {
    if ((totalBytes += member.bytes.length) > FLO_LIMITS.totalBytes || member.bytes.length > FLO_LIMITS.memberBytes) throw new Error("CSV resource limit");
    const file = { path: member.path, sha256: sha256(member.bytes), bytes: member.bytes.length, rows: 0, error: member.error, containerSha256: member.containerSha256 };
    files.push(file);
    try {
      if (member.error) continue;
      const unwrap = (v: string) => /^="(?:[^"]|"")*"$/.test(v) ? v.slice(2, -1).replaceAll('""', '"') : v;
      const csv = parseCsv(decodeFlo(member.bytes), true);
      const header = csv[0]?.map(unwrap);
      if (!header || header.length !== FLO_HEADERS.length || new Set(header).size !== header.length || FLO_HEADERS.some(c => !header.includes(c))) throw new Error("Unsupported Flo header; expected observed 12-column results export");
      const indexes = FLO_HEADERS.map(c => header.indexOf(c));
      file.rows = csv.length - 1;
      if (records.length + file.rows > FLO_LIMITS.rows) throw new Error("CSV row limit");
      for (let i = 1; i < csv.length; i++) {
        const record: FloRecord = { member: member.path, fileSha256: file.sha256, sourceRow: i + 1, raw: csv[i], status: "blocked", issues: [], administrative: false, repeatedPair: false };
        records.push(record);
        try {
          if (csv[i].length !== header.length) throw new Error("CSV cell count mismatch");
          const [date, weight, round, winner, winnerTeam, result, method, loser, loserTeam, city, state, event] = indexes.map(j => unwrap(csv[i][j]).trim());
          const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);
          if (!m) throw new Error("Unsupported date; expected observed M/D/YYYY");
          const normalized: MatchImportRow = { event_date: `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`, season,
            event_name: event, city, state, weight_class: weight, round, winner_name: winner, winner_team: winnerTeam,
            loser_name: loser, loser_team: loserTeam, result, win_type: method, source_file: "pending", source_row: 2 };
          const report = validateNormalizedMatchCsv(normalizedCsv([normalized]));
          record.normalized = normalized;
          record.signature = boutSignature(normalized);
          normalized.source_file = `flo-v1/${record.signature}`;
          if (report.unrecognizedMethods.length || method === "OTHER1") throw new Error("Unknown outcome requires source review");
          if ([winner, loser].some(n => /^(bye|unknown|tbd|unattached wrestler)$/i.test(n)) || winner.toLowerCase() === loser.toLowerCase()) throw new Error("Placeholder/self identity requires review");
          record.administrative = !["F", "DEC", "TF", "MD"].includes(method);
          const previous = known.get(record.signature) ?? [];
          if (!baseline) record.issues.push("baseline_required");
          else if (previous.some(r => r.source_file === normalized.source_file && r.source_row === 2 &&
            MATCH_IMPORT_COLUMNS.every(c => r[c] === normalized[c]))) record.status = "already_seen";
          else if (previous.length) record.issues.push("possible_duplicate_legacy_or_reexport");
          else if (oldPairs.has(pairKey(normalized))) record.issues.push("possible_correction_or_rematch");
          else record.status = "accepted";
        } catch (e) { record.issues.push(e instanceof Error ? e.message : String(e)); }
        if (Date.now() - started > FLO_LIMITS.milliseconds) throw new Error("CSV time limit");
      }
    } catch (e) { file.error = e instanceof Error ? e.message : String(e); }
  }
  for (const file of files.filter(f => f.error)) for (const record of records.filter(r => r.member === file.path)) {
    record.status = "blocked"; record.issues.push("member_failed_validation");
  }
  // Identical source rows are ambiguous without bout IDs. Quarantine, never collapse them.
  // Exact copies of a whole CSV are demonstrably reuploads; retain each sighting in the manifest.
  const groups = new Map<string, FloRecord[]>(), pairs = new Map<string, FloRecord[]>();
  for (const r of records) if (r.normalized && r.signature) {
    groups.set(r.signature, [...(groups.get(r.signature) ?? []), r]);
    const pair = pairKey(r.normalized); pairs.set(pair, [...(pairs.get(pair) ?? []), r]);
  }
  for (const group of groups.values()) if (group.length > 1) {
    const seen = new Set<string>();
    const distinctSources = new Set(group.map(x => `${x.fileSha256}/${x.sourceRow}`)).size;
    for (const r of group) {
      const source = `${r.fileSha256}/${r.sourceRow}`;
      if (distinctSources > 1) {
        r.status = "blocked"; r.issues.push("identical_bout_rows_need_evidence");
      } else if (seen.has(source) && r.status === "accepted") r.status = "already_seen";
      seen.add(source);
    }
  }
  for (const group of pairs.values()) if (group.length > 1) {
    const crossExport = new Set(group.map(r => r.fileSha256)).size > 1;
    for (const r of group) {
      r.repeatedPair = true;
      if (crossExport && r.status === "accepted") { r.status = "blocked"; r.issues.push("cross_export_correction_or_rematch"); }
    }
  }
  const events = new Set(records.filter(r => r.normalized).map(r => eventKey(r.normalized!)));
  const incoming = new Set(records.map(r => r.signature).filter(Boolean));
  const missing = (baseline ?? []).filter(r => events.has(eventKey(r)) && !incoming.has(boutSignature(r)));
  const counts = { rows: records.length, accepted: records.filter(r => r.status === "accepted").length,
    alreadySeen: records.filter(r => r.status === "already_seen").length, blocked: records.filter(r => r.status === "blocked").length,
    administrativePreserved: records.filter(r => r.administrative).length, failedMembers: files.filter(f => f.error).length };
  const newNames = [...new Set(records.flatMap(r => r.normalized ? [r.normalized.winner_name, r.normalized.loser_name] : []))].filter(n => !names.has(n)).sort();
  return { version: FLO_VERSION, season, baselineFingerprint: baseline ? baselineFingerprint(baseline) : null,
    files, counts, events: [...events].sort(), records, missingFromNewExport: missing,
    identityReviewCandidates: newNames, warnings: ["No identity merges; same-name identity limitation remains.",
      "Administrative outcomes are retained as raw evidence and excluded by the existing rating policy.",
      "Missing rows never delete previous bouts. Repeated pairs are diagnostics, not duplicate proof."], writesPerformed: false };
}
