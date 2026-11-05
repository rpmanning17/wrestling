/** Emits one bounded administrator-connector SQL request. Never write its output into Git. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PlannedAssignment, PlannedDecision } from "../../src/lib/identity/plan";

const [directory, phase, rawIndex] = process.argv.slice(2);
if (!directory || !["people", "decisions", "assignments", "rollback-decision", "rollback"].includes(phase))
  throw new Error("Use private directory and people|decisions|assignments|rollback-decision|rollback [index]");
const index = Number(rawIndex ?? 0);
if (!Number.isInteger(index) || index < 0) throw new Error("Nonnegative batch index required");
const read = (name: string) => JSON.parse(readFileSync(path.join(directory, name), "utf8"));
const plan = read("identity-417-assignment-plan.json") as { sourceChecksum: string;
  people: Array<{ id: string; displayName: string }>;
  decisions: PlannedDecision[]; assignments: PlannedAssignment[] };
const candidate = read("identity-417-rating-candidate.json") as { model: { assignment_fingerprint: string } };
const idFor = (text: string) => {
  const hex = createHash("sha256").update(`mat-notes-rollout-v1:${text}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "89ab"[parseInt(hex[16], 16) & 3];
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const data = (value: unknown) => `${literal(JSON.stringify(value))}::jsonb`;
const batchSize = 1000;
const take = <T>(items: T[]) => {
  const batch = items.slice(index * batchSize, (index + 1) * batchSize);
  if (!batch.length) throw new Error(`No ${phase} batch ${index}`);
  return batch;
};
const source = plan.sourceChecksum;
const fingerprint = candidate.model.assignment_fingerprint;
const batchId = (i: number) => idFor(`${fingerprint}:assignments:${i}`);
const rollbackId = idFor(`${fingerprint}:rollback-decision`);
const baseline = plan.decisions.find(d => d.authority === "administrative" && d.disposition === "same_person");
if (!baseline) throw new Error("Baseline administrative decision missing");
let sql = "";
if (phase === "people") {
  const batch = take(plan.people.map(p => ({ id: p.id, display_name: p.displayName })));
  const body = `declare payload jsonb := ${data(batch)}; begin
    if exists(select 1 from jsonb_to_recordset(payload) x(id uuid,display_name text)
      join public.wrestler_people p using(id) where p.display_name<>x.display_name)
      then raise exception 'Existing person display name differs'; end if;
    insert into public.wrestler_people(id,display_name)
      select id,display_name from jsonb_to_recordset(payload) x(id uuid,display_name text)
      on conflict(id) do nothing;
  end`;
  sql = `do ${literal(body)}; select ${index} batch_index,${batch.length} expected_people;`;
} else if (phase === "decisions") {
  const batch = take(plan.decisions.map(d => ({ id: d.id, authority: d.authority,
    disposition: d.disposition, source_checksum: d.sourceChecksum, evidence_hash: d.evidenceHash,
    evidence: d.evidence, rationale: d.rationale })));
  const body = `declare payload jsonb := ${data(batch)}; begin
    if exists(select 1 from jsonb_to_recordset(payload) x(id uuid,authority text,disposition text,
      source_checksum text,evidence_hash text,evidence jsonb,rationale text)
      join public.identity_decisions d using(id) where d.authority<>x.authority or d.disposition<>x.disposition
        or d.source_checksum<>x.source_checksum or d.evidence_hash is distinct from x.evidence_hash
        or d.evidence<>x.evidence or d.rationale<>x.rationale)
      then raise exception 'Existing identity decision differs'; end if;
    insert into public.identity_decisions(id,authority,disposition,source_checksum,evidence_hash,evidence,rationale)
      select id,authority,disposition,source_checksum,evidence_hash,evidence,rationale
      from jsonb_to_recordset(payload) x(id uuid,authority text,disposition text,
        source_checksum text,evidence_hash text,evidence jsonb,rationale text)
      on conflict(id) do nothing;
  end`;
  sql = `do ${literal(body)}; select ${index} batch_index,${batch.length} expected_decisions;`;
} else if (phase === "assignments") {
  const batch = take(plan.assignments.map(a => ({ source_kind: a.sourceKind, source_id: a.sourceId,
    recorded_name: a.recordedName, person_id: a.personId, decision_id: a.decisionId,
    expected_revision: 0 })));
  const id = batchId(index);
  sql = `begin;
    insert into public.identity_assignment_batches(id,decision_id) values (${literal(id)}::uuid,${literal(baseline.id)}::uuid)
      on conflict(id) do nothing;
    select private.apply_identity_batch(${literal(id)}::uuid,${data(batch)}) applied;
    commit;`;
} else if (phase === "rollback-decision") {
  sql = `insert into public.identity_decisions(id,authority,disposition,source_checksum,rationale,evidence)
    values (${literal(rollbackId)}::uuid,'administrative','rollback',${literal(source)},
      'Restore unassigned source appearances after person-model deactivation',
      jsonb_build_object('assignment_fingerprint',${literal(fingerprint)}))
    on conflict(id) do nothing; select ${literal(rollbackId)} rollback_decision_id;`;
} else {
  const batch = take(plan.assignments.map(a => ({ source_kind: a.sourceKind, source_id: a.sourceId,
    recorded_name: a.recordedName, person_id: null, decision_id: rollbackId, expected_revision: 1 })));
  const original = batchId(index);
  const reverted = idFor(`${fingerprint}:revert:${index}`);
  sql = `begin;
    insert into public.identity_assignment_batches(id,decision_id,reverts_batch_id)
      values (${literal(reverted)}::uuid,${literal(rollbackId)}::uuid,${literal(original)}::uuid)
      on conflict(id) do nothing;
    select private.apply_identity_batch(${literal(reverted)}::uuid,${data(batch)}) reverted;
    commit;`;
}
process.stdout.write(sql);
