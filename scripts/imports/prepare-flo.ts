/** Offline Flo adapter. No credentials, network calls or database execution. */
import { readFileSync, writeFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve, isAbsolute } from "node:path";
import { decodeFlo, FLO_LIMITS, readFloZip, safeMemberPath } from "../../src/lib/imports/flo-archive";
import { prepareFlo, sha256, validateBaseline, type FloMember } from "../../src/lib/imports/flo";
import { approvedFloSql } from "../../src/lib/imports/flo-sql";

function main() {
  const args = process.argv.slice(2), options = new Map<string, string>(), inputs: string[] = [];
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!value || value.startsWith("--")) throw new Error("Expected --input <CSV/ZIP> (repeatable) --season <label> --report <private.json> [--baseline <snapshot.json>] [--sql <private.sql> --approve <manifest SHA256> --approval-reference <reference> --select <signatures.json>]");
    if (key === "--input") inputs.push(value);
    else if (!["--season", "--report", "--baseline", "--sql", "--approve", "--approval-reference", "--select"].includes(key) || options.has(key)) throw new Error("Unsupported/repeated option " + key);
    else options.set(key, value);
  }
  if (!inputs.length || inputs.length > 16 || !options.get("--season") || !options.get("--report")) throw new Error("Explicit input(s), season and private report destination required");
  const root = realpathSync(resolve(__dirname, "../.."));
  const destinations = [options.get("--report")!, options.get("--sql")].filter(Boolean).map(p => {
    const dest = resolve(p!);
    const parent = realpathSync(dirname(dest));
    const actual = resolve(parent, basename(dest));
    const rel = relative(root, actual);
    if (!rel || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error("Participant-containing output must be outside the repository (including symlinks)");
    return actual;
  });
  if (new Set(destinations.map(p => p.toLowerCase())).size !== destinations.length) throw new Error("Output paths must differ");
  const members: FloMember[] = [], sources: Array<{ name: string; sha256: string; bytes: number }> = [];
  let inputBytes = 0;
  for (const path of inputs) {
    const size = statSync(path).size;
    if (size > FLO_LIMITS.inputBytes || (inputBytes += size) > FLO_LIMITS.totalBytes) throw new Error("Input size limit");
    const bytes = readFileSync(path), name = basename(path);
    sources.push({ name, sha256: sha256(bytes), bytes: bytes.length });
    if (/\.zip$/i.test(name)) for (const member of readFloZip(bytes)) members.push({ ...member, path: name + "/" + member.path, containerSha256: sha256(bytes) });
    else if (/\.csv$/i.test(name)) { safeMemberPath(name); members.push({ path: name, bytes }); }
    else throw new Error("Only CSV and ZIP inputs supported");
  }
  let baseline;
  if (options.get("--baseline")) {
    const path = options.get("--baseline")!;
    if (statSync(path).size > 128 * 1024 * 1024) throw new Error("Baseline size limit");
    baseline = validateBaseline(JSON.parse(decodeFlo(readFileSync(path))));
  }
  const manifest = { ...prepareFlo(members, options.get("--season")!, baseline), sources };
  const manifestSha256 = sha256(JSON.stringify(manifest));
  let sql;
  if (options.get("--sql")) {
    const selection: unknown = options.has("--select") ? JSON.parse(readFileSync(options.get("--select")!, "utf8")) : undefined;
    if (selection !== undefined && (!Array.isArray(selection) || selection.some(x => typeof x !== "string"))) throw new Error("Selection must be an array of signatures");
    sql = approvedFloSql(manifest, options.get("--approve") ?? "", options.get("--approval-reference") ?? "", selection as string[] | undefined);
  } else if (["--approve", "--approval-reference", "--select"].some(k => options.has(k))) throw new Error("Approval/selection options require --sql");
  // Exclusive writes preserve previous evidence; a failed second write is recoverable by choosing new paths.
  writeFileSync(destinations[0], JSON.stringify({ manifestSha256, manifest }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  if (sql) writeFileSync(destinations[1], sql, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ manifestSha256, ...manifest.counts, files: manifest.files.length, events: manifest.events.length,
    baselineProvided: !!baseline, missingFromNewExport: manifest.missingFromNewExport.length,
    identityReviewCandidates: manifest.identityReviewCandidates.length, writesPerformed: false, sqlPrepared: !!sql }, null, 2));
}
try { main(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }
