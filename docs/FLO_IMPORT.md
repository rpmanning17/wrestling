# Flo results importer — Phase 1 implementation

Implemented locally on November 5, 2026. **Not deployed or used for a production import.** The new audit migration is unapplied. No production matches, aliases, evidence or ratings were changed. Production read-only verification reconfirmed 67,736 matches and active model `a29c4460-5e56-4d22-902d-ea39c65bfcac`; the 23 applied migration versions still match the November 4 audit.

## Supported source, verified from private files

Inventory of four locally available historical results ZIPs found **208 CSV members / 92,613 data records / 205 exact event-date/location keys**, with no member parse failures. This is a source inventory, **not 92,613 new or unique bouts**. One private two-member ZIP exercise parsed 1,584 records, including 102 administrative outcomes. Without a complete database baseline every row is blocked, no SQL is produced, and no import is claimed. Originals and manifests remain outside Git. The multi-year inventory used the explicit `INVENTORY-ONLY` season label and must never be imported.

The versioned `flo-results-v1` adapter accepts the observed columns, in any order:

`Date,Weight,Round,Winning Wrestler,Winning Team,Result,Win Type,Losing Wrestler,Losing Team,City,State,Event`

It decodes UTF-8/BOM, standard CSV quoting and the observed spreadsheet `="value"` wrappers without evaluating formulas. Dates must be `M/D/YYYY` and calendar-valid. Supply an explicit reviewed season; the tool does not guess season boundaries. Weight/division labels remain verbatim bracket context. No measured bodyweight, birthdate, seed or placement is inferred. Headers with extra/unsupported fields are rejected for adapter review. Other encodings and Trackwrestling remain unsupported. Unknown outcomes, OTHER1, placeholder participants and self-matches are quarantined. Known administrative outcomes are preserved as raw records; the unchanged rating policy excludes them from ratings.

## Dry run

Use a committed checkout with locked dependencies. Keep all private inputs/outputs outside the repository. For example:

```powershell
pnpm flo:prepare --input C:/private/results.zip --season 2026-2027 --report C:/private/dry-run.json
pnpm flo:prepare --input C:/private/event.csv --input C:/private/more.zip --season 2026-2027 --baseline C:/private/matches.json --report C:/private/reconciled.json
```

These commands make **zero network/database calls**. Reports use exclusive writes and contain original decoded cells, record indexes, normalized proposals, source/member/container hashes, reconciliation statuses, identity-review candidates, missing prior rows and errors. Preserve the original CSV/ZIP bytes privately alongside the report. Indexes count CSV records including the header and blank records; embedded quoted newlines do not create new records. Archive/member paths remain evidence metadata; they do not become authoritative match keys.

The baseline is a **complete, consistent JSON array of `public.matches`**, containing at least the 15 normalized columns documented in MATCH_IMPORT_READINESS.md; extra fields such as IDs are ignored. Null source keys are retained. Export with one read-only administrator statement, rather than unrelated paginated requests:

```sql
select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb) from public.matches m;
```

Save the returned JSON array privately, without tool-result wrappers. A subset is not a valid baseline. The SQL generated later recomputes a full-column, length-prefixed SHA-256 under database locks and rejects any baseline mismatch. This detects same-count edits as well as additions/deletions. It covers match fields, not aliases; rating activation still requires the separate match/alias snapshot and full fingerprint gates.

Review `accepted + alreadySeen + blocked = rows`. Administrative counts overlap these statuses. Unparseable members have a separate `failedMembers` count and retain their file-level error; no unknown row count is invented. File-level failure blocks all parsed records from that member. Group exceptions by `member` and `issues`, then inspect `raw`, `sourceRow` and `normalized`. `events` uses exact date/name/city/state; it is a source reconciliation key, not a permanent tournament ID. Blank rounds and age context remain unknown. New display names are review candidates, never automatic aliases or new permanent person IDs.

## Reuploads, amendments and rematches

- New authoritative keys are `source_file = flo-v1/<versioned semantic SHA-256>`, `source_row = 2`. The original source row/file/hash is kept in the manifest and private database audit. The signature covers all bout/context fields except season and packaging. Season is still compared before accepting a canonical retry. These are **bout source signatures, not wrestler IDs**.
- Exact canonical retries become `already_seen`; byte-identical whole-file copies within one proposal retain each sighting while producing one candidate. Repackaging/renaming a ZIP does not create another canonical bout.
- Content matching a legacy source key is **possible duplicate**, not proof. No old source rows are rewritten or adopted silently. Reviewed legacy mapping/backfill is separate work.
- Identical bout rows at different source positions are quarantined. Without source bout IDs they might be distinct repeated contests. No automatic collapse or override is offered.
- Different results for the same pair in a single CSV remain distinct candidate rematches. Across exports, or against an existing baseline pair, they require review as possible corrections/rematches. Nothing overwrites the older result.
- Missing rows in a later export are reported, never deleted. Event/date/name changes may require manual event reconciliation. New-name candidates do not resolve same-name identity collisions.

