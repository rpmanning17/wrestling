# Import and rating operations

> **Current procedure (2026-11-12): [RELEASE_PIPELINE.md](RELEASE_PIPELINE.md).** Tournament imports, identity resolution and rating releases run through the agent-operated CI pipeline. The material below documents the underlying guards it reuses and the historical manual procedure; do not hand-run connector batches for a new tournament.


Current baseline and preservation evidence: [RATING_RECOVERY_RELEASE.md](RATING_RECOVERY_RELEASE.md). This is the current procedure; historical activation/handoff commands are not instructions to repeat the November 4 recovery. No automatic refresh job is installed. Importing results changes source/evidence views immediately but does **not** recalculate stored Glicko ratings.

## 1. Import and freeze inputs

Use the existing authorized administrator connection. Preserve raw source files and checksums privately. The match CSV importer is outside this repository: obtain and review that importer before an import; the checked-in tournament-observation builder does not import bouts. Preserve source_file/source_row uniqueness; retry the same source pairs without overwriting existing records. Investigate conflicting pairs, unknown outcomes, ambiguous identities and possible rematches rather than guessing. Placements are not wins. Refresh derived evidence only through the existing reviewed import procedure.

Record import counts, date ranges, source checksums and exclusion counts. Pause imports and identity edits while taking a **single repeatable-read snapshot** of matches and wrestler_aliases through the authorized connection. Export the calculation fields listed in scripts/ratings/common.ts as `{ "matches": [...], "aliases": [...] }` to private storage outside Git. Independent paginated REST reads are not a consistent database snapshot during concurrent imports. Compare total/distinct IDs, source pairs and full-row preservation hashes with the database. Retain the immutable snapshot through validation and rollback review.

## 2. Calculate a private candidate payload

Use a clean, committed checkout, locked dependencies and passing lint/typecheck/tests/build. Choose an explicit as-of date on or after the snapshot's last bout. Keep the existing production formula. New results normally provide a new input fingerprint; do not change modelVersion, dates or hashes merely to bypass uniqueness.

```bash
pnpm ratings:calculate --config config/ratings.production.json --input ../snapshot.json --as-of YYYY-MM-DD --dry-run
node --import tsx scripts/ratings/recovery-export.ts --config config/ratings.production.json --input ../snapshot.json --as-of YYYY-MM-DD --out ../candidate.json
```

Both commands write no database records. The exporter requires a private immutable input, clean calculation sources and explicit date. It checks full serialized output against the production formula. It records the actual commit in code_version. Explicit `--config` selects the normal future-import path; omission is reserved for historical November 4 reproduction.

New exports use input fingerprint **v2**, a versioned JSON encoding of every calculation field plus alias display names. It covers event/round/team context omitted by the historical fingerprint and avoids delimiter ambiguity. Stored historical fingerprints remain unchanged. A v2 fingerprint is not evidence that source data changed relative to a v1 fingerprint. Record both snapshot and payload hashes in the private manifest. Do not reinterpret historical models or automatically replace the active model.

## 3. Create or resume one building run

For the November 9 current-assignment path, run the validator with private report basename `person-candidate-validation-release.json`. The report binds the exact payload, snapshot roots and source-file hashes. `snapshot-rollout-sql.ts <directory> model` emits the one-time model insert; inspect uncertain outcomes before any retry. After saving its UUID, `snapshot-rollout-sql.ts <directory> stage <UUID>` prepares immutable 250-row guarded writes plus independent typed-record verification requests. Exact local staging resumes without overwriting changed requests.

Write and verify batches use global C-key order (history also period_end). Each read-only verification checks every typed column and returns the expected SHA256 chunk hash of ordered full-row MD5 leaves. Hashing the ordered 250-row chunk hashes yields a complete two-level output root. Recompute the same root under source/model/child-table locks at promotion and activation, with exact counts, to reject intervening child edits or extra rows. Retain private progress and roots. On a connector timeout, inspect the corresponding read-only verification first: acknowledge a committed matching batch without replaying the write; retry only after proving it did not commit. Never delete or replace an interrupted run.

