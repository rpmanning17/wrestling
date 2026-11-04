# Ranking methodology

This document covers **wrestler** ratings. Club identity normalization and club rankings are **not implemented** anywhere in this repository (see `REQUIREMENTS.md` F13/F14); nothing below applies to clubs.

Two systems exist. The legacy heuristic is what production shows today. The Glicko-2 pipeline is implemented and tested but has not been calculated on production data.

## 1. Legacy heuristic (currently in production)

`public.wrestler_ratings` view (migration 004) and `src/lib/scoring.ts`: per (wrestler, age group, 10 lb band) a raw score of win rate x 500 + placement credit (up to 200) + share of wins by fall/tech/major (up to 100) + recency (up to 100, linear over 730 days) + volume (up to 100, saturating at 20 bouts), min-max scaled to 0..1000 within the cohort. Known weaknesses: ignores opponent quality, counts every recorded bout (including forfeits) as a win or loss, and rewards raw win rate on weak schedules.

## 2. Opponent-adjusted model: Glicko-2 baseline

Source: Glickman, "Example of the Glicko-2 system" (glicko.net/glicko/glicko2.pdf). The implementation (`src/lib/rating/glicko2.ts`) follows the published steps (scale 173.7178, g(phi), E, v, delta, Illinois-method volatility iteration with epsilon 1e-6) and is tested against the paper's worked example (1500 / RD 200 / sigma 0.06, tau 0.5 → 1464.06 / 151.52 / 0.05999).

**What it gives.** For each wrestler: *rating* (estimated power rating), *RD* (rating deviation, the uncertainty), *volatility*, and the *conservative ranking score* = rating − k × RD (k = 1 by default, configurable). Wins over strong opponents move a rating more than wins over weak ones, and a loss to a much weaker opponent costs more, so schedule strength is already inside the rating.

**Backtest reference defaults** (`DEFAULT_RATING_CONFIG`; complete resolved config is stored with every model). Production uses the validated overrides in `config/ratings.production.json`: daily periods and decision-win score 0.8, with other contested wins 1. See the activation decision below.

| Setting | Value | Notes |
|---|---|---|
| Initial rating / RD / volatility | 1500 / 350 / 0.06 | Glicko-2 standard start. No arbitrary newcomer cap and no fixed minimum number of matches; a newcomer is simply uncertain |
| System constant tau | 0.5 | Backtest sweeps 0.3, 0.75, 1.0, 1.2 |
| Rating period | 7 days, Monday-anchored | Backtest sweeps 1, 3, 14, 30 |
| Inactivity | RD grows by volatility for each empty period (lazy: sqrt(phi² + n·sigma²), capped at 350) | Uncertainty rises during inactivity; **rating does not drop**. This is the recency policy (`glicko2_inactivity_rd_growth`); there is no separate time-decay |
| k (conservative score) | 1 | A strong newcomer can rank above a weaker established wrestler; k = 2 would hide most newcomers |
| Status | provisional RD ≥ 120, developing 80 to 120, established < 80 | Provisional defaults; calibrate with real data |
| Quality-win threshold | 80th percentile of non-provisional wrestlers' ratings (RD <120; all rated wrestlers if fewer than 20 non-provisional) | Explanatory |
| Trend window | 90 days | Rating change over the window |

**Documented deviations from the paper** (all deliberate): lazy multi-period inactivity inflation; an optional fractional game score, enabled for the validated production decision-0.8 variant; and match prediction uses the combined-RD form g(sqrt(phi_a² + phi_b²)) from Glickman's original Glicko paper (an `opponent_rd` alternative is backtested). Confidence in these choices: moderate to high; the backtest is the arbiter.

### What counts as a match

All contested matches count, from tournaments and duals alike, across ages and weights, in one global pool (the career opponent network). The age group or weight of a bracket is not discounted: both wrestlers in a bout share a bracket, so the context is the same for both, and no discount variant is implemented.

Outcome classification (`src/lib/rating/outcomes.ts`, from `win_type`, falling back to the first token of `result`):

