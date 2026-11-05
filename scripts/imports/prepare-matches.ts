/** Safe offline staging for normalized Mat Notes bouts.
 *
 *   node --import tsx scripts/imports/prepare-matches.ts --input /private/normalized.csv
 *   node --import tsx scripts/imports/prepare-matches.ts --input /private/normalized.csv --out /private/import.sql
 *
 * No database connection or writes. Generated SQL contains participant data: keep it OUTSIDE Git.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { guardedMatchImportSql, validateNormalizedMatchCsv } from "../../src/lib/imports/matches-csv";

function main() {
  const args = process.argv.slice(2);
  const opts = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith("--") || !args[i + 1] || args[i + 1].startsWith("--")) {
      throw new Error("Expected --input <normalized.csv> [--out <private.sql>] [--batch-size 1..250] [--report <summary.json>]");
    }
    const name = args[i].slice(2);
    if (!["input", "out", "batch-size", "report"].includes(name) || opts.has(name)) throw new Error("Unsupported or repeated option " + name);
    opts.set(name, args[i + 1]);
  }
  const input = opts.get("input");
  if (!input) throw new Error("Explicit --input normalized match CSV required");
  const file = readFileSync(input, "utf8");
  const report = validateNormalizedMatchCsv(file);
  const size = opts.has("batch-size") ? Number(opts.get("batch-size")) : 150;
  if (!Number.isSafeInteger(size) || size < 1 || size > 250) throw new Error("--batch-size must be 1..250");
  if (report.unrecognizedMethods.length) {
    throw new Error("Unrecognized win_type codes require source review: " + report.unrecognizedMethods.join(", "));
  }
  const manifest = {
    inputSha256: createHash("sha256").update(file).digest("hex"),
    rows: report.rows.length,
    sourceFiles: report.files,
    firstDate: report.firstDate, lastDate: report.lastDate,
    methods: report.methods,
    repeatedPairGroups: report.repeatedPairGroups,
    oppositeWinnerGroups: report.oppositeWinnerGroups,
    batches: Math.ceil(report.rows.length / size),
    writesPerformed: false,
    message: "Source-key and rematch diagnostics only; original records preserved. SQL needs authorized manual review before use.",
  };
  const output = opts.get("out");
  if (output) {
    const dest = resolve(output);
    const projectRoot = resolve(process.cwd());
    if (dest === projectRoot || dest.startsWith(projectRoot + sep)) {
      throw new Error("Write participant-containing SQL outside the repository");
    }
    // Per-batch DO statements are atomic and fail if an existing pair conflicts.
    const header = [
      "-- Mat Notes normalized match import (ADMINISTRATOR ONLY).",
      "-- Read-only staging generated these statements. Do not execute until reviewed.",
      "-- CSV SHA-256: " + manifest.inputSha256,
      "-- Source count: " + manifest.rows,
      "-- Back up/verify raw source before execution; refresh evidence and ratings separately.",
    ].join("\n");
    const sql = [header];
    for (let i = 0; i < report.rows.length; i += size) {
      sql.push("-- Batch " + (Math.floor(i / size) + 1));
      sql.push(guardedMatchImportSql(report.rows.slice(i, i + size)));
    }
    writeFileSync(dest, sql.join("\n\n") + "\n", { flag: "wx", mode: 0o600 });
  }
  if (opts.get("report")) {
    const path = opts.get("report")!;
    writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  }
  console.log(JSON.stringify(manifest, null, 2));
  console.log(output ? "Prepared private, guarded SQL. No database writes performed." : "Validation only. No database writes performed.");
}

try { main(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }
