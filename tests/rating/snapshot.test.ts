import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { SNAPSHOT_KINDS, verifySnapshotPages, type SnapshotBaseline } from "../../scripts/ratings/snapshot";

const fixture = () => {
  const pages = new Map<string, string[]>();
  const baseline: SnapshotBaseline = SNAPSHOT_KINDS.map(kind => {
    const rows = Array.from({ length: kind === "matches" ? 1001 : 1 }, (_, id) => JSON.stringify({ id, value: null }));
    for (let from = 0; from < rows.length; from += 1000) pages.set(`${kind}-${String(from / 1000).padStart(3, "0")}.json`, rows.slice(from, from + 1000));
    return { kind, n: rows.length, fingerprint: createHash("sha256").update(rows.map(row => createHash("md5").update(row).digest("hex")).join("")).digest("hex") };
  });
  return { pages, baseline };
};

it("verifies a complete multi-page snapshot including the short final page", () => {
  const { baseline, pages } = fixture();
  assert.equal(verifySnapshotPages(baseline, pages).matches.length, 1001);
});
it("rejects an interrupted export even when all earlier pages are complete", () => {
  const { baseline, pages } = fixture(); pages.delete("matches-001.json");
  assert.throws(() => verifySnapshotPages(baseline, pages), /Missing or incomplete/);
});
it("rejects changed or reordered rows despite unchanged total counts", () => {
  const { baseline, pages } = fixture(); pages.get("matches-000.json")!.reverse();
  assert.throws(() => verifySnapshotPages(baseline, pages), /fingerprint mismatch/);
  const other = fixture(); other.pages.get("assignments-000.json")![0] = '{"id":0,"value":"changed"}';
  assert.throws(() => verifySnapshotPages(other.baseline, other.pages), /fingerprint mismatch/);
});
it("rejects stale extra pages and incomplete baseline metadata", () => {
  const { baseline, pages } = fixture(); pages.set("matches-002.json", []);
  assert.throws(() => verifySnapshotPages(baseline, pages), /Unexpected/);
  assert.throws(() => verifySnapshotPages(baseline.slice(1), pages), /exactly once/);
});
