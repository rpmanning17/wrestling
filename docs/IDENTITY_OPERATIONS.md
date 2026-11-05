# Person identity release and rollback

This branch implements agent-side wrestler matching and a person-keyed read path. There is no matching UI. Original bouts, names, results, entries and observations are never edited by identity resolution. The old active model remains `a29c4460-5e56-4d22-902d-ea39c65bfcac` until a separately authorized activation.

## Verified private inputs and decisions

Keep `confirmed-identity-decisions.json`, `identity-policy-inferred-links.json`, `identity-nickname-inferred-links.json` and `identity-source-snapshot.json` outside Git. The full production match-row MD5 must remain `62b66f3179fc648dfac09c4be09a15a6` and the count 67,736 before any rollout. Current club aliases number 417. Revalidation reads the 27-alias applied catch-up migration and recomputes current case evidence hashes; 51 spelling evidence hashes and 12 nickname evidence digests differ from the earlier private artifacts because evidence is now keyed to the current alias snapshot. No source records changed.

The current private plan has 31 owner-confirmed same-person decisions, two confirmed distinct Aaron Jones with 16 listed match-side assignments, three source-evidenced distinct Bermudez wrestlers, one held Giovanni Maestre self-result, 257 agent-inferred spelling links and 12 nickname links. All 269 agent links pass the shared-club/opponent rule and whole-group contradiction check. Exact owner appearance scopes are enforced; unlisted rows are held, not assumed. The plan assigns 135,903 of 135,919 source appearances and holds 16 (two match sides, five entries and nine observations). The one held contested bout was already excluded as a self-result by the old rating model. All other source matches remain present.

Rebuild private artifacts after a source or club-alias change:

```powershell
node --import tsx scripts/identity/revalidate-links.ts C:/private/identity
node --import tsx scripts/identity/calculate-candidate.ts C:/private/identity 2026-11-05
node --import tsx scripts/identity/validate-candidate.ts C:/private/identity
node --import tsx scripts/identity/backtest-candidate.ts C:/private/identity
```

These scripts read private files and write only to that private directory. They do not connect to Supabase. Do not commit their output or paste raw participant payloads into a PR.

## Additive database rollout

Apply only the three new SQL files, in order, through the connected administrator migration tool after checking live schema and migration history. Do not use `supabase db push`: older migration versions are unreconciled. Verify personal-app RLS and `security_invoker` after applying. The old app/model remains on the name-key path because the new views only become authoritative with an active `person_uuid` model.

1. `20261105180000_person_identity_foundation.sql`: UUID people, decision ledger, revisioned source assignments, guarded batch writer, nullable person notes, model identity columns and person source views.
2. `20261105181000_person_cohort_views.sql`: same validated three-event vote, tier and conservative score over assigned person sources.
3. `20261105182000_person_club_views.sql`: event-team roster and club aggregates keyed by person ID.

The private `rollout-sql.ts` emits one connector request at a time. Run `people` batches 0–11, `decisions` batch 0, then `assignments` batches 0–135. Each assignment batch has at most 1,000 sides/entries/observations. Use its stdout only as the input to the connected administrator SQL tool; the output contains private names and must stay outside Git. Batches are idempotent only when every existing value agrees. They check the recorded source name and expected revision before inserting history/current state atomically. A failed batch rolls back entirely and can be inspected and retried without deleting earlier batches. The indexed current state is a projection of immutable history.

After all batches, verify counts: 11,520 people, 280 decisions, 135,919 current assignments, 135,903 non-null assignments, 16 held. Independently compute the SQL fingerprint using the same ordered UTF-8/hex row encoding as `calculate-candidate.ts` and compare with `rating_models.assignment_fingerprint` in the private candidate. Recheck the full source MD5, total rows, specific owner source assignments, Aaron separation, Bermudez direct-opponent separation, and denied anonymous writes. No active rating changes during this step.

## Candidate model and release gate

The offline export is `identity-417-rating-candidate.json` in the private directory. It has 64,050 rated bouts, 11,430 person ratings, 34,776 history points, and balanced wins/losses. Independent source, repeated-pair, person-split and SOS checks pass; `identity-417-candidate-validation.json` records the counts. The fixed-formula, same-outcome walk-forward comparison is recorded in BACKTEST_REPORT.md. The model has a new truthful `model_version`, `identity_scheme=person_uuid`, full config/hash, source/assignment input fingerprint and `assignment_fingerprint`.

Persist through the existing guarded administrator rating-batch process in RATING_OPERATIONS.md, with the new `person_id` columns on rating/history rows. Insert a new **building** model, verify full row and history payloads and provenance, promote to candidate under the existing locks, then validate profile/ranking/club SQL against the candidate before activation. The database trigger rejects activation unless match-side assignments are complete, the current assignment fingerprint agrees, all rating keys are person UUIDs and both record totals equal the rated bout count. That trigger is an additional guard; it does not replace full source and output checks. Do not activate without separate owner authorization. Deploy the app code before switching the model, then verify the mobile UI and privacy headers after authorization.

## Rollback

If a person model was activated, first atomically restore the last validated name-key model through the supervised activation procedure. The assignment functions refuse changes while a person model is active. To undo the imported assignments, create the private rollback decision (`rollout-sql.ts ... rollback-decision 0`) and apply `rollback` batches 0–135. Each batch records a new null-person revision and references the original batch; prior people, decisions, source records and history remain. Re-running an identical rollback batch is a no-op. The PGlite migration test independently exercises assignment, identical retry, stale revision refusal, source-name guard and rollback. Recheck the current projection, source MD5, active model and access controls after rollback. Do not delete original records, models or decision history.