## Approve a clean subset and prepare administrator SQL

**Show the reconciled manifest/counts and get explicit owner approval before any production import.** A hash/reference supplied to this offline CLI records that approval; it does not obtain authorization or bypass the administrator connection. Do not invent an approval reference.

After approval, regenerate using identical inputs, baseline and season, a new report destination, the exact printed `manifestSha256`, and a durable reference to the owner's approval:

```powershell
pnpm flo:prepare --input C:/private/results.zip --season 2026-2027 --baseline C:/private/matches.json --report C:/private/approved.json --sql C:/private/approved.sql --approve <manifestSha256> --approval-reference <owner-approval-reference>
```

Optional `--select C:/private/selected-signatures.json` accepts an array of unique **clean** candidate signatures, for batch selection. Quarantined rows cannot be promoted by this option. Ambiguous corrections, identity questions and indistinguishable repeated rows need additional evidence and a separately reviewed resolution; this release does not provide merge/split or correction persistence. Both the complete dry-run evidence and the selected subset/approval reference are retained in the run audit. Selection changes produce a different run hash. All-blocked runs remain durable private manifests, without a database write.

The administrator-only migration `20261105124918_flo_import_audit.sql` must first be separately reviewed/applied through the established migration process. It creates only an RLS-enabled private audit table with client/service-role privileges revoked and no public write function. **Do not use `supabase db push`: historical migration differences remain unresolved.** No migration is applied by this CLI.

Execute generated SQL as **one administrator request**, outside an existing transaction. It sets transaction-local timeout/DateStyle, locks matches and the audit ledger, validates the frozen baseline, runs existing conflict-checked insert batches, and saves approval/provenance/quarantine evidence in the **same transaction**. Cooperating simultaneous runs serialize; the loser with a stale baseline aborts. Replaying an acknowledged/unacknowledged committed request verifies exact imported records and audit evidence and returns without inserts. Any failure rolls back the entire import and ledger; issue `ROLLBACK` if the administrator session remains in a failed transaction. Preserve the report/SQL and retry only the identical payload after investigating the failure. Regenerating a changed proposal requires a new baseline/review/approval.

Post-import, independently compare all selected normalized fields/source keys, verify inserted totals and `private.flo_import_runs.evidence`, and retain the original/report/SQL hashes. Audit records have no client policy or public API. Administrators remain responsible for preserving them and the private original bytes. Evidence refresh is still a separate reviewed operation; no automatic refresh is installed.

Then follow [RATING_OPERATIONS.md](RATING_OPERATIONS.md): keep old ratings active, freeze matches **and aliases**, compute with the unchanged production config, validate the complete candidate, and obtain separate activation authorization. Previous active models remain rollback targets. No automatic recalculation, activation, importer UI or permission-management interface is introduced.

## Verification and remaining acceptance gates

Local checks: **170 tests passed**, including 16 Flo tests; lint, typecheck and production build passed with dummy build-only environment values. pnpm 11's automatic dependency verification attempted a sandbox-prohibited project symlink; scripts ran using `--config.verify-deps-before-run=false --config.manage-package-manager-versions=false` after installing the unchanged lockfile. No dependency or rating formula changes were made.

Synthetic fixtures cover observed headers, wrappers/quoting, blank indexes, malformed inputs/ZIP metadata/CRC, corrections, omitted rows, rematches, reuploads, legacy duplicate quarantine, clean subset/audit persistence, transactional rollback, retry and stale-baseline rejection. SQL executes in PGlite; all repository migrations also apply there. Real multi-session Postgres lock contention remains **unverified**; PGlite serial execution is not proof of production concurrency behavior.

Phase 1 is **partial until** migration review/application, a complete production-baseline reconciliation, explicit approval of a real clean subset, production round-trip verification/evidence refresh, and the separately authorized rating candidate/activation exercise. Durable batch resolution of ambiguous rows, reviewed legacy-source mapping and adapters for other source formats remain follow-ups. Phases 2–5 (canonical identity migration, tournament scouting, richer observations/history and prospective monitoring) are not implemented by this change.
