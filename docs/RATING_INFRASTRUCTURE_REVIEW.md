# Independent rating infrastructure review — November 4, 2026

Reviewed AGENTS, requirements/status/architecture/data model/rankings/decisions, activation and recovery release documentation; PR #6's handoff, experimental runtime/reports; PR #7's engine, shared serialization, guarded SQL, migrations and regression tests. Reviewed the live activation function and uniqueness definitions through read-only SQL.

## Findings and corrections

1. **Legacy CLI could destroy failure evidence and switch activation non-atomically.** A failed batch deleted its parent and cascaded partial rows; separate archive/promote requests could leave no active model. Duplicate detection also omitted cutoff and code provenance. Removed the legacy write path. Commands fail before reads unless explicitly dry-run, and reject --force/--activate. Existing connector batches are the single persistence protocol.
2. **Historical input fingerprint omitted output-relevant context.** Event/round changes can affect preparation/deduplication; team and canonical display names affect persisted output. New calculations use versioned, delimiter-safe JSON fingerprints covering all calculation fields. Historical v1 hashes are preserved for reproduction; no existing model metadata is rewritten.
3. **Batch metadata could be underspecified by a caller.** Require core config/hash/date/cutoff/implementation provenance before generating guarded SQL. Existing exact nested equality, parent-row locking, building-only status and strict existing-row comparison remain intact. Added missing-provenance and archived-target regression checks.
4. **Normal import guidance led to the unsafe CLI and stale coverage claims.** Extended the private exporter for future unchanged-production calculations, requiring explicit frozen input/date and committed sources. Added the import/recalculation runbook; corrected current-vs-historical coverage and linked older release instructions to the current procedure.

No mathematical settings, engine updates, applied migrations, RLS, grants or indexes changed. No production model, source, identity, historical result or rating row was written. No production recalculation or activation was performed.

## Production baseline rechecked

Sole active UUID: a29c4460-5e56-4d22-902d-ea39c65bfcac. Source 67,736 / 199 files / 35,861 calendar-2025 rows; every source pair unique. Active ratings 11,724; history 34,809 across 11,724 athletes; wins/losses 64,050 each; zero audited invalid record/state/conservative/SOS rows. Config hash 70c8305bc412d7a5ec618ae1db2f932708482201228b455ad1d9d12c8d489b2d; input hash 7a19ca2f486aac6f1889e9f8e28a700115adb7ddb83a213c6e4be17b449101a9. Daily periods and decision-0.8 remain unchanged.

Source outcome MD5 6d0c35fc56e3f9acecc54bca603bc771 and context MD5 055ef1cf665dc4a1d8cdee5cd76bcae6 match the release. Old model remains archived with 7,788 ratings / 16,951 history; incomplete historical run remains building at 500 / zero. Both uniqueness indexes remain present, and anon/authenticated cannot execute activation. This review reconfirmed counts/invariants/source checksums; it did not repeat the prior release's complete output hash or live UI/mobile audits.

## Operational readiness and remaining limits

Ready for **supervised** imports/recalculation using RATING_OPERATIONS.md, with frozen inputs, exact resume verification, independent complete-output validation and separately authorized atomic activation. New imports feed the next full calculation; no incremental rating update or automatic refresh exists. Identical runs are deduplicated by the database identity; partial runs are retained and resumed only on exact provenance/output agreement. Parent locks serialize cooperating writers; transaction/table locks in the runbook serialize promotion/activation against source and child writes. Administrators bypassing the protocol remain an operational risk.

The match CSV importer is outside this repository, so its implementation is not independently certified by this review. Ratings display version/as-of date but have no automatic stale-source warning; evidence/cohort views can reflect newer imports before ratings do. Maintain an operational “ratings pending” status until validation/activation. Keep migration-history reconciliation as a separate task before CLI pushes. Identity ambiguity, uncertain rematches, sparse age context and incomplete event coverage remain unchanged limitations. None calls for further formula experimentation.

## Research disposition

PR #8 preserved the recency report pair and concise methodology/decision in main; expanded reference-grid reports already existed. PR #8 full CI passed. PR #6 is closed, evaluated/not adopted, with a reconciliation comment. All four drift settings failed the predefined minimum improvement; experimental runtime was not merged. Historical handoff instructions were not duplicated over newer PR #7 evidence.

## Validation

141/141 tests, lint and typecheck pass locally using the locked dependencies and direct equivalents of package script entrypoints. Synthetic future-export smoke: 24 ratings, 460 history, balanced 342 wins/losses, exact production serialization. Local production build attempted but Windows denied native SWC download/rename; final hardening PR CI is the production-build authority. Initial generated-SQL test failure was Windows CRLF checkout conversion; restoring committed migration/rollback bytes fixed it without changing those files. No raw exports or credentials are committed.
