<!-- Historical release evidence; operational commands below reflect that release. -->
> Current import/recalculation procedure: [RATING_OPERATIONS.md](RATING_OPERATIONS.md). The legacy calculation writer, --force and --activate are now disabled. Do not repeat historical activation steps.

# Canonical Glicko-2 recovery — verified 2026-11-04

## Outcome

**Active:** `a29c4460-5e56-4d22-902d-ea39c65bfcac`, version `glicko2-daily-dec08-canonical-recovery-20261104-v1`, as of 2026-11-04, bouts through 2026-10-31. Exactly one active model. Activation used only existing restricted `private.activate_rating_model(uuid)` inside an anonymous transaction block that rechecked metadata, complete output, source fingerprints and old-model preservation under locks.

Previous active `d64fd4ba-de14-4d07-bac8-2961e12d506d` is archived, complete and unchanged except status; it remains the rollback target. Interrupted chat-port model `a957ed42-8ee2-4792-944d-5f63a0b4ce72` remains building with exactly 500 ratings and zero history; its metadata and rows are unchanged. **Never activate that incomplete model.** Neither uniqueness index was changed.

## Formula and truthful provenance

The recovery configuration changes **only modelVersion**, identifying canonical repository implementation/provenance, not a new formula. Every resolved numerical and policy setting equals validated production: daily periods, decision score 0.8, other contested wins 1, tau 0.5, initial RD 350, initial volatility 0.06, conservative k=1. No extra skill drift or expiration.

- Production formula config hash: `1eb854346d016d2c1276d8cc5209f73acac90c433fcc23636743e6a5e1881a67`.
- Actual recovery config hash: `70c8305bc412d7a5ec618ae1db2f932708482201228b455ad1d9d12c8d489b2d`. The different hash honestly includes the new version.
- Stored code_version: `73d8fb47db72dd767f38c62a6a7e38bfd1d56cf4/glicko2-engine-1`, the committed local source actually executed. Its exact tree `5c8bbcd4889ae54e4f7862fc9e36d647ecf827a2` was mirrored by GitHub source commit [482c65f](https://github.com/rpmanning17/wrestling/commit/482c65fb13f342879dc0408320d9f2d4576fa771); GitHub commit metadata differs, source tree does not. Later persistence guards/view optimizations are separately committed on [PR #7](https://github.com/rpmanning17/wrestling/pull/7).
- Input fingerprint: `7a19ca2f486aac6f1889e9f8e28a700115adb7ddb83a213c6e4be17b449101a9`.

Both regression fixtures and the full production snapshot produce **exactly identical serialized ratings and history** for production versus recovery configurations (substituting only model UUID). The full output also equals the independently generated pre-refactor baseline artifact. Private snapshot/output payloads are outside Git.

## Complete database validation

| Gate | Verified result |
|---|---:|
| Raw matches / source files | 67,736 / 199 |
| Calendar-2025 bouts | 35,861 |
| Additional Jan 2, 2026 backfill bouts | 30 |
| Rated contested bouts | 64,050 |
| Stored ratings | 11,724 |
| Stored history / distinct history athletes | 34,809 / 11,724 |
| Total wins / losses | 64,050 / 64,050 |
| Invalid records, numeric states, conservative scores, SOS, history | 0 |
| Independently recomputed record / opponent average / SOS / quality-record mismatches | 0 across 11,724 athletes |
| Exactly one active model | yes |

Full typed database-row SHA-256s match independent PGlite serialization of all expected rows, including every metric and identity:
- Ratings: `6d2d55368846ead18021829a19e9d9fd46b9cd212faeae61451cf0298be1c622`.
- History: `31e7fa97cbd769779709b8de9406e84764a38da6abd14376d451113f240e291a`.

Preservation MD5s remained identical across recorded checks. The first two were checked before/after persistence and activation; full-row JSON was first captured during loading and rechecked after activation/read fixes:
- id/result/method: `6d0c35fc56e3f9acecc54bca603bc771`.
- identity/event/context: `055ef1cf665dc4a1d8cdee5cd76bcae6`.
- Entire raw row JSON, ordered by id: `62b66f3179fc648dfac09c4be09a15a6`.

Exclusions remain 3,679 administrative outcomes, one self-match and six OTHER1; no exact duplicate exclusions. Rematches, identities, evidence, source labels and permissions remain intact. Read-only reproduction: `supabase/audits/rating_recovery_validation.sql`.

## Interrupted-write recovery process

1. Commit/review canonical sources and run lint/typecheck/tests/build. Create a genuinely versioned recovery config only after explicit review; never falsify hash/date/cutoff or relabel a different implementation.
2. Read an authorized snapshot outside Git and verify input/source hashes. Run:
   `node --import tsx scripts/ratings/recovery-export.ts --input ../ratings-input.json --as-of 2026-11-04 --out ../canonical-recovery-output.json`.
   It refuses uncommitted calculation sources and compares every serialized rating/history byte with production.
3. Through the existing administrator connector, create a NEW building model from truthful metadata. Save its UUID and immutable expected metadata outside Git. No credentials were requested, created or extracted.
4. Use `guardedBatchSql` for bounded batches: parent-row lock, building-only status, exact per-key nested metadata equality, exact existing-row comparison, insert missing rows only. No overwrite/delete and no silent conflict ignoring. Exact retries after committed-but-unacknowledged batches are safe. The run used 152 bounded batches after an earlier partial transport pass; overlapping rows were exactly verified, not duplicated.
5. After interruption, retain the partial building run. Regenerate from the recorded source/config/input; compare every existing row and full metadata before continuing that same canonical run. A mismatch stops recovery. Never apply this process to the chat-port model's different provenance.
6. Reconcile all stored rows and invariants, then promote to candidate. Activate separately through the existing guarded atomic function and verify live behavior. **Do not use the legacy calculate CLI's non-atomic `--activate` or catch-and-delete cleanup path.**

Regression tests cover exact serialization under 1/14/120-day gaps, aliases/exclusions, partial ratings/history retries, conflicting metrics/history, extra nested metadata, chat provenance, active status, duplicate keys, and quote/dollar-delimiter handling.

## Expanded-source live-read fixes

Live verification found cohort/club read timeouts, including cohort failures **before activation**. No timeout limit or permission was raised. New immutable view migrations preserve all columns/semantics/security_invoker/grants:
- Source `20261104201302_bound_expanded_cohort_reads.sql`; production `20261104201755`. Parse repeated weight/event labels once, remove redundant whole classification rows already collapsed by voting, fence the final full join. Complete 11,815-row cohort hash unchanged: `798785b72c0e4740a82fedd27e6cdd6aeef71d8215e5c683fab87dfc577603c4`. All 874 current standings also retain full-row hash `a56be0a8240f6761ea5c852bfe3ad8786a95127fdaf8c5219a0c6a028f6eaca0`.
- Source `20261104202147_bound_expanded_club_reads.sql`; production `20261104202335`. Resolve repeated literal team labels once without changing aliases, records, roster or SOS. All 3,995 club-season summaries retain hash `0f06b1b33dc1c6c8d36d42f01d03a3cc6bc1447ea9dccae03f446090fb218252`, normalizing only floating-point schedule output to 12 decimals for comparison.
- Refreshed planner statistics after bulk loading (`ANALYZE`); no data/config/permission changes. Measured classification query 5.36 → 2.11 s; strength after statistics 1.98 s; club list 2.61 → 1.93 s. Timings are observations, not service guarantees.
- CLI migration generation was unavailable locally; files use database-issued timestamps and authorized connector application. Record actual source/production version mapping above; historical migration reconciliation is still required before CLI pushes.
- Added regression comparisons between previous/optimized definitions over repeated/unparseable labels, literal punctuation aliases and all standings/club metrics, plus invoker/RLS checks. No stale materialized data cache or new public administrative function.

## Live and privacy verification

Production comparison, ranking lists (including expanded strongest list), club list and Longwood roster load with active-model data. Example: Waylon Jones shows Glicko 1532 / RD 121 / conservative 1410, 120 bouts, 65–55, average opponent 1604, Schedule Difficulty 39%, strength 520.85, #16/36, Tier 5, and the new model version through 2026-11-04. SQL agrees (1531.544 / 121.495 / 1410.049 / 1604.07 / 0.39490). His club-specific record is correctly separate (48–40 in Longwood appearances). Longwood: 90 wrestlers / 2,289 appearances / median conservative 1290.2 / SOS 44%; Camden: 152 / 2,069 / 1426.8 / 41%.

Phone-width comparison, ranking and club views have no page-width overflow; comparison sort retains the same standing. HTTP check [41906301641](https://github.com/rpmanning17/wrestling/actions/runs/41906301641) independently verifies **200 + no-store + noindex** on /, /rankings and /clubs. Initial HTTP failure exposed the read timeout and is retained as historical evidence, not hidden.

Unauthenticated database reads return zero for ratings/cohorts/clubs; anonymous/authenticated activation privileges remain false. Security advisor has no warnings/errors; the existing deliberately denied private ledger has its unchanged [informational no-policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Production error/fatal scan from 2026-11-04T20:23:35Z through 20:25:55Z found no entries after successful fixes; earlier errors are documented above. No log drain/monitoring configuration changed.

Final code validation: **139/139 tests**, lint/typecheck, and production build via [GitHub CI 41906301765](https://github.com/rpmanning17/wrestling/actions/runs/41906301765). Earlier local full build passed; a later local build encountered EPERM and elevated execution was automatically denied, so final build evidence is CI. No credentials or raw exports are committed. Expanded backtests continue to support the same production formula; experimental drift failed its adoption threshold and remains unadopted on draft PR #6.

## Rollback

The archived complete model is intact. If owner-authorized rollback is needed, validate its stored invariants and use the same existing atomic function with `d64fd4ba-de14-4d07-bac8-2961e12d506d`. Never target the 500-row chat model. Rolling back ratings does not require deleting source rows, models or read-optimization migrations.
