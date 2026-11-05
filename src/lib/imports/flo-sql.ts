import { guardedMatchImportSql, MATCH_IMPORT_COLUMNS, type MatchImportRow } from "./matches-csv";
import { databaseFingerprintSql, sha256, type FloManifest } from "./flo";

const lit = (s: string) => "'" + s.replaceAll("'", "''") + "'";
export function approvedFloSql(manifest: FloManifest, approvalHash: string, approvalReference: string, selection?: string[]): string {
  const json = JSON.stringify(manifest);
  const hash = sha256(json);
  if (hash !== approvalHash || !approvalReference.trim()) throw new Error("Exact manifest hash and explicit owner approval reference required");
  if (!manifest.baselineFingerprint) throw new Error("Complete database baseline required before SQL generation");
  const clean = manifest.records.filter(r => r.status === "accepted" && r.normalized && r.signature);
  const requested = selection ? new Set(selection) : new Set(clean.map(r => r.signature!));
  if (!requested.size || (selection && requested.size !== selection.length) || [...requested].some(s => !clean.some(r => r.signature === s))) throw new Error("Selection must contain unique clean candidate signatures only");
  const rows = clean.filter(r => requested.has(r.signature!)).map(r => r.normalized!) as MatchImportRow[];
  const decision = JSON.stringify({ manifest, selectedSignatures: [...requested].sort(), approvalReference });
  const runHash = sha256(decision);
  const definition = MATCH_IMPORT_COLUMNS.map(c => c === "source_row" ? "source_row integer" : c === "event_date" ? "event_date date" : `${c} text`).join(",");
  const tuple = (alias: string) => `(${MATCH_IMPORT_COLUMNS.map(c => `${alias}.${c}`).join(",")})`;
  const batches = [];
  for (let i = 0; i < rows.length; i += 150) batches.push(`execute ${lit(guardedMatchImportSql(rows.slice(i, i + 150)))};`);
  return `-- ADMINISTRATOR ONLY. Execute as one request after owner review and approval of manifest ${hash}.
-- One transaction, including quarantine/audit evidence. No evidence refresh or rating activation.
begin isolation level read committed;
set local statement_timeout = '60s';
set local lock_timeout = '5s';
set local datestyle = 'ISO, YMD';
do ${lit(`declare payload jsonb := ${lit(JSON.stringify(rows))}::jsonb;
  decision jsonb := ${lit(decision)}::jsonb;
begin
  lock table public.matches in share row exclusive mode;
  lock table private.flo_import_runs in share row exclusive mode;
  if exists (select 1 from private.flo_import_runs where run_sha256=${lit(runHash)}) then
    if not exists (select 1 from private.flo_import_runs where run_sha256=${lit(runHash)} and evidence=decision) then
      raise exception 'Flo audit conflict';
    end if;
    if exists (select 1 from jsonb_to_recordset(payload) as e(${definition})
      left join public.matches m on m.source_file=e.source_file and m.source_row=e.source_row
      where m.id is null or ${tuple("m")} is distinct from ${tuple("e")}) then
      raise exception 'Previously imported rows changed or missing';
    end if;
    return;
  end if;
  if (${databaseFingerprintSql()}) <> ${lit(manifest.baselineFingerprint)} then
    raise exception 'Flo baseline changed; regenerate dry run and obtain new approval';
  end if;
  ${batches.join("\n  ")}
  insert into private.flo_import_runs(run_sha256,manifest_sha256,approval_reference,evidence,inserted_rows)
    values (${lit(runHash)},${lit(hash)},${lit(approvalReference)},decision,${rows.length});
end`)};
commit;
`;
}
