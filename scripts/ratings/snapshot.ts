/** Private connector export integrity. Never authorizes persistence or activation. */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const SNAPSHOT_KINDS = ["matches", "assignments", "people", "aliases"] as const;
type Kind = typeof SNAPSHOT_KINDS[number];
export type SnapshotBaseline = { kind: Kind; n: number; fingerprint: string }[];
const digest = (algorithm: string, text: string) => createHash(algorithm).update(text, "utf8").digest("hex");

/** Matches the atomic SQL baseline: SHA256 of ordered full-row MD5 hex strings.
 * Preserve PostgreSQL's exact JSON text, including nulls, whitespace and key order.
 * A complete match reconstructs that single statement's snapshot; counts alone do not.
 */
export function verifySnapshotPages(baseline: SnapshotBaseline, pages: Map<string, string[]>) {
  if (baseline.length !== SNAPSHOT_KINDS.length ||
      SNAPSHOT_KINDS.some(kind => baseline.filter(row => row.kind === kind).length !== 1)) {
    throw new Error("Baseline must identify each source table exactly once");
  }
  const expectedPages = new Set<string>();
  const rows = {} as Record<Kind, Record<string, unknown>[]>;
  for (const kind of SNAPSHOT_KINDS) {
    const expected = baseline.find(row => row.kind === kind)!;
    if (!Number.isSafeInteger(expected.n) || expected.n < 0 || !/^[a-f0-9]{64}$/.test(expected.fingerprint)) {
      throw new Error(`Invalid ${kind} baseline`);
    }
    const hash = createHash("sha256");
    rows[kind] = [];
    for (let page = 0; page < Math.ceil(expected.n / 1000); page++) {
      const name = `${kind}-${String(page).padStart(3, "0")}.json`;
      expectedPages.add(name);
      const payload = pages.get(name);
      if (!Array.isArray(payload) || payload.length !== Math.min(1000, expected.n - page * 1000)) {
        throw new Error(`Missing or incomplete page: ${name}`);
      }
      for (const text of payload) {
        if (typeof text !== "string") throw new Error(`Expected original PostgreSQL row text: ${name}`);
        const row = JSON.parse(text);
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`Invalid row: ${name}`);
        hash.update(digest("md5", text));
        rows[kind].push(row);
      }
    }
    if (hash.digest("hex") !== expected.fingerprint) throw new Error(`Snapshot fingerprint mismatch: ${kind}`);
  }
  if ([...pages.keys()].some(name => !expectedPages.has(name))) throw new Error("Unexpected snapshot page");
  return rows;
}

export function readVerifiedSnapshot(directory: string) {
  const baseline = JSON.parse(readFileSync(path.join(directory, "baseline.json"), "utf8")) as SnapshotBaseline;
  const pages = new Map(readdirSync(directory).filter(name => /^(matches|assignments|people|aliases)-\d+\.json$/.test(name))
    .map(name => [name, JSON.parse(readFileSync(path.join(directory, name), "utf8")) as string[]]));
  return { baseline, rows: verifySnapshotPages(baseline, pages) };
}