Run identity is enforced by the existing unique index on config_hash, input_fingerprint, as_of_date and effective match_cutoff. The UUID identifies the actual run; code_version and full config/provenance must also match before resume. Simultaneous identical creations cannot both succeed. On a uniqueness error, read the existing run and compare **all** expected metadata; never retry with --force, delete a partial run or falsify provenance. A differing implementation with an occupied identity requires explicit review, as the November 4 recovery did.

Insert the exported `model` metadata once through the administrator connector, returning its UUID. Save that UUID and the complete inserted expected metadata in the private manifest. Replace `PENDING` in every exported rating/history row with that UUID. Generate bounded SQL requests with `guardedBatchSql` from src/lib/rating/recovery.ts (e.g. 250 rows per request), passing `{ ...payload.model, id: modelId }` as expected metadata. Do not use unguarded INSERT/upsert or the old service-key calculation writer.

Each batch locks the parent, requires building status, compares expected nested metadata exactly, verifies every existing payload column and inserts only missing keys. Execute one batch per transaction. Replaying an acknowledged or unacknowledged committed batch is safe; a conflict rolls back the entire batch. Preserve interrupted runs. Resume from the **same committed code, snapshot, config, date and UUID**, regenerate and compare private payload hashes, then replay batches. Active, candidate and archived targets are rejected. Cooperating writers on the same parent serialize on its row lock; different outputs conflict. Database administrators can bypass this protocol, so coordinate maintenance and do not run direct child-table writers concurrently.

## 4. Validate, then promote

Use supabase/audits/rating_recovery_validation.sql as the historical example; substitute the new UUID and expected values, including the candidate's quality threshold. Its historical v1 fingerprint and fixed November 4 counts are not future-run gates. Require exact metadata, exact full serialized rating/history equality against the retained payload (typed database serialization), no missing/extra keys, complete history coverage, balanced wins/losses, finite numeric states, conservative-score consistency and independently recomputed SOS/records. Counts alone are insufficient.

Before promotion, start one administrator transaction, lock the parent FOR UPDATE and lock both rating child tables in SHARE mode to exclude concurrent child writes while verifying. Recheck complete metadata, full output and source preservation in that transaction; promote building→candidate only if every gate passes, then commit. Retain validation evidence privately. On any failure rollback and preserve the building run; do not clean up by deletion.

## 5. Activate only after authorization

Activation is a separate owner-authorized operation. In a single administrator transaction, lock `rating_models` in SHARE ROW EXCLUSIVE mode (serializes competing activations and metadata changes), lock the child tables in SHARE mode, and lock source matches/aliases in SHARE mode. Recheck the expected old active UUID, the candidate status/config/provenance, full output validation and that live source still matches the snapshot. Abort if an intervening import or activation occurred. Call the existing restricted function:

```sql
select private.activate_rating_model('<validated-candidate-uuid>'::uuid);
```

Commit only after exactly one active model and the expected archived predecessor are confirmed. The function switches status atomically, but does not itself validate output completeness or source freshness; never call it without the preceding gates. Its unique active index prevents multiple active models; an error rolls back the whole transaction. Do not widen permissions, expose a public RPC or use the removed non-atomic CLI path.

Verify comparison/rankings/clubs against SQL, phone layout, privacy headers and deployment errors. Record actual UUID, hashes, counts, checks and limitations in STATUS/release evidence. Keep old models and partial runs intact.

## Rollback and freshness

Owner-authorized rollback uses the same transaction/locks, expected-current check and complete-output validation, targeting a known complete archived model. Historical source changes are expected for an old model: explicitly document its older coverage rather than require equality with today's source. Never select the incomplete chat-port run. No raw deletion or formula change is needed.

Rating details display model version and as-of date; as-of is the uncertainty date, not proof that every imported source is included. There is no automatic stale-data warning or scheduled recalculation. After imports, record “ratings pending recalculation” in operational status and compare candidate/active fingerprint and coverage before calling ratings current. Evidence/cohort labels can already reflect new sources while Glicko remains at the prior snapshot. Automated source-freshness UI and a maintained match importer remain follow-up work; the secure connector workflow intentionally retains human validation and activation.
