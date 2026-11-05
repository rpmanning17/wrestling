# Status

## 2026-11-05 — read-only full-history identity audit

Implemented the offline identity-audit command and private source-evidence/review queue, independently of pending importer PR #13. Scanned all 67,736 matches, 125 entries and 322 observations; 11,816 normalized name keys are not assumed to be distinct people. Automatically filtered 122 already-handled casing/outer-space variants and 30 administrative self-results. Found 610 review candidates (one contested self-match, one same-name context conflict, 608 nearby-name pairs); these are not confirmed errors. The first private 25-case report preserves all affected original records. Evidence-hash decisions suppress reviewed cases until relevant evidence changes. Source checksum stayed unchanged; no production correction, schema change or rating activation occurred. Permanent person IDs and reversible merge/split migration remain planned. See IDENTITY_AUDIT.md. Local lint/typecheck, 164 tests and production build pass.

## Current operational snapshot — 2026-11-04

**Live Mat Notes:** https://wrestling-plum.vercel.app. **Active canonical Glicko-2:** `a29c4460-5e56-4d22-902d-ea39c65bfcac` — 67,736 source bouts (including calendar 2025), 64,050 rated bouts, 11,724 wrestlers, and 34,809 history points. Original daily/decision-0.8 formula unchanged. Previous full model archived for rollback; incomplete 500-row run remains untouched. See [RATING_RECOVERY_RELEASE.md](RATING_RECOVERY_RELEASE.md).

**Repository:** Rating recovery/activation safeguards from PR #9 and normalized-CSV staging, count-divergence freshness warning and read-only migration audit from PRs #10–11 are merged and deployed. Latest recorded PR #10 checks: **154 tests, lint, typecheck, build passed**; Vercel reported production READY. No raw Flo-to-normalized converter, automatic rating recalculation or authenticated-browser verification of the warning has been claimed. An unchanged raw-match count does **not** prove identical rating inputs.

**Next work:** Obtain/review the original Flo/Trackwrestling import converter, then exercise one supervised end-to-end import and recalculation. Keep activation guarded and manual. Reconcile the 20 local/production migration version differences only after verifying applied SQL; **do not run blind `supabase db push`**. Review [RATING_OPERATIONS.md](RATING_OPERATIONS.md), [MATCH_IMPORT_READINESS.md](MATCH_IMPORT_READINESS.md), and [MIGRATION_HISTORY_AUDIT.md](MIGRATION_HISTORY_AUDIT.md).

All entries below are historical implementation and verification records, not instructions to restore an earlier model.

---


## Independent infrastructure review — 2026-11-04

Read-only production verification reconfirmed the canonical active UUID, 67,736 source rows / 35,861 calendar-2025 rows / 199 files, 11,724 ratings / 34,809 history / 64,050 wins and losses, unchanged source hashes, zero audited invalid active rows, both unique indexes and denied client activation permissions. No production records or schema changed.

Review fixes disable the destructive/non-atomic legacy CLI writer, require core configuration/provenance on guarded batches, and cover all calculation fields in a v2 fingerprint for future runs. The existing private exporter now accepts the unchanged production config for future imports and requires a frozen snapshot. Current procedure and remaining importer/freshness/manual-validation limitations: [RATING_OPERATIONS.md](RATING_OPERATIONS.md). PR #6 is closed as evaluated/not adopted after research preservation merged to main in PR #8 (full CI passed), without experimental runtime; see [RECENCY_RESEARCH.md](RECENCY_RESEARCH.md).

Local verification: 141 tests, lint and typecheck pass using locked dependencies and equivalent direct script entrypoints; local production build attempted but Windows denied the native SWC download/rename. Final build verification is tracked in the review PR CI. No model recalculated against production or activated.

## Current verified production — 2026-11-04 expanded canonical recovery

**This supersedes older live-state and missing-2025 statements below.** Active model `a29c4460-5e56-4d22-902d-ea39c65bfcac` uses the unchanged production formula under a truthful canonical-implementation version. Source **67,736**; rated bouts **64,050**; ratings **11,724**; history **34,809**; wins/losses **64,050 each**. Exact serialized-output equality and independent complete SOS/record audits pass. Old active `d64fd4ba-de14-4d07-bac8-2961e12d506d` is archived intact for rollback; failed `a957ed42-8ee2-4792-944d-5f63a0b4ce72` remains untouched building (500 ratings / no history). Source fingerprints and both uniqueness constraints are preserved; no experimental drift.

