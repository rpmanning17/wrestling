import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateRawSync } from "node:zlib";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { crc32, decodeFlo, readFloZip, safeMemberPath } from "../../src/lib/imports/flo-archive";
import { baselineFingerprint, csvRecord, databaseFingerprintSql, FLO_HEADERS, prepareFlo, sha256, validateBaseline, type BaselineRow } from "../../src/lib/imports/flo";
import { approvedFloSql } from "../../src/lib/imports/flo-sql";
import { guardedMatchImportSql } from "../../src/lib/imports/matches-csv";

// Entirely invented fixtures; observed Flo headers/wrapping, no real participant data.
const bout = ["10/31/2026", "12U 75", "Round 1", "Example One", "Club A", "4-2", "DEC", "Example Two", "Club B", "Example City", "FL", "Example Open"];
const csv = (rows: string[][] = [bout], headers = FLO_HEADERS) => Buffer.from([headers, ...rows].map(r => csvRecord(r.map(c => `="${c}"`))).join("\r\n"));
const member = (rows = [bout], path = "event.csv") => ({ path, bytes: csv(rows) });
const prepare = (rows = [bout], baseline: BaselineRow[] | undefined = []) => prepareFlo([member(rows)], "2026-2027", baseline);
const signed = (manifest: ReturnType<typeof prepare>, selection?: string[]) => approvedFloSql(manifest, sha256(JSON.stringify(manifest)), "owner approval: synthetic test only", selection);

function zip(files: Array<{ path: string; bytes: Buffer; attributes?: number }>, compressed = true) {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.path), packed = compressed ? deflateRawSync(file.bytes) : file.bytes;
    const h = Buffer.alloc(30), d = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(compressed ? 8 : 0, 8);
    h.writeUInt32LE(crc32(file.bytes), 14); h.writeUInt32LE(packed.length, 18); h.writeUInt32LE(file.bytes.length, 22); h.writeUInt16LE(name.length, 26);
    d.writeUInt32LE(0x02014b50); d.writeUInt16LE(0x314, 4); d.writeUInt16LE(20, 6); d.writeUInt16LE(0x800, 8); d.writeUInt16LE(compressed ? 8 : 0, 10);
    d.writeUInt32LE(crc32(file.bytes), 16); d.writeUInt32LE(packed.length, 20); d.writeUInt32LE(file.bytes.length, 24); d.writeUInt16LE(name.length, 28);
    d.writeUInt32LE(file.attributes ?? 0, 38); d.writeUInt32LE(offset, 42);
    local.push(h, name, packed); central.push(d, name); offset += h.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

