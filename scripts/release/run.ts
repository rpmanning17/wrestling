/** Agent-operated tournament release pipeline. See docs/RELEASE_PIPELINE.md.
 *
 *   node --import tsx scripts/release/run.ts --run <uuid> --phase plan|release|verify|rollback --work <private dir>
 *
 * Connects with MATNOTES_DATABASE_URL (the matnotes_release role). Raw sources, identity plans and
 * reports stay in private database rows and the private work directory; stdout carries only counts,
 * hashes and UUIDs because CI logs for this repository are public. Every write is a guarded,
 * idempotent batch, so a failed or interrupted phase is resumed by running the same phase again.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { adaptResults, type ImportRequest, type ResultsProvider } from "../../src/lib/imports/results-adapters";
import { guardedMatchImportSql, type MatchImportRow } from "../../src/lib/imports/matches-csv";
import { IDENTITY_PLAN_SQL, applyOverrides, planDigest, planSummary, type IdentityOverride, type PlanRow } from "../../src/lib/release/identity-plan";
import { readVerifiedSnapshot, SNAPSHOT_KINDS, type SnapshotBaseline } from "../ratings/snapshot";
import type { SnapshotCandidate } from "../identity/snapshot-candidate";

type Sql = postgres.Sql | postgres.TransactionSql;
type RunRequest = ImportRequest & { identity_overrides?: IdentityOverride[]; as_of_date?: string; allow_cross_source_duplicates?: boolean };
type Run = { id: string; status: string; request: RunRequest; plan: PlanRow[] | null; plan_sha256: string | null;
  approved_plan_sha256: string | null; report: Record<string, unknown>; provider: ResultsProvider;
  sha256: string; content: Buffer; original_filename: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const APP_URL = process.env.MATNOTES_APP_URL ?? "https://wrestling-plum.vercel.app";
const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const log = (phase: string, detail: Record<string, unknown>) => console.log(JSON.stringify({ phase, ...detail }));
const CODE_VERSION = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
const ORDER: Record<string, string> = {
  matches: "id", assignments: 'source_kind collate "C", source_id collate "C"', people: "id", aliases: 'alias_key collate "C"',
};
const TABLE: Record<string, string> = {
  matches: "public.matches", assignments: "public.source_identity_current_rows", people: "public.wrestler_people", aliases: "public.wrestler_aliases",
};
const MANIFEST_SQL = SNAPSHOT_KINDS.map(kind =>
  `select '${kind}' kind,count(*)::int n,encode(sha256(convert_to(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by ${ORDER[kind]}),''),'UTF8')),'hex') fingerprint from ${TABLE[kind]} t`,
).join(" union all ");
const LOCK_SOURCES = "lock table public.matches, public.wrestler_aliases, public.wrestler_people, public.source_identity_current_rows in share mode";
const outputRootSql = (table: string, order: string) => `with output_rows as (
  select to_jsonb(t)::text body, row_number() over (order by ${order}) position from public.${table} t where model_id = $1
), chunks as (select (position-1)/250 chunk_index, encode(sha256(convert_to(string_agg(md5(body),'' order by position),'UTF8')),'hex') h
  from output_rows group by (position-1)/250)
select count(*)::int n, (select encode(sha256(convert_to(string_agg(h,'' order by chunk_index),'UTF8')),'hex') from chunks) root
from output_rows`;
const RATINGS_ROOT = outputRootSql("wrestler_model_ratings", 'athlete_key collate "C"');
const HISTORY_ROOT = outputRootSql("wrestler_rating_history", 'athlete_key collate "C", period_end');

function args() {
  const a = process.argv.slice(2), v = new Map<string, string>();
  for (let i = 0; i < a.length; i += 2) {
    if (!a[i].startsWith("--") || a[i + 1] === undefined) throw new Error("Usage: --run <uuid> --phase plan|release|verify|rollback --work <dir> [--target <uuid>]");
    v.set(a[i].slice(2), a[i + 1]);
  }
  const run = v.get("run") ?? "", phase = v.get("phase") ?? "", work = v.get("work") ?? "";
  if (!UUID.test(run) || !["plan", "release", "verify", "rollback"].includes(phase) || !work) throw new Error("Invalid --run/--phase/--work");
  const repo = path.resolve(process.cwd());
  if (path.resolve(work) === repo || path.resolve(work).startsWith(repo + path.sep)) throw new Error("Private work directory must be outside the repository");
  return { run, phase, work: path.resolve(work), target: v.get("target") };
}

function connect() {
  const url = process.env.MATNOTES_DATABASE_URL;
  if (!url) throw new Error("MATNOTES_DATABASE_URL is not configured (docs/RELEASE_PIPELINE.md, one-time setup)");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return postgres(url, { max: 1, prepare: false, ssl: local ? false : "require", onnotice: () => undefined,
    connection: { application_name: "matnotes-release" } });
}

async function event(sql: Sql, run: string, phase: string, outcome: string, detail: Record<string, unknown> = {}) {
  await sql`insert into private.import_run_events (run_id, phase, outcome, detail, code_version)
    values (${run}, ${phase}, ${outcome}, ${sql.json(detail as postgres.JSONValue)}, ${CODE_VERSION})`;
}

async function loadRun(sql: Sql, id: string): Promise<Run> {
  const rows = await sql<Run[]>`select r.id, r.status, r.request, r.plan, r.plan_sha256, r.approved_plan_sha256, r.report,
    s.provider, s.sha256, s.content, s.original_filename
    from private.import_runs r join private.import_sources s on s.id = r.source_id where r.id = ${id}`;
  if (rows.length !== 1) throw new Error("Unknown run");
  const run = rows[0];
  if (sha256(run.content) !== run.sha256) throw new Error("Stored raw source does not match its SHA-256");
  return run;
}

async function updateRun(sql: Sql, id: string, fields: { status?: string; plan?: PlanRow[]; plan_sha256?: string; report?: Record<string, unknown> }) {
  if (fields.plan) await sql`update private.import_runs set plan = ${sql.json(fields.plan as unknown as postgres.JSONValue)}, plan_sha256 = ${fields.plan_sha256!}, updated_at = now() where id = ${id}`;
  if (fields.report) await sql`update private.import_runs set report = report || ${sql.json(fields.report as postgres.JSONValue)}, updated_at = now() where id = ${id}`;
  if (fields.status) await sql`update private.import_runs set status = ${fields.status}, updated_at = now() where id = ${id}`;
}

/** Source adaptation. USA Bracketing packages are reviewed JSON for the existing guarded importer. */
function adapt(run: Run) {
  const text = run.content.toString("utf8");
  if (run.provider === "usa_bracketing") {
    const payload = JSON.parse(text) as Array<{ match: { source_file: string } }>;
    if (!Array.isArray(payload) || !payload.length) throw new Error("USA package must be a nonempty reviewed bout array");
    return { kind: "usa" as const, payload, sourceFiles: [...new Set(payload.map(e => e.match.source_file))].sort(), rows: payload.length,
      summary: { source_rows: payload.length, imported: payload.length, excluded: 0 } };
  }
  const adapted = adaptResults(run.provider, text, run.request);
  return { kind: "matches" as const, rows: adapted.report.rows.length, matches: adapted.report.rows,
    sourceFiles: [...new Set(adapted.report.rows.map(r => r.source_file))],
    summary: { source_rows: adapted.sourceRows, imported: adapted.report.rows.length, excluded: adapted.excluded.total,
      excluded_by_division: adapted.excluded.division, excluded_byes: adapted.excluded.byes, methods: adapted.report.methods,
      repeated_pair_groups: adapted.report.repeatedPairGroups, opposite_winner_groups: adapted.report.oppositeWinnerGroups,
      normalized_sha256: sha256(adapted.normalizedCsv) } };
}
type Adapted = ReturnType<typeof adapt>;