Live comparison/rankings/clubs/Longwood roster and phone layouts verified. Expanded-source cohort/club timeouts were fixed with semantics-preserving invoker-view migrations (production **20261104201755**, **20261104202335**) and refreshed planner statistics; full cohort/standing/club-output preservation checks pass. No timeout/RLS/grant weakening. **139 tests**, lint/typecheck and CI production build pass; HTTP 200/no-store/noindex checks pass; post-fix production error/fatal scan is clear in its recorded window. Full provenance, counts, read-fix evidence, interrupted-write procedure, limitations and rollback: [RATING_RECOVERY_RELEASE.md](RATING_RECOVERY_RELEASE.md). Read-only audit: `supabase/audits/rating_recovery_validation.sql`.

Earlier entries below retain historical release evidence.

## 2026-11-04 — reviewed club normalization

Production migration **20261104161409** (source `20261104161040_approved_club_normalization.sql`) is applied. Clubs: **1,182 → 952**; aliases: 13 → 390 (377 insertions); memberships: 11,007 → 9,943; raw in-house contested matches: 2,009 → 2,076. The finite reconstruction differs from the unavailable earlier SQL's subsidiary projections (375 insertions / 1,066 memberships consolidated); actual values are 377 / 1,064. See [CLUB_NORMALIZATION.md](CLUB_NORMALIZATION.md) for provenance and rollback.

All raw/evidence/history/model/cohort full-row checksums are unchanged. Independent audit: 2,248 club/season summaries, zero record/roster/SOS mismatches. Unauthorized reads return zero. Advisor: one informational no-policy notice for the deliberately denied private ledger, no warnings/errors. Live list, Camden/Longwood rosters, club comparison, rankings and phone layouts verified. Waylon stays 524.34 / #12 of 28 / Tier 5. Source publication/deployment verification is recorded in the final release report; aliases are already live through ordinary views.

Validation: **132 tests passed**, plus lint, typecheck and optimized production build. Build used dummy environment values. Latest production error/fatal log scan (20-minute window covering migration and browser checks) returned no matching entries. No monitoring/drain configuration was changed.

**Source release verified:** `f69a001` on main deployed **READY** as `dpl_A8wiqdPLKitNtnnZbCg4HyWtb7jr`, assigned to the existing wrestling-plum.vercel.app domain. Fresh post-deployment mobile comparison agrees with production SQL: Camden 122 / 1,126 / 45%, Longwood 76 / 1,072 / 43%, without page-width overflow. Migration, finite manifest, rollback, regression tests and audit SQL are committed. No application formula or source match was rewritten. Documentation-only follow-ups do not change this runtime implementation.


Last verified: 2026-11-03 against GitHub main, production Supabase and the live Vercel application.

## Historical production snapshot — 2026-11-03

- Application code at `003bf0f` includes opponent-adjusted ratings, Florida club analytics and athlete autocomplete. Earlier notes saying these changes were unmerged/undeployed are superseded. No open PRs were found at the start of activation.
- **Active model:** `d64fd4ba-de14-4d07-bac8-2961e12d506d`, version `glicko2-daily-dec08-v1`, as of 2026-11-03, bouts through 2026-10-31.
- **Configuration:** `config/ratings.production.json`: daily periods, decision winner score 0.8 (loser 0.2), other contested wins 1, tau 0.5, initial RD 350, volatility 0.06, conservative k=1. Binary seven-day defaults remain the backtest reference; production calculations must explicitly use the production config.
- **Results:** 31,845 input rows; 30,133 contested bouts rated; 7,788 wrestler ratings and SOS metrics; 16,951 history points; 770 cohort rows. Excluded: 1,710 administrative outcomes, one contested self-match and one unknown OTHER1. Exact duplicate filter excluded zero rows.
- **Validation:** real-data chronological tuning and confirmation passed the predefined adoption rule. Held-out 8,146 bouts / 26 events: candidate accuracy 66.17%, log loss 0.59524, Brier 0.20634, ECE 0.01567. Baseline Glicko-2 accuracy 65.37%, log loss 0.60451. Event-bootstrap log-loss difference -0.00927, 95% CI [-0.01156, -0.00727]. See `BACKTEST_REPORT.md` and `RATING_ACTIVATION.md`.
- Stored through the connected Supabase administrator SQL tool; activation used the existing restricted `private.activate_rating_model` in a transaction. No credentials were extracted, permissions changed, migrations applied, or raw records changed.
- Live comparison verified: Waylon Jones shows 1514 ±122, conservative 1392, average opponent 1588, schedule expectation 41%, model version and date. Database values match. Live rankings show the new cohort scores; club pages show strength and SOS values. `no-store` and `noindex` response headers remain present.

