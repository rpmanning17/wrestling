# Ranking methodology

This document covers **wrestler** ratings. Club identity normalization and club rankings are **not implemented** anywhere in this repository (see `REQUIREMENTS.md` F13/F14); nothing below applies to clubs.

Two systems exist. The legacy heuristic is what production shows today. The Glicko-2 pipeline is implemented and tested but has not been calculated on production data.

## 1. Legacy heuristic (currently in production)

`public.wrestler_ratings` view (migration 004) and `src/lib/scoring.ts`: per (wrestler, age group, 10 lb band) a raw score of win rate x 500 + placement credit (up to 200) + share of wins by fall/tech/major (up to 100) + recency (up to 100, linear over 730 days) + volume (up to 100, saturating at 20 bouts), min-max scaled to 0..1000 within the cohort. Known weaknesses: ignores opponent quality, counts every recorded bout (including forfeits) as a win or loss, and rewards raw win rate on weak schedules.

## 2. Opponent-adjusted model: Glicko-2 baseline

Source: Glickman, "Example of the Glicko-2 system" (glicko.net/glicko/glicko2.pdf). The implementation (`src/lib/rating/glicko2.ts`) follows the published steps (scale 173.7178, g(phi), E, v, delta, Illinois-method volatility iteration with epsilon 1e-6) and is tested against the paper's worked example (1500 / RD 200 / sigma 0.06, tau 0.5 → 1464.06 / 151.52 / 0.05999).

**What it gives.** For each wrestler: *rating* (estimated power rating), *RD* (rating deviation, the uncertainty), *volatility*, and the *conservative ranking score* = rating − k × RD (k = 1 by default, configurable). Wins over strong opponents move a rating more than wins over weak ones, and a loss to a much weaker opponent costs more, so schedule strength is already inside the rating.

**Defaults** (`DEFAULT_RATING_CONFIG`, stored with every model):

| Setting | Value | Notes |
|---|---|---|
| Initial rating / RD / volatility | 1500 / 350 / 0.06 | Glicko-2 standard start. No arbitrary newcomer cap and no fixed minimum number of matches; a newcomer is simply uncertain |
| System constant tau | 0.5 | Backtest sweeps 0.3, 0.75, 1.0, 1.2 |
| Rating period | 7 days, Monday-anchored | Backtest sweeps 1, 3, 14, 30 |
| Inactivity | RD grows by volatility for each empty period (lazy: sqrt(phi² + n·sigma²), capped at 350) | Uncertainty rises during inactivity; **rating does not drop**. This is the recency policy (`glicko2_inactivity_rd_growth`); there is no separate time-decay |
| k (conservative score) | 1 | A strong newcomer can rank above a weaker established wrestler; k = 2 would hide most newcomers |
| Status | provisional RD ≥ 120, developing 80 to 120, established < 80 | Provisional defaults; calibrate with real data |
| Quality-win threshold | 80th percentile of established wrestlers' ratings (all rated wrestlers if fewer than 20 established) | Explanatory |
| Trend window | 90 days | Rating change over the window |

**Documented deviations from the paper** (all deliberate): lazy multi-period inactivity inflation; an optional fractional game score used only by the experimental dominance variant; and match prediction uses the combined-RD form g(sqrt(phi_a² + phi_b²)) from Glickman's original Glicko paper (an `opponent_rd` alternative is backtested). Confidence in these choices: moderate to high; the backtest is the arbiter.

### What counts as a match

All contested matches count, from tournaments and duals alike, across ages and weights, in one global pool (the career opponent network). The age group or weight of a bracket is not discounted: both wrestlers in a bout share a bracket, so the context is the same for both, and no discount variant is implemented.

Outcome classification (`src/lib/rating/outcomes.ts`, from `win_type`, falling back to the first token of `result`):

| Class | Examples | Rated? |
|---|---|---|
| decision, major decision, tech fall, fall | DEC, MD, TF, F, FALL, PIN | yes |
| forfeit, medical forfeit, default (injury), disqualification, no contest, bye | FOR, M FOR, MFFL, DEF, DQ, NC, BYE | **no** by default (no contest was wrestled); counted in the exclusion report. `outcomes.contested` can include them; a backtest variant measures that |
| unknown | any unrecognized code | **no**, listed in the report so someone can classify it |
| other exclusions | invalid date, missing/placeholder name, self-match, exact duplicate row | no, counted by reason |

