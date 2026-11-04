# Interrupted rating-write recovery investigation — 2026-11-04

## Decision: STOP; exact provenance gate failed

No database writes, schema/index changes, resume operations or activation were attempted in this investigation. The current production formula remains daily Glicko-2 / decision-0.8. The old active model is preserved.

Target: `a957ed42-8ee2-4792-944d-5f63a0b4ce72`, status building, 500 ratings, zero history. Reference: complete output calculated from main `d99f0428a102202027876fafe207cf0b8fc2a6fb` using the repository engine and unchanged CLI serialization/rounding.

## Exhaustive row comparison

Read all 500 production rows ordered by athlete_key. Matched against the complete 11,724-row output by exact athlete_key. Compared all 25 payload fields (12,500 field comparisons) with exact scalar equality and recursively sorted JSON-object keys, retaining array order. No numeric tolerance or rounding beyond the CLI's persisted rounding was allowed. model_id was separately verified as the target UUID; no other stored columns were omitted.

Fields: athlete_key, athlete_name, team, rating, rating_deviation, volatility, conservative_score, rating_status, match_count, wins, losses, first_match_date, last_match_date, pin_pct, bonus_pct, win_methods, loss_methods, avg_win_margin, avg_loss_margin, margin_samples, avg_opponent_rating, sos_expected_win_pct, quality_wins, quality_losses, rating_trend.

**Result: 500/500 exact matching rows; zero missing identities, zero field mismatches.** Stored rows canonical-JSON SHA-256: `380be1d8cdef6ceecf6dc71cc9be386fa6aea312be8c5e3e9b2f8a25ac316417` (array ordered by athlete_key; object keys recursively sorted). Private athlete-level output is not committed.

## Complete metadata/provenance review

All 21 CLI model-payload fields were compared. Twenty match exactly, including full resolved config, exclusions JSON, model version, configuration hash, input fingerprint, as-of/cutoff/first-match dates, period and recency policy, thresholds and input/rated/athlete counts.

- Configuration SHA-256: `1eb854346d016d2c1276d8cc5209f73acac90c433fcc23636743e6a5e1881a67`.
- Input fingerprint: `7a19ca2f486aac6f1889e9f8e28a700115adb7ddb83a213c6e4be17b449101a9`.
- As of 2026-11-04; cutoff 2026-10-31; first match 2024-10-05.
- 67,736 raw / 64,050 rated / 11,724 wrestlers; quality threshold 1,737.80.
- **Mismatch: stored code_version = `chat-20261104/glicko2-engine-1`; fresh code_version = `glicko2-engine-1`.**
- Additional metadata reviewed: label identifies 2025 backfill; notes explicitly identify an earlier in-chat JavaScript port and 60 old-model rating/RD spot checks, not execution of the repository TypeScript engine. created_at and calculated_at are both 2026-11-04T18:26:06.974477Z; backtest_metrics is null. These are historical provenance, not overwritten.
- Old active model provenance is `003bf0f/glicko2-engine-1`; commit-qualified and chat-qualified provenance must not be silently normalized to the bare engine tag.

The 500 matching rows are strong evidence of agreement for that subset. They do not establish exact implementation equivalence for the remaining 11,224 rows and 34,809 history points, or make the different provenance strings identical. The owner's rule says to stop on any mismatch; therefore automatic resume is not authorized by the successful row comparison.

## Preservation recheck

Both source MD5s remain `6d0c35fc56e3f9acecc54bca603bc771` and `055ef1cf665dc4a1d8cdee5cd76bcae6`. Database still has precisely the original active model (7,788 ratings / 16,951 history) and target building model (500 / zero). Unique-run and one-active indexes are unchanged.

## Proposed replacement for review; NOT implemented or executed

Prefer a genuinely versioned recovery run rather than modifying the unique index or changing the interrupted model's recorded provenance:

1. Introduce a separately named, reviewed recovery config/model version identifying execution by the repository engine. Copy every numerical/policy setting from production unchanged. Record why the modelVersion differs; calculate and publish the genuinely derived config hash, which changes because modelVersion is part of config. Preserve the source fingerprint, dates and actual cutoff. Do not pretend this is the original failed run or reuse its config hash.
2. Test that production and recovery configurations produce exactly identical serialized ratings/history, apart from model/run identifiers. Explicitly document semantic equivalence and the different run provenance.
3. Persist a NEW building model through existing authorized administrator access, using commit-qualified engine provenance. Keep the old 500-row building model unchanged as interrupted-run evidence, and keep the current active model until all gates pass.
4. Reconcile all stored output against the complete expected output; require exactly 11,724 ratings, 34,809 history points covering 11,724 athletes, 64,050 wins and losses, valid/complete SOS and numerical states, and unchanged source fingerprints.
5. Mark candidate only after full validation; activate solely through existing restricted atomic function; verify live wrestler/ranking/club/SOS/privacy/log behavior and preserve rollback.
6. No adoption of experimental drift.

This is a proposal requiring review, not a change made merely to evade a constraint. Alternative: separately review explicit equivalence attestation for the historical chat implementation and a provenance-preserving continuation design. That would revise the owner's current exact-match rule and is not assumed authorized here.

## Required safe resume design and regression tests for future repository runs

Implementation is deferred because this target failed the requested exact provenance gate. No resume code or new passing test suite is claimed.

- Explicit target UUID and building-only gate; reject candidate/active/archived targets before writing.
- Recalculate complete expected output; verify all metadata/provenance and each existing rating/history row, including unexpected keys and JSON metrics; reject every mismatch without any update/delete.
- Insert missing rows only; never upsert over existing records. Repeated execution after interruptions and lost acknowledgements must produce identical output and no duplicates. Reject conflicting concurrent inserts rather than accepting ON CONFLICT DO NOTHING without subsequent exact comparison.
- Retain partial building output on failure; the current CLI catch-and-delete behavior must be replaced for recoverable runs.
- Re-read/verify all stored rows and source/config hashes before promotion. Atomic promotion/activation must reject incomplete or changed data and must never use the CLI's current two-request switch.
- Regression cases: matching partial ratings; partial history; repeated resume/no-op; interruption after committed batch; stale metadata/config/input/cutoff/code provenance; one changed rating/RD/volatility/record/SOS/method metric; unexpected athlete/history key; missing history; invalid/nonfinite state; imbalanced records; concurrent conflict/status change; preserved old active model on every failure.
- Add a negative test specifically for `chat-20261104/glicko2-engine-1` versus `glicko2-engine-1`. A future equivalence policy, if separately approved, must have explicit tests and immutable audit evidence.

The uniqueness constraint does not need to be changed for the proposed honestly versioned replacement. Neither recovery nor activation has occurred.


## 2026-11-04 — APPROVED recovery implemented and activated

The owner approved the documented versioned canonical replacement. **Sole active model is now `a29c4460-5e56-4d22-902d-ea39c65bfcac`**, version `glicko2-daily-dec08-canonical-recovery-20261104-v1`, as of 2026-11-04. Same production formula; only implementation/provenance version differs. Config hash `70c8305bc412d7a5ec618ae1db2f932708482201228b455ad1d9d12c8d489b2d`; source fingerprint unchanged. All 11,724 ratings / 34,809 history / 64,050 wins and losses are stored, exact full-output hashes and independent SOS audit pass. Old active is archived intact; the 500-row chat model remains untouched building. No uniqueness changes or recency adoption.

Expanded-source read timeouts discovered during live verification were corrected by semantics-preserving invoker-view optimizations and refreshed planner statistics. Full classification/standing/club-output preservation checks pass; RLS/grants/activation permissions unchanged. Live comparison/rankings/clubs/Longwood roster and phone layouts match SQL; HTTP 200/no-store/noindex checks pass. 139 tests and full CI checks pass. Implementation, immutable migration/version mapping, recovery procedure, hashes, observed failures/fixes, verification limits and rollback are in [RATING_RECOVERY_RELEASE.md on PR #7](https://github.com/rpmanning17/wrestling/blob/fix/canonical-rating-recovery/docs/RATING_RECOVERY_RELEASE.md). Earlier blocked/pending activation statements in this handoff are historical and superseded by this verified result. PR #6 remains experimental/draft and its drift is NOT adopted.
