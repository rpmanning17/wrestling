/** Raw tournament export adapters for the agent release pipeline (docs/RELEASE_PIPELINE.md).
 * Pure functions: no I/O. Every adapter emits the existing normalized Mat Notes match CSV and the
 * result is re-validated by validateNormalizedMatchCsv, so normalization rules live in one place.
 * Values are preserved verbatim except the spreadsheet ="..." text wrapper. source_row is the
 * original physical line number (header = 1), matching every prior Flo-archive import.
 */
import { MATCH_IMPORT_COLUMNS, parseCsv, validateNormalizedMatchCsv, type MatchCsvReport } from "./matches-csv";

export const RESULTS_PROVIDERS = ["flo", "trackwrestling", "usa_bracketing", "normalized"] as const;
export type ResultsProvider = typeof RESULTS_PROVIDERS[number];

/** Results-table layout shared by the Flo/Trackwrestling exports already in production. */
export const RESULTS_TABLE_HEADER = ["Date", "Weight", "Round", "Winning Wrestler", "Winning Team", "Result",
  "Win Type", "Losing Wrestler", "Losing Team", "City", "State", "Event"] as const;

export type ImportRequest = {
  /** Stable provenance label stored in matches.source_file, e.g. "SomersetSundayFallBrawl.csv". */
  source_file: string;
  /** Division prefixes to import, e.g. ["10U","12U","14U"]. Everything else is excluded and counted. */
  divisions: string[];
  /** Optional season override; otherwise the August 1 season boundary used by existing rows. */
  season?: string;
  /** Expected counts from the owner/agent review; a mismatch stops the release. */
  expect?: { source_rows?: number; imported?: number; excluded?: number };
};

export type AdaptedResults = {
  normalizedCsv: string;
  report: MatchCsvReport;
  sourceRows: number;
  excluded: { division: Record<string, number>; byes: number; total: number };
};

export function seasonFor(isoDate: string) {
  const year = Number(isoDate.slice(0, 4)), month = Number(isoDate.slice(5, 7));
  const start = month >= 8 ? year : year - 1;
  return `${start}–${start + 1}`;
}

const unwrap = (cell: string) => {
  const match = /^="([\s\S]*)"$/.exec(cell);
  return match ? match[1] : cell;
};

const csvCell = (value: string | number) => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
};

function toIsoDate(value: string) {
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  throw new Error("Unrecognized result date " + JSON.stringify(value));
}

function validateRequest(request: ImportRequest) {
  if (!request || typeof request.source_file !== "string" || !/^[^/\\\0]{1,160}$/.test(request.source_file)) {
    throw new Error("Request needs a source_file provenance label (no path separators)");
  }
  if (!Array.isArray(request.divisions) || !request.divisions.length ||
      request.divisions.some(d => typeof d !== "string" || !/^[A-Za-z0-9]{1,12}$/.test(d))) {
    throw new Error("Request needs an explicit divisions list, e.g. [\"10U\",\"12U\",\"14U\"]");
  }
}