| Class | Examples | Rated? |
|---|---|---|
| decision, major decision, tech fall, fall | DEC, MD, TF, F, FALL, PIN | yes |
| forfeit, medical forfeit, default (injury), disqualification, no contest, bye | FOR, M FOR, MFFL, DEF, DQ, NC, BYE | **no** by default (no contest was wrestled); counted in the exclusion report. `outcomes.contested` can include them; a backtest variant measures that |
| unknown | any unrecognized code | **no**, listed in the report so someone can classify it |
| other exclusions | invalid date, missing/placeholder name, self-match, exact duplicate row | no, counted by reason |

Placements are never turned into wins. Tournament placements do not enter the rating at all; they remain evidence. **Production values (audit 2026-11-03, 31,845 bouts):** F 18,393; DEC 4,666; TF 4,218; MD 2,857 (30,134 contested, 94.6%); FOR 1,341; DEF 150; M FOR 150; DQ 31; MFFL 19; NC 19 (1,710 excluded as non-contested); OTHER1 1 (unknown, a 0-0 bout, excluded). All other codes are recognized, so the classifier is unchanged (`DECISIONS.md` D18). These are row counts before duplicate, placeholder and self-match exclusions. Data-quality gaps the pipeline does not handle: same-opponent candidate groups whose duplication is unproven; these remain rated when contested, as required by D19. Weight labels with a trailing age tag such as `100 (14U)` would lose the bracket weight; the preliminary SQL audit found 139 unparseable labels, while the rating parser reports 177 among rateable rows. These use different parsing rules and are not identical measures.

### Chronology and leakage

Matches are grouped into events (same normalized event name; a new event starts when consecutive match dates are more than 7 days apart). Walk-forward rule: every bout in an event is predicted from a snapshot of ratings taken **before the rating period containing that event's first bout**, so no bout from the same event (including day two of a multi-day event) or later is visible. Ratings are updated only after all predictions for the period are made. Ratings and backtests use this same code (`walk.ts`). Tests assert that changing the outcome of any later bout cannot change an earlier prediction (periods of 1, 7 and 30 days).

### Explanatory metrics (never inputs to the rating)

Opponent-adjusted strength of schedule: average opponent rating and the expected win % of a reference 1500 wrestler against that schedule, both using opponents' **current** ratings (hindsight, therefore explanation only; using them as an input would double-count schedule strength). Also quality wins and losses, pin %, bonus % (tech fall or major), method breakdown, average scoring margins, trend, head-to-head and common opponents (`relations.ts`).

### Dominance and margin (experimental, off)

Alternative method/margin weightings are evaluated as backtest variants. Engine reference defaults have `dominance.enabled = false`; production enables only the validated decision-0.8 variant, with margins off. A variant may be adopted only if its paired-bootstrap 95% interval (resampling whole events) lies entirely below the baseline log loss, the gain is at least 0.002 log loss per match, and calibration error (ECE) does not worsen by more than 0.005. The decision-0.8 production variant passed this rule on 2026-11-03; other variants remain experimental.

## 3. Cohort rankings versus the career network

- **Career network:** one global rating pool using every contested match. A wrestler who moved up in age or weight keeps one rating; prior results contribute with less weight as uncertainty regrows during inactivity.
- **Current cohort ranking:** `wrestler_strength_current` takes each wrestler's latest evidence per (age group, 10 lb band), ranks that cohort by the conservative score, and rescales it to 0..1000 (weakest 0, strongest 1000). The legacy view did the same with its own score, so the display is preserved. **Behaviour change when a model is active:** the number now means "conservative opponent-adjusted score within the cohort" and a wrestler with few bouts ranks lower until results narrow the uncertainty.
- Matchup likelihood ("likely for Nolan") is separate (`scoring.ts`: age fit, weight fit, recent activity, Orlando-area appearances, evidence confidence). It is not strength and is not changed.
- Historical or current-season interaction: old results stay in the rating but carry less certainty through RD growth; evidence of the current age/weight comes from `wrestler_evidence`, which is built mostly from July 2026 onward.

## 4. Backtesting

