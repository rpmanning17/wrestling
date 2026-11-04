# Status

Last verified: 2026-11-03 against GitHub main, production Supabase and the live Vercel application.

## Live in production

- Application code at `003bf0f` includes opponent-adjusted ratings, Florida club analytics and athlete autocomplete. Earlier notes saying these changes were unmerged/undeployed are superseded. No open PRs were found at the start of activation.
- **Active model:** `d64fd4ba-de14-4d07-bac8-2961e12d506d`, version `glicko2-daily-dec08-v1`, as of 2026-11-03, bouts through 2026-10-31.
- **Configuration:** `config/ratings.production.json`: daily periods, decision winner score 0.8 (loser 0.2), other contested wins 1, tau 0.5, initial RD 350, volatility 0.06, conservative k=1. Binary seven-day defaults remain the backtest reference; production calculations must explicitly use the production config.
- **Results:** 31,845 input rows; 30,133 contested bouts rated; 7,788 wrestler ratings and SOS metrics; 16,951 history points; 770 cohort rows. Excluded: 1,710 administrative outcomes, one contested self-match and one unknown OTHER1. Exact duplicate filter excluded zero rows.
- **Validation:** real-data chronological tuning and confirmation passed the predefined adoption rule. Held-out 8,146 bouts / 26 events: candidate accuracy 66.17%, log loss 0.59524, Brier 0.20634, ECE 0.01567. Baseline Glicko-2 accuracy 65.37%, log loss 0.60451. Event-bootstrap log-loss difference -0.00927, 95% CI [-0.01156, -0.00727]. See `BACKTEST_REPORT.md` and `RATING_ACTIVATION.md`.
- Stored through the connected Supabase administrator SQL tool; activation used the existing restricted `private.activate_rating_model` in a transaction. No credentials were extracted, permissions changed, migrations applied, or raw records changed.
- Live comparison verified: Waylon Jones shows 1514 ±122, conservative 1392, average opponent 1588, schedule expectation 41%, model version and date. Database values match. Live rankings show the new cohort scores; club pages show strength and SOS values. `no-store` and `noindex` response headers remain present.

## Verification

`pnpm lint`, `pnpm typecheck`, `pnpm test` (101 passing), and `pnpm build` all passed on the deployed source. Build used dummy environment values, not production secrets. Stored rows satisfy counts, record balance and conservative-score checks; all wrestler SOS values are populated. Raw match count and outcome checksum were identical before and after activation.

## Data and modeling limitations

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