/** Flo and Trackwrestling results-table exports (the layout of every archived production import). */
export function adaptResultsTable(text: string, request: ImportRequest): AdaptedResults {
  validateRequest(request);
  const body = text.startsWith("﻿") ? text.slice(1) : text;
  const physical = body.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const records = parseCsv(body).map(cells => cells.map(unwrap));
  // source_row must equal the physical line: refuse embedded newlines or blank lines.
  if (records.length !== physical.length) throw new Error("Embedded newlines or blank lines: source_row would not equal the original line");
  const header = records[0];
  if (!header || header.length !== RESULTS_TABLE_HEADER.length || header.some((h, i) => h !== RESULTS_TABLE_HEADER[i])) {
    throw new Error("Unsupported results layout. Expected header: " + RESULTS_TABLE_HEADER.join(","));
  }
  const prefixes = new Set(request.divisions);
  const out: string[] = [MATCH_IMPORT_COLUMNS.join(",")];
  const excluded = { division: {} as Record<string, number>, byes: 0, total: 0 };
  for (let i = 1; i < records.length; i++) {
    if (records[i].length !== header.length) throw new Error(`Line ${i + 1}: expected ${header.length} cells`);
    const r = Object.fromEntries(RESULTS_TABLE_HEADER.map((h, j) => [h, records[i][j]])) as Record<string, string>;
    const division = r["Weight"].split(/\s+/)[0] ?? "";
    if (!prefixes.has(division)) {
      excluded.division[division || "(none)"] = (excluded.division[division || "(none)"] ?? 0) + 1;
      if (r["Win Type"] === "BYE") excluded.byes++;
      excluded.total++;
      continue;
    }
    if (r["Win Type"] === "BYE" || !r["Winning Wrestler"] || !r["Losing Wrestler"]) {
      throw new Error(`Line ${i + 1}: selected division row lacks two participants`);
    }
    const date = toIsoDate(r["Date"]);
    const row: Record<string, string | number> = {
      event_date: date, season: request.season ?? seasonFor(date), event_name: r["Event"], city: r["City"],
      state: r["State"], weight_class: r["Weight"], round: r["Round"], winner_name: r["Winning Wrestler"],
      winner_team: r["Winning Team"], loser_name: r["Losing Wrestler"], loser_team: r["Losing Team"],
      result: r["Result"], win_type: r["Win Type"], source_file: request.source_file, source_row: i + 1,
    };
    out.push(MATCH_IMPORT_COLUMNS.map(c => csvCell(row[c])).join(","));
  }
  if (out.length < 2) throw new Error("No rows in the requested divisions");
  const normalizedCsv = out.join("\n") + "\n";
  const report = validateNormalizedMatchCsv(normalizedCsv);
  if (report.unrecognizedMethods.length) throw new Error("Unreviewed win_type codes: " + report.unrecognizedMethods.join(", "));
  const adapted = { normalizedCsv, report, sourceRows: records.length - 1, excluded };
  checkExpectations(adapted, request);
  return adapted;
}

/** Already-normalized Mat Notes match CSV (division filter still applies to weight_class). */
export function adaptNormalized(text: string, request: ImportRequest): AdaptedResults {
  validateRequest(request);
  const report = validateNormalizedMatchCsv(text);
  if (report.unrecognizedMethods.length) throw new Error("Unreviewed win_type codes: " + report.unrecognizedMethods.join(", "));
  if (report.rows.some(r => r.source_file !== request.source_file)) throw new Error("Normalized rows must use the requested source_file label");
  const keep = report.rows.filter(r => request.divisions.includes(r.weight_class.split(/\s+/)[0]));
  const excluded = { division: {} as Record<string, number>, byes: 0, total: report.rows.length - keep.length };
  for (const r of report.rows) if (!keep.includes(r)) {
    const d = r.weight_class.split(/\s+/)[0] || "(none)"; excluded.division[d] = (excluded.division[d] ?? 0) + 1;
  }
  const normalizedCsv = [MATCH_IMPORT_COLUMNS.join(","), ...keep.map(r => MATCH_IMPORT_COLUMNS.map(c => csvCell(r[c])).join(","))].join("\n") + "\n";
  const adapted = { normalizedCsv, report: validateNormalizedMatchCsv(normalizedCsv), sourceRows: report.rows.length, excluded };
  checkExpectations(adapted, request);
  return adapted;
}

function checkExpectations(adapted: AdaptedResults, request: ImportRequest) {
  const e = request.expect ?? {};
  const actual = { source_rows: adapted.sourceRows, imported: adapted.report.rows.length, excluded: adapted.excluded.total };
  for (const key of Object.keys(e) as Array<keyof typeof actual>) {
    if (e[key] !== undefined && e[key] !== actual[key]) {
      throw new Error(`Expected ${key}=${e[key]} but source has ${actual[key]}`);
    }
  }
}

export function adaptResults(provider: ResultsProvider, text: string, request: ImportRequest): AdaptedResults {
  if (provider === "flo" || provider === "trackwrestling") return adaptResultsTable(text, request);
  if (provider === "normalized") return adaptNormalized(text, request);
  throw new Error("USA Bracketing sources are reviewed JSON packages imported through private.import_usa_bracketing_verified");
}