describe("Flo source parsing and reconciliation", () => {
  it("maps observed Excel-wrapped fields without inventing division evidence", () => {
    const m = prepare();
    assert.equal(m.counts.accepted, 1);
    const r = m.records[0];
    assert.equal(r.sourceRow, 2); assert.equal(r.raw[0], '="10/31/2026"');
    assert.equal(r.normalized?.event_date, "2026-10-31");
    assert.equal(r.normalized?.weight_class, "12U 75");
    assert.match(r.normalized!.source_file, /^flo-v1\/[0-9a-f]{64}$/);
    assert.equal(r.normalized?.season, "2026-2027");
    assert.equal(m.counts.rows, m.counts.accepted + m.counts.blocked + m.counts.alreadySeen);
  });
  it("supports plain fields, reordered headers, UTF-8 BOM, Unicode, quoted commas/newlines", () => {
    const cells = [...bout]; cells[3] = 'Example, O\'Brien "Three"\nJr';
    const text = '\ufeff' + [FLO_HEADERS.toReversed(), cells.toReversed()].map(csvRecord).join("\n");
    const m = prepareFlo([{ path: "unicode.csv", bytes: Buffer.from(text) }], "2026-2027", []);
    assert.equal(m.counts.accepted, 1); assert.equal(m.records[0].normalized?.winner_name, cells[3]);
  });
  it("quarantines unsupported columns, impossible dates, invalid rows and unknown methods", () => {
    const invalid = [...bout]; invalid[0] = "2/30/2026";
    const unknown = [...bout]; unknown[6] = "NEWCODE";
    const m = prepare([bout, invalid, unknown]);
    assert.equal(m.counts.accepted, 1); assert.equal(m.counts.blocked, 2);
    const bad = prepareFlo([{ path: "bad.csv", bytes: csv([bout], [...FLO_HEADERS, "Division"]) }], "2026-2027", []);
    assert.equal(bad.counts.failedMembers, 1);
    assert.equal(prepareFlo([member()], "2026-2027").counts.blocked, 1);
  });
  it("retains administrative outcomes as evidence, never converting placements or byes", () => {
    const admin = [...bout]; admin[6] = "FOR";
    assert.equal(prepare([admin]).counts.administrativePreserved, 1);
    const bye = [...admin]; bye[7] = "BYE";
    assert.equal(prepare([bye]).counts.blocked, 1);
    assert.equal(prepareFlo([{ path: "placers.csv", bytes: Buffer.from("Place,Name\n1,Example") }], "2026", []).counts.failedMembers, 1);
  });
  it("preserves opposite-winner rematches, quarantines indistinguishable source rows", () => {
    const reverse = [...bout]; reverse[3] = bout[7]; reverse[7] = bout[3]; reverse[5] = "7-2";
    const m = prepare([bout, reverse]);
    assert.equal(m.counts.accepted, 2); assert.ok(m.records.every(r => r.repeatedPair));
    assert.equal(prepare([bout, bout]).counts.blocked, 2);
    const crossExport = prepareFlo([member(), member([reverse], "revised.csv")], "2026", []);
    assert.equal(crossExport.counts.blocked, 2);
    assert.ok(crossExport.records.every(r => r.issues.includes("cross_export_correction_or_rematch")));
  });
  it("preserves blank-record indexes rather than shifting original source references", () => {
    const bytes = Buffer.from([csvRecord(FLO_HEADERS), "", csvRecord(bout)].join("\n"));
    const m = prepareFlo([{ path: "blank.csv", bytes }], "2026", []);
    assert.equal(m.counts.rows, 2); assert.equal(m.counts.blocked, 1);
    assert.equal(m.records[1].sourceRow, 3);
  });
  it("repackaging is stable; only byte-identical copies are suppressed within a proposal", () => {
    const m = prepare();
    const existing = m.records[0].normalized!;
    const replay = prepareFlo([{ ...member(), path: "renamed/archive.csv" }], "2026-2027", [existing]);
    assert.equal(replay.counts.alreadySeen, 1);
    const duplicate = prepareFlo([member(), member([bout], "copy.csv")], "2026-2027", []);
    assert.equal(duplicate.counts.accepted, 1); assert.equal(duplicate.counts.alreadySeen, 1);
    const legacy = { ...existing, source_file: "historical.zip/event.csv" };
    assert.match(prepare([bout], [legacy]).records[0].issues.join(), /possible_duplicate/);
    const changed = [...bout]; changed[5] = "6-2";
    const correction = prepare([changed], [existing]);
    assert.equal(correction.counts.blocked, 1); assert.equal(correction.missingFromNewExport.length, 1);
    assert.match(correction.records[0].issues.join(), /correction_or_rematch/);
    assert.equal(prepareFlo([member()], "different-season", [existing]).counts.blocked, 1);
  });
  it("validates baseline shape, binds approval to the full manifest and clean selection", () => {
    assert.throws(() => validateBaseline([{}]), /Invalid baseline/);
    const m = prepare();
    assert.throws(() => approvedFloSql(m, "bad", "approval"), /Exact manifest/);
    assert.throws(() => signed(m, ["blocked-signature"]), /unique clean/);
    assert.throws(() => signed(prepareFlo([member()], "2026")), /baseline/);
  });
});

describe("untrusted Flo ZIP envelope", () => {
  it("reads stored/deflated multi-event ZIPs and isolates a malformed CSV", () => {
    for (const compressed of [true, false]) {
      const bytes = zip([{ path: "a.csv", bytes: csv() }, { path: "b.csv", bytes: Buffer.from('broken,"quote') }], compressed);
      const m = prepareFlo(readFloZip(bytes), "2026", []);
      assert.equal(m.files.length, 2); assert.equal(m.counts.accepted, 1); assert.equal(m.counts.failedMembers, 1);
    }
  });
  it("rejects traversal, drive paths, nested archives, links and ambiguous paths", () => {
    for (const path of ["../bad.csv", "/bad.csv", "C:/bad.csv", "a\\b.csv", "a/./b.csv", "a/b/c/d/e/f.csv"]) assert.throws(() => safeMemberPath(path), /Unsafe/);
    for (const path of ["bad.zip", "bad.exe"]) assert.throws(() => readFloZip(zip([{ path, bytes: csv() }])), /CSV/);
    assert.throws(() => readFloZip(zip([{ path: "a.csv", bytes: csv(), attributes: (0xa000 << 16) >>> 0 }])), /links/);
    assert.throws(() => readFloZip(zip([{ path: "a.csv", bytes: csv() }, { path: "A.csv", bytes: csv() }])), /unique/);
  });
  it("rejects truncated, encrypted, oversized, bomb and invalid encoding inputs", () => {
    const bytes = zip([{ path: "a.csv", bytes: csv() }]);
    assert.throws(() => readFloZip(bytes.subarray(0, -1)), /Malformed/);
    const encrypted = Buffer.from(bytes); encrypted.writeUInt16LE(1, encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 8);
    assert.throws(() => readFloZip(encrypted), /resource\/encoding/);
    assert.throws(() => readFloZip(zip([{ path: "a.csv", bytes: Buffer.alloc(1024 * 1024, 65) }])), /limit/);
    assert.throws(() => decodeFlo(Buffer.from([0xff, 0xfe, 0])), /encoded data|encoding/i);
    assert.throws(() => decodeFlo(Buffer.from("a\0b")), /control/);
  });
  it("checks local metadata, overlapping ranges, CRC and decompressed size", () => {
    const bytes = zip([{ path: "a.csv", bytes: csv() }], false);
    const corrupt = Buffer.from(bytes); corrupt[35] ^= 1;
    assert.match(readFloZip(corrupt)[0].error!, /Corrupt/);
    const mismatch = Buffer.from(bytes); mismatch.writeUInt32LE(1, 22);
    assert.throws(() => readFloZip(mismatch), /metadata mismatch/);
  });
});

