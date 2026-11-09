
# Status

## 2026-11-09 — complete Rankings reliability gate passed before recalculation

Commit `a30db1a` is production READY as `dpl_4u9w8kBB943ynZMrzpXk9hnJGbfi`; GitHub CI passed lint/typecheck/189 tests/build. Ten fresh protected browser reloads returned the likely list with numeric strength/rank/tier values for its rated wrestlers. The expanded strongest list also rendered; newly imported unrated rows correctly remain unavailable in the old model. Matching 21:13 UTC logs contain ten classification RPCs (186–1,264 ms) and ten standing RPCs (219–759 ms), all HTTP 200. Deployment warning/error/fatal logs for these requests are empty. Nine warm full page checks took 1.29–1.73 seconds; the first cold check took 6.73 seconds. No query timeout or security limit was increased. This is a bounded observed reliability gate, not a promise against every future failure.

Source/assignment/people/alias fingerprints still match the complete private export. Rating calculation and activation now proceed as the next separate gate; no candidate or active model changed during reliability work.

## 2026-11-09 — transactional appearance indexes; standings read follow-up

The first scoped release (`703e5fc`, production `dpl_C4ijbew5fQKjJDNfTPDKdmssyznD`) still had intermittent candidate timeouts. An indexed private per-source-side projection is now atomically maintained by a protected source trigger: 137,566 rows for 68,783 bouts. No source/assignment/rating row changed. Real anon plans now show age/athlete Index Cond lookups. Ten fresh protected production reloads rendered the page; the first five candidate HTTP requests took 605/1102/774/780/340 ms, all 200. **Standing reliability is not yet passed:** a later successful page rendered unavailable strength values after its separate full standing read timed out.

Applied follow-ups: projection `20261109210141`, driven name indexes `20261109210512`, scoped shared standings `20261109210826`, driven person indexes `20261109210917`. Full name cohort/standing/person cohort hashes remain unchanged. Person scoped cohort trial: 343 rows in ~335 ms. Security advisor has no new warnings/errors. New regression coverage verifies source insert/update/delete/rollback synchronization, denied projection writes and complete age-population standings. Page code now scopes standing reads, reuses person classifications and skips unused legacy heuristic queries; this follow-up page deployment remains pending at this checkpoint. Active ratings are still the older model.

## 2026-11-09 — age-scoped rankings reads (applied; page deployment pending)

Fresh protected production loads reproduced the ranking failure after the 32MB role change (two failures among five reloads). Configuration reload removed further measured temp writes but did not establish reliability. Rankings now calls an invoker function with an explicit age argument. It first selects athletes with any supporting age value, keeps their complete evidence histories, and applies the unchanged three-event classifier. The full views use the same functions with NULL. Person inputs additionally parse distinct weight/event labels once and collapse identical classification tuples; raw bouts and assignments are untouched.

Applied migrations: age population **20261109204355**, inline trial **20261109204548**, person input bounds **20261109204714**, followed by fixed-search-path parameter planning (version recorded in the continuation). The final invoker functions use a static parameterized EXECUTE query to plan the actual argument while retaining a fixed empty search_path; no definer rights or public execution grants. Name/person scoped read-only trials returned the same 92/59 filtered candidates in ~0.78/0.84 seconds; final fixed-path name trial ~1.03 seconds. These are administrator measurements, not live app reliability evidence.

All 12,043 name cohorts, 1,132 current standings and 11,750 person cohorts retain their complete-row hashes. Migration transactions abort on differing outputs. Regression fixtures compare full outputs and all supported age subsets, preserving mixed-age histories and denied anonymous reads. Local lint/typecheck/188 tests/build pass before deployment; final verification remains pending. Ratings still use the older active model. No new candidate calculated yet.


## 2026-11-09 — Follow-up Rankings memory tuning (production applied; live reliability not yet proven)

After the November 9 cohort-view optimization, a diagnostic admin-role EXPLAIN observed 4.97 seconds for the full 12,043-row cohort view, with substantial temp-file spill. Five controlled later trials on the same 68,783-match production source found 4 MB ~2.04s (temp spill), 16 MB ~1.87–1.91s (no temp spill), and 32 MB ~1.67–1.68s (no temp spill). These are query-plan tests, not measurements of the authenticated app page or guarantees of stability.

**Applied production migration `20261109202737`** (`rankings_anon_work_mem`), source `20261109210000_rankings_anon_work_mem.sql`: `ALTER ROLE anon SET work_mem = '32MB'`. PostgREST applies impersonated role settings to request transactions. Verified `anon` still has `statement_timeout=3s` and now `work_mem=32MB`; authorization/RLS, views, source matches, active rating model and app code were not changed. Security advisor still reports only eight previously known RLS-no-policy informational notices on deliberately denied private ledgers. Per-operation memory and concurrent query use should be monitored; rollback through a **new** migration `ALTER ROLE anon RESET work_mem` if necessary.

**Still pending:** repeated actual protected production Rankings loads, error log review, rating candidate calculation from verified 221-page export and independent validation followed by separately authorized activation. Do not report this as complete or promote the stale candidate.


## 2026-11-09 — verified bounded export; rankings timeout remains open

Continued from deployed main `b571038` / PR #17, with no open PRs found. Reverified 68,783 matches, 1,047 USA Bracketing bouts across 13 events, 648 imported placements (878 preserved privately), 1,926/2,094 assigned bout sides and 491/648 assigned placement appearances. Uncertain identities remain held.

Completed a private **ratings-input export**, not a calculated ratings payload: 221 pages of at most 1,000 rows, containing 68,783 matches, 138,661 current source assignments, 11,750 people and one wrestler alias. Full-row ordered fingerprints match an atomic four-table SQL baseline; a fresh production manifest is identical. Files are in ignored `exports/usa-20261109/`; `scripts/ratings/verify-snapshot.ts` validates completeness and rejects changed, reordered, extra or missing pages. No new model was calculated, persisted or activated. The active model is still `a29c4460-5e56-4d22-902d-ea39c65bfcac`; the old person candidate remains stale and must not be activated.

Reproduced the live Rankings server error and correlated Vercel digest `4274830494` with a database statement timeout. A semantics-preserving earlier duplicate collapse was applied as production migration **20261109184313**, source **20261109183704_bound_cohort_input_duplicates.sql**. All 12,043 cohort rows and 1,132 standing rows retain identical full-row checksums. Active 11,724 ratings and 34,809 history rows retain their checksums. Planner statistics were refreshed after confirming the post-import statistics gap. **This improves the query but does not resolve the intermittent failure:** two post-change browser loads succeeded and one still timed out. Measured administrator query time remains about 2.1–2.3 seconds against the app role's unchanged three-second limit. No cache, privileged read function, timeout increase, formula change or access expansion was introduced.

Lint, typecheck, **187 tests** and production build pass using the installed pnpm entry point with dependency auto-install disabled; build used dummy values. Live comparison, freshness warning and expanded ranking output were observed; this is not a claim of complete production stability. Detailed verification, private checkpoint recovery and outstanding release gates: [USA_IMPORT_CONTINUATION_20261109.md](USA_IMPORT_CONTINUATION_20261109.md).

**Next:** finish the rankings read optimization under actual app-role execution, then calculate and independently validate a fresh person-based candidate from the verified snapshot. Recheck live source/assignment fingerprints before any separately authorized activation. Preserve the old active model and uncertain identities.

## 2026-11-09 — USA Bracketing production import and evidence-backed identities

**Production data verified, rating refresh and UI deployment still pending this PR:** 68,783 source matches, including 1,047 newly imported contested USA Bracketing youth bouts from 13 events. Each has a preserved private source-evidence record. The 878 youth placement records were preserved privately; 648 were added as separate placement observations. Of 2,094 new match-side identity appearances, 1,926 are assigned using reviewed, reversible decisions and 168 are held; 230 new people were created rather than guessing unrelated matches. Of the 648 placement appearances, 491 are linked to an unambiguous assigned wrestler within the exact published bracket and 157 are held. Additional unknown-gender placements remain private; no placement created a bout. The November 7 Luke Palazzo–Nolan Manning published result retains its exact source UUID and a distinct owner-only note preserves the unrecorded Nathan Jorge exhibition without inventing a result.

The *active* model remains name-key **a29c4460-5e56-4d22-902d-ea39c65bfcac**, covering 67,736 matches. The older 67,736-match person-keyed candidate is stale and **must not be activated**. A new source-frozen person-keyed run is required, including supervised validation and release. The committed source files in this PR include the additive provenance schema, guarded import functions, one-time reviewed identity release SQL and UI age-group display. The UI reads explicit age labels from source brackets or uniquely corroborated matching-event evidence; it displays unknown age instead of guessing. A failed complex strength-view lookup falls back to the independent cohort classifier, never to unvalidated rankings.

The earlier source snapshots and migration-time counts in the sections below are historical. Rating freshness remains pending until a new model has been calculated against the 68,783-row source and activated. No claim that old person-keyed ratings include the new rows.


## 2026-11-05 — person identity implementation in review

Draft PR #16 on branch `codex/person-identity` is stacked on club-alias catch-up PR #15 and includes the read-only audit from PR #14. The three additive person migrations were applied to production as `20261105181340`, `20261105181342` and `20261105181343`. The reviewed people, decisions and source assignments are imported. A person-keyed rating model `cd6d932e-289d-42e2-a79c-a699d1dedcfa` was stored, independently checked and promoted to **candidate**, not active. **The active production model remains `a29c4460-5e56-4d22-902d-ea39c65bfcac` with `name_key` identity. The new app code has not been deployed to production.** Existing source names and model results remain intact. App read-path changes take effect only after separately authorized activation of the candidate.

The private snapshot still matches production's full 67,736-row source MD5 `62b66f3179fc648dfac09c4be09a15a6`; production has 417 club aliases. Rechecked 257 spelling and 12 nickname agent links against those aliases and whole-group contradictions; all 269 pass. The 31 owner-confirmed merges and two-person Aaron Jones split stay separately attributed; the Bermudez triad remains distinct on source evidence. Production has 11,520 people, 280 decisions and 135,919 current match-side/entry/observation assignments: 135,903 assigned, 16 held. The live assignment fingerprint equals the private candidate's `ff82dbd128e97a77880fab2477dc9fe8d38120ac3c392dfa08e56ad09223a0b1`. The candidate preserves 64,050 rated bouts (3,679 administrative, six unknown methods, one unresolved self-result), rates 11,430 people, and has 34,776 history points. All rating and history rows were replayed against the private export through exact guarded equality checks. Counts, wins/losses, person keys, source checksum and assignment fingerprint passed the locked promotion gate. Independent offline record and schedule audits have zero mismatches; repeated pairings remain present. Production person views return 11,520 cohort evidence rows, 17,089 all-season club roster rows and 1,672 all-season club ranking rows; these are structural checks before activation, not app-page verification. Local lint, typecheck, 178 tests and build pass. See [IDENTITY_OPERATIONS.md](IDENTITY_OPERATIONS.md).

## 2026-11-05 — finite club alias catch-up

The live club rankings exposed labels missed by the 2026-11-04 finite alias manifest, including multiple Scorpions and Kongkrete entries. A new 27-alias catch-up migration groups those reviewed organization, team and program labels, plus River Springs, South Broward High School and Well Trained variants. **Applied to production as `20261105150602`**; aliases 390 → 417, all-season club rows 1,696 → 1,672, source matches stayed 67,736. Live database ranking views now return one Scorpions and one Kongkrete row and no raw rows for the selected label families. No app code deployment or rating recalculation was needed. The SQL and guarded rollback preserve original team labels; local fixture tests verify consolidation, source preservation, private rollback ledger and rollback refusal after a later alias edit. Lint, typecheck, 155 tests and production build pass. An authenticated browser check of the page remains unverified. See [CLUB_NORMALIZATION.md](CLUB_NORMALIZATION.md).

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