## Verification

`pnpm lint`, `pnpm typecheck`, `pnpm test` (101 passing), and `pnpm build` all passed on the deployed source. Build used dummy environment values, not production secrets. Stored rows satisfy counts, record balance and conservative-score checks; all wrestler SOS values are populated. Raw match count and outcome checksum were identical before and after activation.

## Historical limitations — 2026-11-03 (current coverage above)

- Calendar 2025 is absent: no bouts between 2024-12-30 and 2026-01-04. Long gaps and sparse data produce high uncertainty: 7,665 provisional, 121 developing, two established. Thresholds remain RD 120/80; these are display policies, not a minimum-match eligibility gate.
- 310 same-opponent/date/event/bracket/round groups (319 extra records), including 57 opposite-result groups, are **not proven duplicates**. Source-row examples have distinct scores/methods and may be genuine rematches. All are preserved under D19; no pair-based filtering was added.
- Same-name wrestlers remain one identity; uncertain identities are never automatically merged. One reviewed spelling alias exists.
- SOS uses opponents' current ratings for explanation, never as another input to rating. Quality threshold uses the non-provisional pool (RD <120): 123 wrestlers, threshold 1739.97.
- Age-context backtest coverage is sparse (72 held-out bouts with known context); no claims of reliable age-specific calibration. A global disconnected opponent network is not evidence that different age/weight cohorts are directly comparable.
- Two 2026–27 season spellings remain in raw data. Rating math ignores season labels; club analytics normalize them.
- Source weight labels are imperfect; 177 rated rows have no bracket weight under the rating parser. No bodyweight or birthdate is inferred from them.

## Database and deployment notes

Migrations 009 and 010 are applied (production versions `20261103174437` and `20261103223232`). Repo migration filenames differ from production history; do not run `supabase db push` without reconciliation. The earlier Vercel Git connection blocker is historical: the production application now serves the merged features. No project was recreated.

## Remaining work

- Add new result imports and explicitly recalculate with the production config; no automatic refresh job is installed.
- Reconcile duplicate candidates only when source evidence proves duplication, with reversible derived handling and tests. Never delete raw matches.
- Continue reviewed club aliases; keep Spartan RTC separate from LHP until verified. Causal club development analysis and age/weight-specific club strength remain future work.
- Reconcile migration history in a dedicated change before adopting CLI migration pushes.


## 2026-11-04 — three-event cohort inference (feature branch)
A shared pure function now infers age-division and bracket-weight labels from the three latest distinct events (50/30/20) and is used in comparison profile construction. Tests cover multiple bouts per event, source priority and age/weight independence. **Not yet integrated into database-backed rankings and search suggestions**; cohort ranking view still uses its own evidence-selection logic. This feature must not be called fully deployed until that consistency work and live verification are complete.


