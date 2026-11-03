# Rating backtest report

Generated 2026-11-03 from file:../rating-private/input.json by `pnpm ratings:backtest`. This file is machine-generated; do not edit by hand.

## Protocol

- Walk-forward: events are scored in date order. Every match in an event is predicted from ratings that contain **only matches in earlier rating periods**; no result from the same event, or later, is visible, including day two of a multi-day event.
- Alias table is applied retrospectively (a reviewed identity merge, not an outcome signal); the `aliases-off` variant measures the effect.
- Tuning window: events from 2024-12-04 up to (not including) 2026-08-15. Confirmation window: events from 2026-08-15 onward, **not used to choose any setting**.
- Adoption rule: a change is adopted only if its paired-bootstrap 95% interval (resampling whole events) is entirely below baseline, the gain is at least 0.002 log loss per match, and (for dominance variants) calibration error does not worsen by more than 0.005. Policy variants are reported but never adopted automatically.

## Data and exclusions

Rows read: 31,845. Rated: 30,133. Excluded: 1,712.

| Reason | Rows |
|---|---:|
| invalid_date | 0 |
| missing_name | 0 |
| placeholder_opponent | 0 |
| self_match | 1 |
| non_contested_method | 1,710 |
| unrecognized_method | 1 |
| duplicate_row | 0 |

Excluded non-contested methods: forfeit 1341, medical_forfeit 169, default 150, no_contest 19, disqualification 31.
**Unrecognised win_type values (excluded; classify them in src/lib/rating/outcomes.ts):** OTHER1 ×1.

Scored in the confirmation window: 8,146 matches in 26 events (21,987 earlier matches used only for warm-up).

## Model comparison (confirmation window)

| | Matches | Accuracy | Log loss | Brier | ECE |
|---|---:|---:|---:|---:|---:|
| glicko2 | 8,146 | 65.4% | 0.6045 | 0.2102 | 0.025 |
| elo | 8,146 | 64.9% | 0.6178 | 0.2148 | 0.042 |
| win_rate_log5 | 8,146 | 63.8% | 0.6248 | 0.2180 | 0.035 |
| legacy_heuristic (not a probability) | 8,146 | 65.6% | 0.9392 | 0.2522 | 0.163 |
| coin_flip | 8,146 | 50.0% | 0.6931 | 0.2500 | 0.000 |
| candidate: Combined: period-1 + dominance-dec-0.8 | 8,146 | 66.2% | 0.5952 | 0.2063 | 0.016 |

Candidate minus baseline Glicko-2 log loss: -0.0093 (95% interval -0.0116 to -0.0073, 26 events). Negative is better.

**Recommendation: adopt the candidate.** the combined change also wins on held-out events.

## Calibration (baseline Glicko-2, confirmation window)

Each match contributes two points (winner at p, loser at 1−p), so the table is symmetric.

| Predicted | Matches | Mean predicted | Observed win rate |
|---|---:|---:|---:|
| 0.0–0.1 | 599 | 6.5% | 6.2% |
| 0.1–0.2 | 1,111 | 15.4% | 18.8% |
| 0.2–0.3 | 1,646 | 25.3% | 29.2% |
| 0.3–0.4 | 1,945 | 34.8% | 37.5% |
| 0.4–0.5 | 1,935 | 44.8% | 47.0% |
| 0.5–0.6 | 3,755 | 52.7% | 51.5% |
| 0.6–0.7 | 1,945 | 65.2% | 62.5% |
| 0.7–0.8 | 1,646 | 74.7% | 70.8% |
| 0.8–0.9 | 1,111 | 84.6% | 81.2% |
| 0.9–1.0 | 599 | 93.5% | 93.8% |

## Segments (baseline Glicko-2, confirmation window)

Newcomer = either wrestler has fewer than 5 prior recorded bouts. Established = both have 15 or more. Weight/age context compares the match's bracket with each wrestler's most recent earlier bracket; `unknown` means that information was unavailable (age is only known when the weight-class label carries an age group).

| | Matches | Accuracy | Log loss | Brier | ECE |
|---|---:|---:|---:|---:|---:|
| activity:recently_active | 6,458 | 65.3% | 0.6034 | 0.2098 | 0.017 |
| activity:returning_after_gap | 1,688 | 65.7% | 0.6086 | 0.2120 | 0.053 |
| age:age_unknown | 8,074 | 65.3% | 0.6059 | 0.2108 | 0.025 |
| age:cross_age_group | 32 | 81.3% | 0.3416 | 0.0996 | 0.214 |
| age:same_age_group | 40 | 70.0% | 0.5372 | 0.1827 | 0.116 |
| experience:both_established | 685 | 76.5% | 0.4779 | 0.1583 | 0.026 |
| experience:both_unseen | 882 | 50.0% | 0.6931 | 0.2500 | 0.000 |
| experience:developing | 1,877 | 74.7% | 0.5111 | 0.1706 | 0.011 |
| experience:newcomer_involved | 4,702 | 62.9% | 0.6436 | 0.2262 | 0.049 |
| weight:cross_weight_band | 2,729 | 71.5% | 0.5430 | 0.1840 | 0.025 |
| weight:same_weight_band | 1,547 | 75.4% | 0.5141 | 0.1711 | 0.028 |
| weight:weight_unknown | 3,870 | 57.0% | 0.6840 | 0.2444 | 0.048 |

