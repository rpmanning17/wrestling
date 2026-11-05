/** Offline validator for the normalized Mat Notes match CSV format, NOT raw Flo exports.
 * Strict source_file/source_row provenance is required. No database access in this module.
 */
export const MATCH_IMPORT_COLUMNS = [
  "event_date", "season", "event_name", "city", "state", "weight_class", "round",
  "winner_name", "winner_team", "loser_name", "loser_team", "result", "win_type",
  "source_file", "source_row",
] as const;

type StringColumn = Exclude<(typeof MATCH_IMPORT_COLUMNS)[number], "source_row">;
export type MatchImportRow = Record<StringColumn, string> & { source_row: number };

const REQUIRED = new Set(["event_date", "season", "event_name", "weight_class", "winner_name", "loser_name", "win_type", "source_file"]);
const LENGTHS: Partial<Record<StringColumn, number>> = {
  season: 20, event_name: 160, city: 100, state: 10, weight_class: 40,
  round: 80, winner_name: 100, winner_team: 160, loser_name: 100,
  loser_team: 160, result: 80, win_type: 20, source_file: 160,
};

/** Handles quoted commas, embedded newlines, escaped quotes, BOM and CRLF. */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  let closedQuote = false;
  let atStart = true;
  const field = () => { record.push(cell); cell = ""; atStart = true; closedQuote = false; };
  const row = () => { field(); if (record.some(value => value !== "")) records.push(record); record = []; };
  const source = text.startsWith("\ufeff") ? text.slice(1) : text;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { cell += '"'; i += 1; }
        else { quoted = false; closedQuote = true; }
      } else cell += ch;
    } else if (ch === ",") field();
    else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row();
    } else if (ch === '"' && atStart) { quoted = true; atStart = false; }
    else if (ch === '"' || closedQuote) throw new Error(`Malformed CSV quote near character ${i}`);
    else { cell += ch; atStart = false; }
  }
  if (quoted) throw new Error("Unclosed CSV quoted field");
  if (record.length || cell !== "" || closedQuote) row();
  return records;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export type MatchCsvReport = {
  rows: MatchImportRow[];
  files: number;
  firstDate: string;
  lastDate: string;
  methods: Record<string, number>;
  repeatedPairGroups: number;
  oppositeWinnerGroups: number;
  unrecognizedMethods: string[];
};

const KNOWN_METHODS = new Set(["F", "DEC", "TF", "MD", "FOR", "DEF", "M FOR", "DQ", "MFFL", "NC", "OTHER1"]);

