# Canonical Glicko-2 recovery — 2026-11-04

Owner approved a new calculation version after the interrupted chat-port run failed exact provenance verification. `config/ratings.recovery-20261104.json` changes only modelVersion to `glicko2-daily-dec08-canonical-recovery-20261104-v1`; this is implementation/provenance versioning, **not a new formula**. The resolved numerical/policy settings are exactly production daily Glicko-2 / decision-0.8. No experimental drift. Original incomplete model and both uniqueness guards remain unchanged.

## Execution and interrupted-write recovery

1. Commit/review the calculation sources; run lint, typecheck, tests, build.
2. Export an authorized read-only snapshot outside Git; independently verify source checksums/fingerprint. Run `node --import tsx scripts/ratings/recovery-export.ts --input ../ratings-input.json --as-of 2026-11-04 --out ../canonical-recovery-output.json`. This uses the canonical engine, compares every serialized rating/history byte against production, and refuses uncommitted calculation sources. The private output must never be committed.
3. Create a new building model using the output metadata through the authorized administrator connector. Persist explicit UUID and immutable expected metadata before any batches. No local credentials or public RPC required.
4. Use `guardedBatchSql` from `src/lib/rating/recovery.ts` for ratings/history. It locks and verifies the parent metadata/building status, refuses conflicts, inserts missing rows only, and safely accepts exact retries. Retain partial output on interruption; regenerate the same artifact from its recorded commit, verify all metadata and the entire existing output before resuming this canonical run. Never apply this to the earlier chat-port run or overwrite a different output. No catch-and-delete cleanup.
5. Reconcile every stored row against expected output, then run complete count/balance/SOS/history/hash/source gates before candidate promotion. Activation is a separate restricted atomic administrator operation using `private.activate_rating_model`. Never use calculate.ts `--activate` (its legacy two-request switch remains unsuitable).
6. Verify live app and logs, exactly one active model, archived complete rollback model, unchanged incomplete run and raw/evidence/access data.

## Regression coverage

Recovery config exactness; full serialized ratings/history across 1/14/120-day gaps, aliases and excluded outcomes; interrupted ratings and history retries; conflicting metric/history rejection without overwrites; provenance mismatch and active status rejection; quote/dollar-delimiter handling; duplicate batch identities. Full production-snapshot serialization equality is also enforced by the exporter at execution time. Shared serialization is used by the existing calculation CLI and recovery exporter.

## Validation / production execution

Implementation checks: 137 tests plus lint/typecheck/build passed with dummy build values. Live persistence and activation are pending; update this section only with verified results.