## 2026-11-04 — database cohort consistency release
Supersedes the earlier incomplete feature-branch note. Central SQL classification and UI integration implemented. All three new migrations applied to project tprodwivvwvpmpzaedom through the administrator connector, preserving security-invoker/RLS; post-migration security advisor clean. Production SQL returns Waylon Jones once: 12U, 80 lb estimate, 80–89 lb, 524.34 strength, rank 12/28, Glicko 1513.787 ±121.764. Historical screenshot scores were not reproduced. Matches: 31,845, checksum c22688e443c1fa819054ea6b32e7825d; ratings: 7,788, checksum 0517746d1b3d70a54beabd10cefd9ec0, identical before/after. Tests cover repeated evidence, latest-three cutoff, independent age/weight, missing fields, source priority, verified weigh-ins, duals, multi-day events, conflicting labels and Waylon. 109 tests passed; lint/typecheck/build use the locked dependencies and dummy build-only environment values. UI release and live-browser verification pending at this commit. Existing performance advisors list eight unused indexes (informational); none removed.

Production code release `4dbf33f` is READY on the existing project/domain. Live browser verified autocomplete and comparison agree on Waylon's 12U / 80 lb estimate, strength 524.34, Glicko 1514 ±122, rank 12/28 in 80–89 lb; switching comparison sort or removing other athletes leaves strength unchanged. Current likelihood is 838.34 (time-dependent). A controlled regression at 2026-11-04 13:00 UTC reproduces 838.35 at 80 lb and 938.35 at 75 lb: the 100-point gap comes from likelihood's weight-fit term, not Glicko. The original image provenance remains unavailable. There are 729 ranking rows for 729 athletes, zero weight bucket mismatches; unauthenticated database reads return zero. Live privacy headers remain present.

Live rankings exposed an additional timeout from parallel duplicated full cohort reads. Follow-up code shares one candidate/classification snapshot between both lists and passes that snapshot into one profile build. 110 tests now pass, including the exact fixed-time screenshot-number regression; lint/typecheck/build rerun. This follow-up's production ranking-page verification is pending at this commit. Production migration versions are `20261104140707`, `20261104140907`, `20261104141046` (in source file order). No new log drain is configured; error scan found the ranking timeout, which is retained as observed history rather than called clean.

**Final UI verification:** follow-up `e644599` deployed READY as `dpl_H1biepW5JU9v75k51MzryHKBx75C` on the existing wrestling project. The live rankings page loaded successfully; Waylon is third in the likely list at 12U / 80 lb / likelihood 838.34 and excluded from the 70–79 lb strongest list. Expanded strongest list contains 27 athletes, from Kolton Smith (1000) through Jackson McDaniel (0), with Gabriel Abbasi ninth (664.54), matching his comparison card. Browser screenshots were captured for the card and both ranking lists. This supersedes the pending-verification statements above; the earlier deployment timeout remains an observed issue fixed by the shared-read follow-up.


## 2026-11-04 — Cohort Tiers and rating clarity
Implemented population tiers in the authoritative strength view, with tied-midrank assignment, minimum 20 and tied classification support exclusion. Added shared 10→1 indicator, coherent strength/rating terminology and schedule explanation across comparisons, rankings and existing club rosters. No club browsing features added; autocomplete continues to show classification rather than strength. 122 tests pass (all prior 110 plus tier populations 20/23/1003, ties, small cohorts, ambiguous support, cohort moves, orientation and shared presentation). Lint/typecheck/production build passed with dummy local environment values. Migration applied via connected administrator tool; security advisor clean and unauthorized reads return zero.

Production SQL: Waylon stays 12U, 80–89 lb, strength 524.34, rank 12/28, Glicko 1513.787 ±121.764, now Tier 5. All 729 existing cohort rows retain checksum 74676aea8ca71bfed2b6d48e5ef18f3e over identity/cohort/strength/rank/population. 534 have tiers, none below 20 members; 64 have tied classification support. Raw match and rating checksums remain c22688e443c1fa819054ea6b32e7825d and 0517746d1b3d70a54beabd10cefd9ec0. UI deployment/mobile verification pending at this commit. No model recalculation or likelihood/inference formula changes.


### Tier production checks and query follow-up
UI release `2659e0a` deployed READY on the existing Vercel project. At phone width, Waylon's comparison card and likely-ranking entry agree: Cohort Strength 524.34, 12U 80–89 lb, #12/28, Tier 5; Glicko 1514, RD 122, conservative 1392, Schedule Difficulty 41%, Average Opponent Glicko Rating 1588. Tier 2 selected the second segment from the right (index 8 in 10→1 order); tier has accessible equivalent text. Page scroll width equals client width. Expanded rankings show ambiguous-evidence unavailable messages without hiding rank or strength.

Existing Longwood roster verified the same Waylon standing and separate provisional status. Sadie Shannon shows the tied-support unavailable reason while retaining strength/rank. Club summaries show raw conservative Glicko values and reference-1500 Schedule Difficulty, not capped scores. Initial club list/detail checks exposed timeout plans; immutable migrations `20261104145000_bound_club_schedule_read.sql` and `20261104145400_bound_filtered_club_schedule.sql` materialize shared joins and use the application's double-precision expectation formula. Measured filtered club query improved from 3.9 s to 1.4 s; live list and roster reloads succeeded. Production versions: 20261104144056 (tiers), 20261104144756 and 20261104144956 (query follow-ups).

A repeated comparison request exposed duplicate simultaneous classification reads. The follow-up reuses classification returned by the authoritative strength row, queries missing/unrated classifications separately, and reports standing read errors explicitly instead of mislabeling them unavailable. Final follow-up production verification is pending at this commit. 124 tests pass, including added age-cohort moves and filtered/all-club schedule consistency. Lint, typecheck and production build passed again. Existing validated formulas and raw/model data remain unchanged.

**Final tier verification:** runtime follow-up `e505526` deployed READY as `dpl_J5mgiQq7biAkwGavKZio5rTv1vr7` on the existing domain. Repeated comparison reads and sort toggles preserve Waylon's 524.34 / #12 of 28 / Tier 5. Aaron Matos shows strength 426.78, #5 of 9, and the minimum-20 unavailable explanation. Longwood's existing roster agrees with Waylon's comparison/ranking; ambiguous evidence retains rank and strength without tier. Live rankings, club list/search and roster loaded after the query fixes. Mobile 10→1 order, Tier-2 second-from-right selection, accessible text and no page-width overflow verified. Latest error/fatal deployment log scan returned no matching entries; Supabase security advisor remains clean. All 729 pre-existing ranking fields still have checksum 74676aea8ca71bfed2b6d48e5ef18f3e; raw/model checksums also remain identical. This supersedes pending UI verification above. No log drain was added and imported-population/same-name limitations remain.



## 2026-11-04 — canonical recovery implementation
Owner-approved provenance-only version implemented from main, separately from experimental drift. Shared persisted-field serialization, exact production-output checks and guarded idempotent connector batches have 137 passing tests plus lint/typecheck/build. Production execution is pending; no activation claimed. See [RATING_RECOVERY_RELEASE.md](RATING_RECOVERY_RELEASE.md).


## 2026-11-04 — source freshness and normalized import preparation (PR #10 deployed READY)

After PR #9 merged, the current active rating model remains the expanded 2024–2026 canonical Glicko model (11,724 ratings; 67,736 source matches). A new branch `feature/import-readiness-and-rating-freshness` adds a count-based stale-ratings warning rendered server-side. The live model's `matches_total` is compared against the exact current source table count; mismatches warn that recalculation is needed. Equal counts are intentionally silent, **not proof of equality** when existing outcomes or aliases change. Merged in PR #10; CI passed 154/154 tests, lint/typecheck/build; Vercel production deployment dpl_8MQ5q9r1vRywudTm6esyyamRXoKc is READY. Post-deploy error/fatal log query returned no entries, but authenticated browser verification of banner presentation is still pending.

The branch also adds an offline normalized Mat Notes CSV validator and guarded SQL staging CLI. Actual normalized 2025 CSV columns were inspected; raw Flo/Trackwrestling-to-normalized translation remains external. Validation preserves source pairs and genuine rematches, rejects conflicting pairs/unknown methods, and emits no automatic database writes. Generated SQL is for reviewed administrator execution only. See `MATCH_IMPORT_READINESS.md`.

Read-only production migration inventory confirms 23 applied records against 23 source migration files; **20 version strings differ** (one also has a differing name prefix). Full mapping in `MIGRATION_HISTORY_AUDIT.md`. No production schema, migration history, permissions, source records or rating rows have been changed. The migration versions remain *unreconciled* pending applied-SQL equivalence review.