`pnpm ratings:backtest` (`backtest.ts`, `grid.ts`, `report.ts`) predicts every scorable bout from pre-event ratings and reports accuracy, log loss, Brier score, expected calibration error, calibration by probability bucket, sample and excluded counts, and segments: newcomer vs established (fewer than 5 prior bouts vs 15 or more each), same vs cross weight, same vs cross age (known only when the weight label carries an age group), and returning after more than 180 days. Baselines: coin flip, Elo, smoothed win-rate (log5), and the legacy heuristic (not a probability). Tuning uses the early window; the last ~30% of scorable events (after a 60-day warm-up) is held out for confirmation and never used to choose a setting. Variants swept: period length, tau, initial RD and volatility, the opponent-RD predictor, dominance, and two policy variants (including disqualification/default bouts; alias handling off), which are reported but never auto-adopted. **Real-data backtest completed 2026-11-03**; see `docs/BACKTEST_REPORT.md`. The combined daily-period/decision-0.8 candidate passed tuning and held-out confirmation and is active. Engine defaults stay unchanged so the report reference does not drift; recalculate production with `--config config/ratings.production.json`.

## 5. Versioning

Every calculation writes a new `rating_models` row containing model id/version, full config and its hash, input fingerprint (so an identical re-run is detected), as-of date, match cutoff, rating-period policy, k, recency policy, dominance flag, counts, exclusions, quality threshold and (when stored) backtest metrics. Older models are archived, not deleted. Raw `matches` are never modified. A different config or input creates a new model that can be compared with, or rolled back to, the previous one.

## 6. Known limitations

- Same-name wrestlers are one identity.
- Calendar 2025 has no data (2024-12-30 to 2026-01-04), so returning wrestlers rely on RD growth; its effect is measured in the real-data backtest ("returning after 180+ days" segment).
- Repeated and opposite-result bouts are preserved under D19; matching opponents/event is not proof of duplication. The full 2026-11-03 preparation excluded zero exact duplicate signatures.
- Provisional/developing/established thresholds and k are defaults, not calibrated.
- Opponent-quality metrics use current ratings and can differ from the rating at match time.
- Dual meets and tournaments are weighted the same; there is no evidence yet on whether they should differ.

## 7. Production adoption (2026-11-03)

Model `glicko2-daily-dec08-v1` is active, as of 2026-11-03 through bouts dated 2026-10-31. The tuning window selected daily periods and decision winner score 0.8; the combined candidate then cleared the predefined independent confirmation gate: 8,146 bouts in 26 events, accuracy 66.17%, log loss 0.59524 versus 0.60451, ECE 0.01567 versus 0.02453, paired event-bootstrap difference -0.00927 (95% CI -0.01156 to -0.00727). Decision weighting is now validated for this dataset, not an assertion that the score is a literal probability of ability or that margin information is universally superior. Scoring margins are not enabled. Other defaults, including k and status thresholds, are retained.

All 7,788 rated wrestlers have SOS metrics. Most remain provisional; high RD is exposed rather than hidden. SOS compares a reference 1500 wrestler against opponents' current ratings, so lower schedule-expected win percentage means harder opposition. The quality-win threshold implementation uses the non-provisional (developing plus established) pool, not only established wrestlers. Full operational evidence and rerun instructions are in `RATING_ACTIVATION.md`.


## Current cohort correction (2026-11-04)
The introductory legacy-only statements are historical and superseded by section 7. Current cohorts now use D25's three distinct events, independently voting age and weight, instead of latest evidence per historical cohort. All active-model scores retain conservative Glicko min-max scaling but membership is one current cohort per athlete, so scaled scores can change without changing any rating. Dual evidence has half influence for classification; dual bouts retain full existing rating treatment. Search and comparisons consume the same database view. Waylon Jones's latest recorded events are 80, 80, 75 lb; production SQL after migration shows 12U 80–89 lb, estimate 80, strength 524.34, rank 12/28, rating 1513.787 ±121.764. Reported screenshot values 938.35/838.35 were not reproduced in this production snapshot and are not fixed expectations. No rating recalculation/backtest change was needed.