## Tuning sweep (tuning window, one factor at a time)

| Variant | Log loss | Accuracy | ECE | Δ log loss vs baseline (95% interval) | Adopted | Note |
|---|---:|---:|---:|---|:---:|---|
| Baseline Glicko-2 (7-day periods, τ 0.5, binary outcomes) | 0.6030 | 64.9% | 0.008 | reference | no | reference |
| Rating period 1 day | 0.5957 | 65.5% | 0.006 | -0.0073 (-0.0095 to -0.0051) | yes | significant, meaningful gain on the tuning window |
| Rating period 3 days | 0.5999 | 65.2% | 0.004 | -0.0030 (-0.0045 to -0.0018) | no | significant, meaningful gain on the tuning window |
| Rating period 14 days | 0.6171 | 63.3% | 0.009 | 0.0142 (0.0078 to 0.0225) | no | no significant improvement over baseline |
| Rating period 30 days | 0.6256 | 62.3% | 0.010 | 0.0226 (0.0142 to 0.0325) | no | no significant improvement over baseline |
| System constant τ 0.3 | 0.6030 | 64.9% | 0.008 | 0.0000 (0.0000 to 0.0000) | no | no significant improvement over baseline |
| System constant τ 0.75 | 0.6030 | 64.9% | 0.008 | -0.0000 (-0.0000 to -0.0000) | no | gain 0.0000 is below the 0.002 threshold |
| System constant τ 1 | 0.6030 | 64.9% | 0.008 | -0.0000 (-0.0000 to -0.0000) | no | gain 0.0000 is below the 0.002 threshold |
| System constant τ 1.2 | 0.6030 | 64.9% | 0.008 | -0.0000 (-0.0000 to -0.0000) | no | gain 0.0000 is below the 0.002 threshold |
| Newcomer starting RD 200 | 0.6070 | 64.6% | 0.022 | 0.0040 (0.0009 to 0.0071) | no | no significant improvement over baseline |
| Newcomer starting RD 250 | 0.6043 | 64.8% | 0.012 | 0.0013 (-0.0006 to 0.0031) | no | no significant improvement over baseline |
| Initial volatility 0.03 | 0.6047 | 64.7% | 0.009 | 0.0018 (0.0012 to 0.0024) | no | no significant improvement over baseline |
| Initial volatility 0.09 | 0.6010 | 65.0% | 0.006 | -0.0020 (-0.0027 to -0.0013) | no | gain 0.0020 is below the 0.002 threshold |
| Forecast with opponent RD only | 0.6088 | 64.9% | 0.017 | 0.0058 (0.0032 to 0.0088) | no | no significant improvement over baseline |
| ⚗ Decision wins score 0.90 | 0.6010 | 65.0% | 0.005 | -0.0019 (-0.0025 to -0.0014) | no | gain 0.0019 is below the 0.002 threshold |
| ⚗ Decision wins score 0.80 | 0.5997 | 64.9% | 0.005 | -0.0033 (-0.0043 to -0.0023) | yes | significant, meaningful gain on the tuning window |
| ⚗ Graded: decision .85, major .93, tech .98, fall 1 | 0.6001 | 65.0% | 0.008 | -0.0028 (-0.0039 to -0.0020) | no | significant, meaningful gain on the tuning window |
| ⚗ Decision margin interpolates .75→1 over 8 points | 0.6007 | 65.0% | 0.005 | -0.0023 (-0.0031 to -0.0016) | no | significant, meaningful gain on the tuning window |
| Also count defaults and disqualifications | 0.6045 | 64.6% | 0.008 | 0.0042 (0.0026 to 0.0063) | no | policy choice: reported only, never adopted automatically |
| Ignore the alias table | 0.6030 | 64.9% | 0.008 | 0.0000 (0.0000 to 0.0000) | no | policy choice: reported only, never adopted automatically |

⚗ = experimental dominance variant. Adopted changes: period-1, dominance-dec-0.8.

## Limitations

- Ratings are fitted on the same events used for scoring only through the walk-forward process; the tuning/confirmation split limits, but cannot eliminate, selection effects.
- Same-name wrestlers are one identity in this database; the report cannot detect two different people sharing a name.
- The 2025 season is absent from the imported data, so predictions after that gap rely on long-inactive ratings and measure the inactivity policy as much as the rating model.