Placements are never turned into wins. Tournament placements do not enter the rating at all; they remain evidence. **Production values (audit 2026-11-03, 31,845 bouts):** F 18,393; DEC 4,666; TF 4,218; MD 2,857 (30,134 contested, 94.6%); FOR 1,341; DEF 150; M FOR 150; DQ 31; MFFL 19; NC 19 (1,710 excluded as non-contested); OTHER1 1 (unknown, a 0-0 bout, excluded). All other codes are recognized, so the classifier is unchanged (`DECISIONS.md` D18). These are row counts before duplicate, placeholder and self-match exclusions. Data-quality gaps the pipeline does not handle: 65 swapped winner/loser pairs (both rated) and 262 near-duplicate extra rows (rated unless result and method also match); see proposal D19. Weight labels with a trailing age tag such as `100 (14U)` would lose the bracket weight; the 139 unparseable labels found are nearly all HWT-style.

### Chronology and leakage

Matches are grouped into events (same normalized event name; a new event starts when consecutive match dates are more than 7 days apart). Walk-forward rule: every bout in an event is predicted from a snapshot of ratings taken **before the rating period containing that event's first bout**, so no bout from the same event (including day two of a multi-day event) or later is visible. Ratings are updated only after all predictions for the period are made. Ratings and backtests use this same code (`walk.ts`). Tests assert that changing the outcome of any later bout cannot change an earlier prediction (periods of 1, 7 and 30 days).

### Explanatory metrics (never inputs to the rating)

Opponent-adjusted strength of schedule: average opponent rating and the expected win % of a reference 1500 wrestler against that schedule, both using opponents' **current** ratings (hindsight, therefore explanation only; using them as an input would double-count schedule strength). Also quality wins and losses, pin %, bonus % (tech fall or major), method breakdown, average scoring margins, trend, head-to-head and common opponents (`relations.ts`).

### Dominance and margin (experimental, off)

Margin-weighted outcomes are implemented as backtest variants only (`dominance.enabled = false`). A variant may be adopted only if its paired-bootstrap 95% interval (resampling whole events) lies entirely below the baseline log loss, the gain is at least 0.002 log loss per match, and calibration error (ECE) does not worsen by more than 0.005. Until a real-data backtest passes that rule, dominance must not be presented as fact.

## 3. Cohort rankings versus the career network

- **Career network:** one global rating pool using every contested match. A wrestler who moved up in age or weight keeps one rating; prior results contribute with less weight as uncertainty regrows during inactivity.
- **Current cohort ranking:** `wrestler_strength_current` takes each wrestler's latest evidence per (age group, 10 lb band), ranks that cohort by the conservative score, and rescales it to 0..1000 (weakest 0, strongest 1000). The legacy view did the same with its own score, so the display is preserved. **Behaviour change when a model is active:** the number now means "conservative opponent-adjusted score within the cohort" and a wrestler with few bouts ranks lower until results narrow the uncertainty.
- Matchup likelihood ("likely for Nolan") is separate (`scoring.ts`: age fit, weight fit, recent activity, Orlando-area appearances, evidence confidence). It is not strength and is not changed.
- Historical or current-season interaction: old results stay in the rating but carry less certainty through RD growth; evidence of the current age/weight comes from `wrestler_evidence`, which is built mostly from July 2026 onward.

## 4. Backtesting

`pnpm ratings:backtest` (`backtest.ts`, `grid.ts`, `report.ts`) predicts every scorable bout from pre-event ratings and reports accuracy, log loss, Brier score, expected calibration error, calibration by probability bucket, sample and excluded counts, and segments: newcomer vs established (fewer than 5 prior bouts vs 15 or more each), same vs cross weight, same vs cross age (known only when the weight label carries an age group), and returning after more than 180 days. Baselines: coin flip, Elo, smoothed win-rate (log5), and the legacy heuristic (not a probability). Tuning uses the early window; the last ~30% of scorable events (after a 60-day warm-up) is held out for confirmation and never used to choose a setting. Variants swept: period length, tau, initial RD and volatility, the opponent-RD predictor, dominance, and two policy variants (including disqualification/default bouts; alias handling off), which are reported but never auto-adopted. **No production backtest has been run**; see `docs/BACKTEST_REPORT.md`.

## 5. Versioning

Every calculation writes a new `rating_models` row containing model id/version, full config and its hash, input fingerprint (so an identical re-run is detected), as-of date, match cutoff, rating-period policy, k, recency policy, dominance flag, counts, exclusions, quality threshold and (when stored) backtest metrics. Older models are archived, not deleted. Raw `matches` are never modified. A different config or input creates a new model that can be compared with, or rolled back to, the previous one.

## 6. Known limitations

- Same-name wrestlers are one identity.
- Calendar 2025 has no data (2024-12-30 to 2026-01-04), so returning wrestlers rely on RD growth; its effect on accuracy is measured only once the backtest runs on production data ("returning after 180+ days" segment).
- 65 swapped-record pairs and 262 near-duplicate rows are currently rated (D19, proposed).
- Provisional/developing/established thresholds and k are defaults, not calibrated.
- Opponent-quality metrics use current ratings and can differ from the rating at match time.
- Dual meets and tournaments are weighted the same; there is no evidence yet on whether they should differ.