describe("atomic Flo import and audit persistence", () => {
  async function database() {
    const db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema private;
      create table public.matches (id serial primary key, event_date date, season text, event_name text,
      city text, state text, weight_class text, round text, winner_name text, winner_team text,
      loser_name text, loser_team text, result text, win_type text, source_file text, source_row integer, unique(source_file,source_row));`);
    await db.exec(readFileSync("supabase/migrations/20261105124918_flo_import_audit.sql", "utf8"));
    return db;
  }
  it("matches independent database fingerprints including Unicode, delimiters, null provenance", async () => {
    const db = await database();
    try {
      const row = { ...prepare().records[0].normalized!, winner_name: "Example 😀\nO'Brien", result: "é:4-2" };
      await db.exec(guardedMatchImportSql([row]));
      let actual = (await db.query<{ fingerprint: string }>(`select (${databaseFingerprintSql()}) as fingerprint`)).rows[0].fingerprint;
      assert.equal(actual, baselineFingerprint([row]));
      await db.exec("update matches set source_file=null,source_row=null");
      actual = (await db.query<{ fingerprint: string }>(`select (${databaseFingerprintSql()}) as fingerprint`)).rows[0].fingerprint;
      assert.equal(actual, baselineFingerprint([{ ...row, source_file: null, source_row: null }]));
    } finally { await db.close(); }
  });
  it("commits a clean subset and quarantine evidence together, safely retries an unacknowledged commit", async () => {
    const db = await database();
    try {
      const bad = [...bout]; bad[6] = "UNKNOWN";
      const other = [...bout]; other[3] = "Example Five"; other[7] = "Example Six";
      const manifest = prepare([bout, other, bad]);
      assert.equal(manifest.counts.accepted, 2);
      const sql = signed(manifest, [manifest.records[0].signature!]);
      await db.exec(sql); await db.exec(sql);
      const counts = (await db.query<{ bouts: number; runs: number; blocked: number }>(`select
        (select count(*)::int from matches) bouts, (select count(*)::int from private.flo_import_runs) runs,
        (select (evidence->'manifest'->'counts'->>'blocked')::int from private.flo_import_runs) blocked`)).rows[0];
      assert.deepEqual(counts, { bouts: 1, runs: 1, blocked: 1 });
      await db.exec("update matches set result='changed'");
      await assert.rejects(db.exec(sql), /changed or missing/);
      await db.exec("rollback");
      for (const role of ["anon", "authenticated", "service_role"]) {
        assert.equal((await db.query<{ allowed: boolean }>(`select has_table_privilege('${role}', 'private.flo_import_runs', 'select') allowed`)).rows[0].allowed, false);
      }
    } finally { await db.close(); }
  });
  it("aborts after an intervening write and rolls back bouts when audit persistence fails", async () => {
    const db = await database();
    try {
      const m = prepare();
      const another = { ...m.records[0].normalized!, source_file: "other-file" };
      await db.exec(guardedMatchImportSql([another]));
      await assert.rejects(db.exec(signed(m)), /baseline changed/);
      await db.exec("rollback");
      assert.equal((await db.query("select * from private.flo_import_runs")).rows.length, 0);
      const rebased = prepare([bout], [another]);
      assert.equal(rebased.counts.blocked, 1);
      await db.exec("delete from matches; alter table private.flo_import_runs add constraint fail_test check (inserted_rows < 0)");
      await assert.rejects(db.exec(signed(m)), /fail_test/);
      await db.exec("rollback");
      assert.equal((await db.query("select * from matches")).rows.length, 0);
      // Retry the identical approved payload after the transient test constraint is removed.
      await db.exec("alter table private.flo_import_runs drop constraint fail_test");
      await db.exec(signed(m));
      assert.equal((await db.query("select * from matches")).rows.length, 1);
    } finally { await db.close(); }
  });
});

describe("Flo CLI privacy boundary", () => {
  it("writes an exclusive private manifest, prints counts only and refuses repository outputs", () => {
    const dir = mkdtempSync(join(tmpdir(), "mat-notes-flo-"));
    try {
      const input = join(dir, "input.zip"), report = join(dir, "report.json");
      writeFileSync(input, zip([{ path: "one.csv", bytes: csv() }]));
      const args = ["--import", "tsx", "scripts/imports/prepare-flo.ts", "--input", input, "--season", "2026", "--report", report];
      const run = () => spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30000 });
      const first = run(); assert.equal(first.status, 0, first.stderr); assert.doesNotMatch(first.stdout, /Example One/);
      const evidence = JSON.parse(readFileSync(report, "utf8"));
      assert.equal(evidence.manifestSha256, sha256(JSON.stringify(evidence.manifest)));
      assert.equal(evidence.manifest.counts.blocked, 1);
      assert.equal(run().status, 1);
      args[args.length - 1] = join(process.cwd(), "forbidden-private-report.json");
      assert.match(run().stderr, /outside the repository/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