/** Guarded idempotent inserts: existing source keys must match every field; nothing is overwritten. */
async function importSource(tx: Sql, a: Adapted) {
  if (a.kind === "usa") {
    for (let i = 0; i < a.payload.length; i += 100) {
      await tx`select private.import_usa_bracketing_verified(${tx.json(a.payload.slice(i, i + 100) as unknown as postgres.JSONValue)})`;
    }
  } else {
    for (let i = 0; i < a.matches.length; i += 250) await tx.unsafe(guardedMatchImportSql(a.matches.slice(i, i + 250) as MatchImportRow[]));
  }
  const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from public.matches where source_file = any(${a.sourceFiles})`;
  if (n !== a.rows) throw new Error(`Imported source rows ${n} differ from adapted rows ${a.rows}`);
  // Same bout already recorded under a different source (e.g. a re-export) is reported, never silently kept.
  const [{ d }] = await tx<{ d: number }[]>`select count(*)::int d from public.matches m join public.matches o
    on o.source_file <> all(${a.sourceFiles}) and abs(o.event_date - m.event_date) <= 1
    and least(lower(o.winner_name), lower(o.loser_name)) = least(lower(m.winner_name), lower(m.loser_name))
    and greatest(lower(o.winner_name), lower(o.loser_name)) = greatest(lower(m.winner_name), lower(m.loser_name))
    where m.source_file = any(${a.sourceFiles})`;
  return { imported: n, cross_source_duplicates: d };
}

async function computePlan(tx: Sql, run: Run, a: Adapted) {
  const rows = (await tx.unsafe(IDENTITY_PLAN_SQL, [a.sourceFiles as unknown as string])) as unknown as PlanRow[];
  const plan = applyOverrides(rows.map(r => ({ ...r, source_row: Number(r.source_row), compatible: Number(r.compatible), num_people: Number(r.num_people) })),
    run.request.identity_overrides);
  return { plan, digest: planDigest(plan), summary: planSummary(plan) };
}

/** Apply the approved plan as FIRST assignments (revision 0 -> 1) for every new bout side, held sides as null. */
async function applyPlan(tx: Sql, run: Run, plan: PlanRow[]) {
  const ids = plan.map(p => p.source_kind + ":" + p.source_id);
  const existing = await tx<{ k: string; person_id: string | null; display_name: string | null }[]>`
    select c.source_kind || ':' || c.source_id k, c.person_id, p.display_name from public.source_identity_current_rows c
    left join public.wrestler_people p on p.id = c.person_id where c.source_kind || ':' || c.source_id = any(${ids})`;
  if (existing.length === plan.length) return checkApplied(plan, new Map(existing.map(e => [e.k, e])));
  if (existing.length) throw new Error(`Partial identity state: ${existing.length} of ${plan.length} sides already assigned`);
  const rule = { plan_sha256: planDigest(plan), run_id: run.id, source_sha256: run.sha256 };
  const decisions: Record<string, { authority: string; disposition: string; rationale: string; evidence: Record<string, unknown> }> = {
    link: { authority: "source_evidenced", disposition: "same_person", rationale: "Conservative unique-name identity supported by multiple age, time and weight-compatible historical results",
      evidence: { ...rule, rule: "one historical person with exact full name and at least two same-name bouts within 730 days, 15 lb and two age groups" } },
    new: { authority: "agent_inferred", disposition: "same_person", rationale: "Separate newly recorded people by original name and club, without guessing existing identities",
      evidence: { ...rule, rule: "unseen full name grouped by name plus known club alias with bounded age and weight; no cross-club merging" } },
    held: { authority: "agent_inferred", disposition: "unresolved", rationale: "Uncertain identity held unassigned; excluded from ratings until reviewed",
      evidence: { ...rule, rule: "ambiguous, incompatible, multi-person or self-match appearances are held" } },
    owner: { authority: "owner_confirmed", disposition: "same_person", rationale: "Owner-supplied identity decision recorded in the import run request",
      evidence: { ...rule, overrides: run.request.identity_overrides ?? [] } },
  };
  const groupOf = (p: PlanRow) => p.resolution === "link" ? "link" : p.resolution === "new" ? "new"
    : p.resolution === "held" ? "held" : "owner";
  const newPeople = new Map<string, string>();
  for (const p of plan.filter(r => r.resolution === "new")) {
    if (!newPeople.has(p.identity_key!)) {
      const [{ id }] = await tx<{ id: string }[]>`insert into public.wrestler_people (display_name) values (${p.new_display_name!}) returning id`;
      newPeople.set(p.identity_key!, id);
    }
  }
  for (const group of ["link", "new", "held", "owner"]) {
    const rows = plan.filter(p => groupOf(p) === group);
    if (!rows.length) continue;
    const d = decisions[group];
    const [{ id: decision }] = await tx<{ id: string }[]>`insert into public.identity_decisions
      (authority, disposition, evidence, evidence_hash, source_checksum, rationale)
      values (${d.authority}, ${d.disposition}, ${tx.json(d.evidence as postgres.JSONValue)}, ${sha256(JSON.stringify(d.evidence))}, ${run.sha256}, ${d.rationale})
      returning id`;
    for (let i = 0; i < rows.length; i += 1000) {
      const [{ id: batch }] = await tx<{ id: string }[]>`insert into public.identity_assignment_batches (decision_id) values (${decision}) returning id`;
      const payload = rows.slice(i, i + 1000).map(p => ({ source_kind: p.source_kind, source_id: p.source_id, recorded_name: p.recorded_name,
        person_id: p.resolution === "new" ? newPeople.get(p.identity_key!)! : p.resolution === "held" || p.resolution === "owner_hold" ? null : p.identity_key,
        decision_id: decision, expected_revision: 0 }));
      const [{ n }] = await tx<{ n: number }[]>`select private.apply_identity_batch(${batch}, ${tx.json(payload as unknown as postgres.JSONValue)}) n`;
      if (Number(n) !== payload.length) throw new Error("Incomplete identity batch");
    }
  }
  const after = await tx<{ k: string; person_id: string | null; display_name: string | null }[]>`
    select c.source_kind || ':' || c.source_id k, c.person_id, p.display_name from public.source_identity_current_rows c
    left join public.wrestler_people p on p.id = c.person_id where c.source_kind || ':' || c.source_id = any(${ids})`;
  return checkApplied(plan, new Map(after.map(e => [e.k, e])));
}

function checkApplied(plan: PlanRow[], state: Map<string, { person_id: string | null; display_name: string | null }>) {
  const groups = new Map<string, string>();
  for (const p of plan) {
    const s = state.get(p.source_kind + ":" + p.source_id);
    if (!s) throw new Error("Missing assignment for a planned side");
    const held = p.resolution === "held" || p.resolution === "owner_hold";
    if (held ? s.person_id !== null : !s.person_id) throw new Error("Assignment differs from approved plan");
    if ((p.resolution === "link" || p.resolution === "owner_person") && s.person_id !== p.identity_key) throw new Error("Linked assignment differs from plan");
    if (p.resolution === "new") {
      if (s.display_name !== p.new_display_name) throw new Error("New person differs from plan");
      const prior = groups.get(p.identity_key!);
      if (prior && prior !== s.person_id) throw new Error("New person group split");
      groups.set(p.identity_key!, s.person_id!);
    }
  }
  return { assigned: plan.filter(p => p.resolution !== "held" && p.resolution !== "owner_hold").length,
    held: plan.filter(p => p.resolution === "held" || p.resolution === "owner_hold").length, new_people: groups.size };
}

/** One repeatable-read transaction: atomic baseline plus streamed pages in the existing verified format. */
async function exportSnapshot(sql: postgres.Sql, work: string) {
  return sql.begin("isolation level repeatable read read only", async tx => {
    const baseline = (await tx.unsafe(MANIFEST_SQL)).map(r => ({ kind: r.kind, n: Number(r.n), fingerprint: r.fingerprint })) as SnapshotBaseline;
    const dir = path.join(work, "snapshot-" + sha256(JSON.stringify(baseline)).slice(0, 16));
    if (existsSync(path.join(dir, "baseline.json"))) {
      if (readFileSync(path.join(dir, "baseline.json"), "utf8") !== JSON.stringify(baseline)) throw new Error("Conflicting snapshot directory");
      return { dir, baseline };
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const kind of SNAPSHOT_KINDS) {
      let page = 0;
      for await (const rows of tx.unsafe(`select to_jsonb(t)::text body from ${TABLE[kind]} t order by ${ORDER[kind]}`).cursor(1000)) {
        writeFileSync(path.join(dir, `${kind}-${String(page++).padStart(3, "0")}.json`), JSON.stringify(rows.map(r => r.body)), { mode: 0o600, flag: "wx" });
      }
    }
    writeFileSync(path.join(dir, "baseline.json"), JSON.stringify(baseline), { mode: 0o600, flag: "wx" });
    return { dir, baseline };
  });
}

const tsx = (script: string, params: string[]) =>
  execFileSync(process.execPath, ["--import", "tsx", script, ...params], { encoding: "utf8", maxBuffer: 1 << 30 });

async function sameModel(tx: Sql, id: string, expected: Record<string, unknown>) {
  const [{ ok }] = await tx<{ ok: boolean }[]>`select not exists (select 1 from jsonb_each(${tx.json(expected as postgres.JSONValue)}) e
    where to_jsonb(m) -> e.key is distinct from e.value) ok from public.rating_models m where m.id = ${id}`;
  return ok;
}

async function assertSourcesUnchanged(tx: Sql, baseline: SnapshotBaseline) {
  const live = (await tx.unsafe(MANIFEST_SQL)).map(r => ({ kind: r.kind, n: Number(r.n), fingerprint: r.fingerprint }));
  if (JSON.stringify(live) !== JSON.stringify(baseline)) throw new Error("Source, assignment, people or alias tables changed since the snapshot");
}

async function outputRoots(tx: Sql, id: string) {
  const [ratings] = await tx.unsafe(RATINGS_ROOT, [id]);
  const [history] = await tx.unsafe(HISTORY_ROOT, [id]);
  return { ratings: { n: Number(ratings.n), root: ratings.root as string }, history: { n: Number(history.n), root: history.root as string } };
}

async function release(sql: postgres.Sql, run: Run, work: string) {
  if (!run.plan_sha256 || run.approved_plan_sha256 !== run.plan_sha256) throw new Error("Identity plan not approved: set approved_plan_sha256 after review");
  const a = adapt(run);
  const report: Record<string, unknown> = { ...run.report };
  // Phase 1: import + identities in one transaction (resumable: guarded inserts and exact plan comparison).
  if (!["assigned", "candidate", "active", "verified"].includes(run.status)) {
    const result = await sql.begin(async tx => {
      await tx`set local lock_timeout = '30s'`;
      const [active] = await tx<{ id: string }[]>`select id from public.rating_models where status = 'active'`;
      const imported = await importSource(tx, a);
      if (imported.cross_source_duplicates && !run.request.allow_cross_source_duplicates) throw new Error(`${imported.cross_source_duplicates} bouts already exist under another source`);
      const { plan, digest } = await computePlan(tx, run, a);
      if (digest !== run.approved_plan_sha256) throw new Error("Recomputed identity plan differs from the approved plan");
      const applied = await applyPlan(tx, run, plan);
      return { predecessor: report.predecessor ?? active?.id, imported, applied };
    });
    Object.assign(report, result);
    await updateRun(sql, run.id, { status: "assigned", report });
    await event(sql, run.id, "import_and_assign", "succeeded", { imported: result.imported, applied: result.applied });
    log("import_and_assign", { ...result.imported, ...result.applied });
  }
  // Phase 2: snapshot and the existing offline calculation + independent validation.
  const { dir, baseline } = await exportSnapshot(sql, work);
  readVerifiedSnapshot(dir);
  const latest = (await sql<{ d: string }[]>`select max(event_date)::text d from public.matches`)[0].d;
  const asOf = run.request.as_of_date ?? new Date(Date.parse(latest) + 86400000).toISOString().slice(0, 10);
  if (!existsSync(path.join(dir, "person-rating-candidate.json"))) tsx("scripts/identity/calculate-snapshot-candidate.ts", [dir, asOf]);
  if (!existsSync(path.join(dir, "person-candidate-validation-release.json"))) tsx("scripts/identity/validate-snapshot-candidate.ts", [dir, "person-candidate-validation-release.json"]);
  const candidate = JSON.parse(readFileSync(path.join(dir, "person-rating-candidate.json"), "utf8")) as SnapshotCandidate;
  const validation = JSON.parse(readFileSync(path.join(dir, "person-candidate-validation-release.json"), "utf8"));
  if (validation.validated !== true) throw new Error("Candidate validation failed");
  log("calculate", { as_of: asOf, matches_total: candidate.model.matches_total, matches_rated: candidate.model.matches_rated,
    wrestlers_rated: candidate.model.wrestlers_rated, history: candidate.history.length, input_fingerprint: candidate.model.input_fingerprint,
    exclusions: validation.exclusions, numeric_max: validation.numericMaximumDifferences });
  // Phase 3: model row (one per run identity) and resumable guarded batches with typed read-back.
  const model = candidate.model as unknown as Record<string, unknown>;
  let modelId = (await sql<{ id: string }[]>`select id from public.rating_models where config_hash = ${model.config_hash as string}
    and input_fingerprint = ${model.input_fingerprint as string} and as_of_date = ${model.as_of_date as string}
    and match_cutoff is not distinct from ${model.match_cutoff as string}`)[0]?.id;
  if (!modelId) {
    const insert = tsx("scripts/identity/snapshot-rollout-sql.ts", [dir, "model"]);
    modelId = (await sql.unsafe(insert))[0].id as string;
  }
  const [{ status }] = await sql<{ status: string }[]>`select status from public.rating_models where id = ${modelId}`;
  if (!(await sameModel(sql, modelId, { ...model, status }))) throw new Error("Existing model metadata differs from the candidate");
  await updateRun(sql, run.id, { report: { model_id: modelId, as_of: asOf, baseline } });
  const rollout = path.join(dir, "rollout-" + modelId);
  if (!existsSync(path.join(rollout, "manifest.json"))) tsx("scripts/identity/snapshot-rollout-sql.ts", [dir, "stage", modelId]);
  const manifest = JSON.parse(readFileSync(path.join(rollout, "manifest.json"), "utf8")) as { files: { file: string; sha256: string; rows: number }[] };
  const chunk: Record<string, string[]> = { ratings: [], history: [] };
  let written = 0, skipped = 0;
  for (const f of manifest.files.filter(f => !f.file.startsWith("verify-"))) {
    const sqlText = readFileSync(path.join(rollout, f.file), "utf8"), verifyText = readFileSync(path.join(rollout, "verify-" + f.file), "utf8");
    if (sha256(sqlText) !== f.sha256) throw new Error("Staged request changed: " + f.file);
    let [v] = await sql.unsafe(verifyText);
    if (status === "building" && (Number(v.checked) !== f.rows || Number(v.mismatches) !== 0)) {
      await sql.unsafe(sqlText); written++;
      [v] = await sql.unsafe(verifyText);
    } else skipped++;
    if (Number(v.checked) !== f.rows || Number(v.mismatches) !== 0) throw new Error("Typed read-back mismatch: " + f.file);
    chunk[f.file.startsWith("ratings") ? "ratings" : "history"].push(v.expected_chunk_hash as string);
  }
  const roots = { ratings: sha256(chunk.ratings.join("")), history: sha256(chunk.history.join("")) };
  log("persist", { model_id: modelId, written, skipped, ...roots });
  // Phase 4: locked promotion building -> candidate.
  if (status === "building") {
    await sql.begin(async tx => {
      await tx`set local lock_timeout = '30s'`;
      await tx`select id from public.rating_models where id = ${modelId} for update`;
      await tx`lock table public.wrestler_model_ratings, public.wrestler_rating_history in share mode`;
      await tx.unsafe(LOCK_SOURCES);
      if (!(await sameModel(tx, modelId!, { ...model, status: "building" }))) throw new Error("Model changed before promotion");
      const db = await outputRoots(tx, modelId!);
      if (db.ratings.n !== candidate.rows.length || db.history.n !== candidate.history.length || db.ratings.root !== roots.ratings || db.history.root !== roots.history)
        throw new Error("Stored output differs from the validated payload");
      await assertSourcesUnchanged(tx, baseline);
      await tx`update public.rating_models set status = 'candidate' where id = ${modelId} and status = 'building'`;
    });
    await event(sql, run.id, "promote", "succeeded", { model_id: modelId, roots });
  }
  // Phase 5: locked activation with predecessor and freshness checks (the trigger re-checks person inputs).
  const predecessor = report.predecessor as string;
  const [{ status: now }] = await sql<{ status: string }[]>`select status from public.rating_models where id = ${modelId}`;
  if (now === "candidate") {
    const evidence = await sql.begin(async tx => {
      await tx`set local lock_timeout = '30s'`;
      await tx`lock table public.rating_models in share row exclusive mode`;
      await tx`lock table public.wrestler_model_ratings, public.wrestler_rating_history in share mode`;
      await tx.unsafe(LOCK_SOURCES);
      const active = await tx<{ id: string }[]>`select id from public.rating_models where status = 'active'`;
      if (active.length !== 1 || active[0].id !== predecessor) throw new Error("Active model changed since the release began");
      if (!(await sameModel(tx, modelId!, { ...model, status: "candidate" }))) throw new Error("Candidate changed before activation");
      const db = await outputRoots(tx, modelId!);
      if (db.ratings.root !== roots.ratings || db.history.root !== roots.history) throw new Error("Candidate output changed before activation");
      await assertSourcesUnchanged(tx, baseline);
      const [prior] = await tx<{ wrestlers_rated: number }[]>`select wrestlers_rated from public.rating_models where id = ${predecessor}`;
      const priorRoots = await outputRoots(tx, predecessor);
      if (priorRoots.ratings.n !== Number(prior.wrestlers_rated) || priorRoots.history.n === 0) throw new Error("Rollback predecessor incomplete");
      await tx`select private.activate_rating_model(${modelId})`;
      const after = await tx<{ id: string; status: string }[]>`select id, status from public.rating_models where id = any(${[modelId!, predecessor]})`;
      if (after.find(r => r.id === modelId)?.status !== "active" || after.find(r => r.id === predecessor)?.status !== "archived") throw new Error("Activation post-check failed");
      if ((await tx`select 1 from public.rating_models where status = 'active'`).length !== 1) throw new Error("More than one active model");
      return { predecessor, predecessor_roots: priorRoots };
    });
    await updateRun(sql, run.id, { status: "active", report: { activation: evidence, roots } });
    await event(sql, run.id, "activate", "succeeded", { model_id: modelId, predecessor });
    log("activate", { model_id: modelId, predecessor, predecessor_roots: evidence.predecessor_roots });
  } else if (now !== "active") throw new Error("Unexpected model status " + now);
  return verify(sql, await loadRun(sql, run.id));
}

/** Production checks through the same database reads the app uses, plus live HTTP/privacy checks. */
async function verify(sql: postgres.Sql, run: Run) {
  const a = adapt(run), modelId = run.report.model_id as string;
  const plan = run.plan ?? [];
  const checks: Record<string, unknown> = {};
  const fail: string[] = [];
  const [m] = await sql<{ id: string; wrestlers_rated: number }[]>`select id, wrestlers_rated from public.rating_models where status = 'active'`;
  if (m?.id !== modelId) fail.push("active model is not this run's model");
  checks.active_model = m?.id;
  const [{ n: ratings }] = await sql<{ n: number }[]>`select count(*)::int n from public.person_rating_current`;
  if (ratings !== Number(m?.wrestlers_rated)) fail.push("person_rating_current count");
  const [{ n: imported }] = await sql<{ n: number }[]>`select count(*)::int n from public.matches where source_file = any(${a.sourceFiles})`;
  checks.imported = imported; if (imported !== a.rows) fail.push("imported row count");
  const sides = await sql<{ source_kind: string; source_id: string; person_id: string | null }[]>`
    select c.source_kind, c.source_id, c.person_id from public.source_identity_current_rows c
    join public.matches x on x.id::text = c.source_id where x.source_file = any(${a.sourceFiles}) and c.source_kind in ('match_winner','match_loser')`;
  const byKey = new Map(sides.map(s => [s.source_kind + ":" + s.source_id, s.person_id]));
  const planIds = new Set(plan.map(p => p.source_kind + ":" + p.source_id));
  if (sides.length !== a.rows * 2 || plan.length !== a.rows * 2) fail.push("side coverage");
  // Dry-run plans carry dry-run UUIDs; compare by recomputing the plan over the live rows instead.
  const live = await computePlan(sql, run, a);
  if (live.digest !== run.approved_plan_sha256) fail.push("live identity plan differs from approved plan");
  for (const p of live.plan) {
    const actual = byKey.get(p.source_kind + ":" + p.source_id);
    const held = p.resolution === "held" || p.resolution === "owner_hold";
    if (actual === undefined || (held ? actual !== null : actual === null) ||
        ((p.resolution === "link" || p.resolution === "owner_person") && actual !== p.identity_key)) fail.push("assignment " + p.source_row + " " + p.source_kind);
  }
  void planIds;
  const people = [...new Set(sides.map(s => s.person_id).filter((x): x is string => !!x))];
  const rated = await sql<{ n: number; current: number }[]>`
    with bouts as (select x.event_date, w.person_id wp, l.person_id lp from public.matches x
      join public.source_identity_current_rows w on w.source_kind = 'match_winner' and w.source_id = x.id::text
      join public.source_identity_current_rows l on l.source_kind = 'match_loser' and l.source_id = x.id::text
      where x.source_file = any(${a.sourceFiles}) and upper(trim(x.win_type)) in ('F','DEC','MD','TF')
        and w.person_id is not null and l.person_id is not null and w.person_id <> l.person_id),
    p as (select wp person_id, event_date from bouts union all select lp, event_date from bouts)
    select count(distinct p.person_id)::int n, count(distinct p.person_id) filter (where r.last_match_date >= p.event_date)::int current
    from p left join public.person_rating_current r on r.person_id = p.person_id`;
  checks.rated_people = rated[0]; if (rated[0].n !== rated[0].current) fail.push("rated people missing new results");
  const [ages] = await sql<{ n: number; aged: number }[]>`select count(*)::int n, count(age_group)::int aged
    from private.match_cohort_appearances a join public.matches x on x.id = a.source_match_id where x.source_file = any(${a.sourceFiles})`;
  checks.bout_age_projection = ages; if (ages.n !== a.rows * 2) fail.push("cohort projection coverage");
  const profiles = await sql`select count(*)::int n from public.person_cohorts_by_ids(${people}::uuid[])`;
  checks.profile_cohort_rows = profiles[0].n;
  const history = await sql`select count(*)::int n from public.person_match_history(${people}::uuid[], 'winner')`;
  checks.profile_history_wins = history[0].n;
  const rankings: Record<string, number> = {};
  // Only age groups in which this source contributed at least one assigned side must appear in Rankings.
  const sourceAges = await sql<{ age: number }[]>`select distinct ((regexp_match(x.weight_class, '(6|8|10|12|14)U', 'i'))[1])::int age
    from public.matches x join public.source_identity_current_rows c on c.source_id = x.id::text
      and c.source_kind in ('match_winner','match_loser') and c.person_id is not null
    where x.source_file = any(${a.sourceFiles}) and x.weight_class ~* '(6|8|10|12|14)U'`;
  for (const age of sourceAges.map(r => Number(r.age))) rankings[age] = Number((await sql`select count(*)::int n from public.current_person_strength(${age})`)[0].n);
  checks.rankings_rows = rankings; if (Object.values(rankings).some(n => n === 0)) fail.push("empty rankings age group");
  const http: Record<string, unknown> = {};
  // Five fresh loads per route. Free-plan CPU starvation can cause isolated timeouts (docs/STATUS.md),
  // so every status is recorded and a route fails below 4/5 successes or on any privacy-header miss.
  for (const route of ["/", "/rankings", "/clubs"]) {
    const statuses: number[] = [];
    let headersOk = true;
    for (let i = 0; i < 5; i++) {
      const res = await fetch(APP_URL + route + "?release=" + run.id.slice(0, 8) + "-" + i, { redirect: "manual" });
      statuses.push(res.status);
      if (res.status === 200) headersOk &&= /no-store/i.test(res.headers.get("cache-control") ?? "") && /noindex/i.test(res.headers.get("x-robots-tag") ?? "");
      await res.arrayBuffer();
    }
    http[route] = statuses;
    if (statuses.filter(code => code === 200).length < 4 || !headersOk) fail.push("http " + route);
  }
  checks.http = http;
  await updateRun(sql, run.id, { status: fail.length ? undefined : "verified", report: { verification: { checks, fail, at: new Date().toISOString() } } });
  await event(sql, run.id, "verify", fail.length ? "failed" : "succeeded", { checks, fail });
  log("verify", { checks, fail });
  if (fail.length) throw new Error("Production verification failed: " + fail.join("; "));
}

async function plan(sql: postgres.Sql, run: Run) {
  const a = adapt(run);
  // Dry run: the identical guarded import and plan inside a transaction that is always rolled back.
  const outcome = await sql.begin(async tx => {
    await tx`set local lock_timeout = '30s'`;
    const imported = await importSource(tx, a);
    const result = await computePlan(tx, run, a);
    throw Object.assign(new Error("dry-run rollback"), { dryRun: { imported, ...result } });
  }).catch(e => { if (e.dryRun) return e.dryRun; throw e; });
  const [active] = await sql<{ id: string; identity_scheme: string }[]>`select id, identity_scheme from public.rating_models where status = 'active'`;
  await updateRun(sql, run.id, { plan: outcome.plan, plan_sha256: outcome.digest, status: "planned",
    report: { adapted: a.summary, dry_run: outcome.imported, plan_summary: outcome.summary, predecessor: active?.id } });
  await event(sql, run.id, "plan", "succeeded", { ...a.summary, ...outcome.imported, ...outcome.summary, plan_sha256: outcome.digest });
  log("plan", { ...a.summary, ...outcome.imported, ...outcome.summary, plan_sha256: outcome.digest, predecessor: active?.id });
}

async function rollback(sql: postgres.Sql, run: Run, target?: string) {
  const current = run.report.model_id as string, to = target ?? (run.report.predecessor as string);
  if (!UUID.test(current ?? "") || !UUID.test(to ?? "")) throw new Error("Rollback needs this run's model and a target model");
  await sql`select private.rollback_rating_model(${to}, ${current})`;
  await updateRun(sql, run.id, { status: "rolled_back", report: { rollback: { from: current, to, at: new Date().toISOString() } } });
  await event(sql, run.id, "rollback", "succeeded", { from: current, to });
  log("rollback", { from: current, to });
}

async function main() {
  const { run: id, phase, work, target } = args();
  mkdirSync(work, { recursive: true, mode: 0o700 });
  const sql = connect();
  try {
    const run = await loadRun(sql, id);
    await event(sql, id, phase, "started");
    try {
      if (phase === "plan") await plan(sql, run);
      else if (phase === "release") await release(sql, run, work);
      else if (phase === "verify") await verify(sql, run);
      else await rollback(sql, run, target);
    } catch (e) {
      const message = (e as Error).message.slice(0, 500);
      await event(sql, id, phase, "failed", { message }).catch(() => undefined);
      throw e;
    }
  } finally { await sql.end({ timeout: 5 }); }
}

main().catch(e => { console.error(JSON.stringify({ error: (e as Error).message.slice(0, 500) })); process.exit(1); });