## Cohort Tier and rating terminology (2026-11-04)
Cohort Tier uses population deciles, not 100-point strength bands. D27 gives the exact tied-midrank formula, threshold and evidence gate. Tier 1 is strongest, Tier 10 weakest. Equal conservative ratings share a tier; cohort rank remains competition rank. Tier is position within the observed population, not absolute ability or match prediction. The existing three-event labels and 0–1,000 min-max strength stay unchanged. Automatic view evaluation updates tiers whenever classification, population or active ratings change. Insufficient classification produces no cohort score; cohorts smaller than 20 retain strength/rank/population without a tier. Tied top classification support withholds tier without changing the existing estimate. A provisional rating can have any tier.

UI vocabulary: Glicko Rating (raw, initial 1,500, no fixed upper limit); Rating Deviation (RD, uncertainty); Conservative Glicko Rating (raw rating minus configured uncertainty adjustment); Cohort Strength (0–1,000 within cohort); Cohort Tier (population decile); Average Opponent Glicko Rating (raw scale); Schedule Difficulty (reference-1,500 expected win percentage, lower is harder); Matchup Likelihood (0–1,000 relevance/fit, not ability). No engine or backtest configuration changed; the existing validated backtest report remains applicable rather than rerunning a model for presentation changes.

## 2026-11-04 — Experimental youth skill drift (branch only; NOT deployed)

The original `glicko2_inactivity_rd_growth` behavior remains the production baseline and is **not a literal match half-life**: old results influence later rating state but no result is deleted or multiplied by an age-dependent weight. The earlier claim that all calendar 2025 data are absent is **superseded** by the 2026-11-04 backfill: 67,736 total input matches, including 35,861 from calendar 2025; the new 11,724-wrestler candidate is still awaiting complete persistence/validation/activation.

A research-only optional `recency.skillDriftRdPerYear` introduces process variance for each rating period in addition to Glicko-2 volatility. If configured to `d` Glicko RD points per square-root year, extra variance in internal Glicko scale per period is `(d / 173.7178)^2 × period.days / 365.25`. This variance is added during played rating periods and during each elapsed empty period (with the ordinary RD cap). The **rating mean stays constant without matches**; new matches can move it more because uncertainty is higher. It is a state-space random-walk adaptation, not an arbitrary cutoff or a direct weight on a match. The exact baseline update path is untouched if `d` is absent or zero. Experimental configurations must set `recency.policy=glicko2_continuous_skill_drift` to distinguish them in model metadata; the validated model retains `glicko2_inactivity_rd_growth`. Glicko-2 itself already adds volatility variance in played and empty periods; the new drift is **extra**, not a replacement. At constant sigma=0.06 and daily periods, ordinary volatility corresponds to approximately 199 RD points of annual random-walk standard deviation before measurement updates; adding d=100 produces about 223 combined (sqrt(199²+100²)), not 299. This illustration is not a fitted half-life. Default `config/ratings.production.json` does NOT contain the field, preserving its original resolved-config hash.

`pnpm ratings:recency-backtest` is a separate, **read-only** experiment using the production daily/decision-0.8 settings as reference. The one-factor candidates are d = 50/100/150/200 RD/√year; it selects on past events, confirms on untouched later events, requires event-bootstrap 95% CI below zero, at least 0.002 improvement in log loss and calibration ECE no worse by >0.005. Passing does not auto-promote the candidate; production configuration changes require a reviewed model version, new full-history recalculation, atomic activation, and live checks. The new report is ungenerated until the experiment runs on the complete 2024–2026 data.

**Important limitation:** two years of results are enough to compare adaptability to changing skill, not to establish an optimal 3–4-year expiration or a universally correct one-year half-life. Evaluate young/developing, long-gap, cross-age and cross-weight segments; do not treat cohort bracket labels as exact ages. Prior match history and opponent-network evidence should remain queryable indefinitely.

Strength-of-schedule remains a **career-history explanatory measure**, calculated with opponents' current ratings. A separate recent-365-day SOS display may be useful, but it is **not yet implemented or verified**; do not silently replace lifetime SOS or mutate schema/views to make the model appear more recent.