export function validateNormalizedMatchCsv(text: string): MatchCsvReport {
  const records = parseCsv(text);
  if (records.length < 2) throw new Error("Expected a header and at least one match row");
  const header = records[0].map(h => h.trim());
  const extras = header.filter(x => !MATCH_IMPORT_COLUMNS.includes(x as (typeof MATCH_IMPORT_COLUMNS)[number]) && x !== "index" && x !== "Unnamed: 0");
  if (extras.length) throw new Error(`Unsupported CSV columns: ${extras.join(", ")}. Use normalized Mat Notes match exports, not raw Flo CSV files.`);
  for (const key of MATCH_IMPORT_COLUMNS) {
    if (header.filter(h => h === key).length !== 1) throw new Error(`Missing or duplicate required column: ${key}`);
  }
  if (new Set(header).size !== header.length) throw new Error("Duplicate CSV headers");
  const lookup = new Map(header.map((name, i) => [name, i]));
  const rows: MatchImportRow[] = [];
  const sourceKeys = new Set<string>();
  const groupWinners = new Map<string, Set<string>>();
  const groupCounts = new Map<string, number>();
  const methods: Record<string, number> = {};
  for (let i = 1; i < records.length; i += 1) {
    const cells = records[i];
    if (cells.length !== header.length) throw new Error(`CSV record ${i + 1}: expected ${header.length} cells, received ${cells.length}`);
    const value = (key: StringColumn) => cells[lookup.get(key)!].trim();
    const row = Object.fromEntries(MATCH_IMPORT_COLUMNS.filter(x => x !== "source_row")
      .map(key => [key, value(key as StringColumn)])) as Record<StringColumn, string>;
    const rawSourceRow = cells[lookup.get("source_row")!].trim();
    const sourceRow = Number(rawSourceRow);
    if (!Number.isSafeInteger(sourceRow) || sourceRow <= 1 || !/^\d+$/.test(rawSourceRow)) {
      throw new Error(`CSV record ${i + 1}: source_row must be an integer greater than 1`);
    }
    for (const [key, size] of Object.entries(LENGTHS) as Array<[StringColumn, number]>) {
      if (row[key].length > size) throw new Error(`CSV record ${i + 1}: ${key} exceeds database length ${size}`);
    }
    for (const key of REQUIRED) {
      if (!row[key as StringColumn]) throw new Error(`CSV record ${i + 1}: ${key} is required`);
    }
    if (!validDate(row.event_date)) throw new Error(`CSV record ${i + 1}: invalid event_date`);
    const sourceKey = JSON.stringify([row.source_file, sourceRow]);
    if (sourceKeys.has(sourceKey)) throw new Error(`CSV record ${i + 1}: repeated source_file/source_row ${sourceKey}`);
    sourceKeys.add(sourceKey);
    const fullRow: MatchImportRow = { ...row, source_row: sourceRow };
    rows.push(fullRow);
    methods[row.win_type] = (methods[row.win_type] ?? 0) + 1;

    // Diagnostic only: matches can genuinely repeat at one event (even opposite results).
    const a = row.winner_name.trim().toLowerCase();
    const b = row.loser_name.trim().toLowerCase();
    const group = JSON.stringify([row.event_date, row.event_name.toLowerCase(), row.weight_class, ...[a,b].sort()]);
    groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
    const winners = groupWinners.get(group) ?? new Set<string>();
    winners.add(a);
    groupWinners.set(group, winners);
  }
  return {
    rows,
    files: new Set(rows.map(x => x.source_file)).size,
    firstDate: rows.reduce((min, x) => x.event_date < min ? x.event_date : min, rows[0].event_date),
    lastDate: rows.reduce((max, x) => x.event_date > max ? x.event_date : max, rows[0].event_date),
    methods,
    repeatedPairGroups: [...groupCounts.values()].filter(n => n > 1).length,
    oppositeWinnerGroups: [...groupWinners].filter(([g,winners]) => (groupCounts.get(g) ?? 0) > 1 && winners.size > 1).length,
    unrecognizedMethods: Object.keys(methods).filter(method => !KNOWN_METHODS.has(method)).sort(),
  };
}

/** Idempotent administrator-only SQL, generated offline and reviewed before execution.
 * Existing source_file/source_row pairs must match ALL supplied fields; no overwrite/delete.
 * The final comparison catches conflicting inserts racing between precheck and ON CONFLICT.
 * Statements are transactional; no partial batch can survive an exception.
 */
export function guardedMatchImportSql(rows: MatchImportRow[]): string {
  if (!rows.length || rows.length > 250) throw new Error("Use a nonempty batch of at most 250 matches");
  const keys = rows.map(r => JSON.stringify([r.source_file, r.source_row]));
  if (new Set(keys).size !== rows.length) throw new Error("Repeated batch source identity");
  const lit = (s: string) => "'" + s.replaceAll("'", "''") + "'";
  const definition = MATCH_IMPORT_COLUMNS.map(c => c === "source_row" ? "source_row integer" : c === "event_date" ? "event_date date" : `${c} text`).join(",");
  const columns = MATCH_IMPORT_COLUMNS.join(",");
  const tuple = "(" + MATCH_IMPORT_COLUMNS.map(c => `m.${c}`).join(",") + ")";
  const candidate = "(" + MATCH_IMPORT_COLUMNS.map(c => `e.${c}`).join(",") + ")";
  const parse = `jsonb_to_recordset(payload) as e(${definition})`;
  const body = `declare payload jsonb := ${lit(JSON.stringify(rows))}::jsonb;
begin
  if exists (
    select 1 from ${parse}
    join public.matches m on m.source_file=e.source_file and m.source_row=e.source_row
    where ${tuple} is distinct from ${candidate}
  ) then raise exception 'Match import conflicting existing source row'; end if;

  insert into public.matches (${columns})
  select ${MATCH_IMPORT_COLUMNS.map(c => `e.${c}`).join(",")} from ${parse}
  on conflict (source_file,source_row) do nothing;

  if exists (
    select 1 from ${parse}
    left join public.matches m on m.source_file=e.source_file and m.source_row=e.source_row
    where m.id is null or ${tuple} is distinct from ${candidate}
  ) then raise exception 'Match import incomplete or conflicting after insert'; end if;
end`;
  return `do ${lit(body)};`;
}
