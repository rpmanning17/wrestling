# Rating backtest report

Generated 2026-11-04 from file:../ratings-input.json by `pnpm ratings:backtest`. This file is machine-generated; do not edit by hand.

## Protocol

- Walk-forward: events are scored in date order. Every match in an event is predicted from ratings that contain **only matches in earlier rating periods**; no result from the same event, or later, is visible, including day two of a multi-day event.
- Alias table is applied retrospectively (a reviewed identity merge, not an outcome signal); the `aliases-off` variant measures the effect.
- Tuning window: events from 2024-12-04 up to (not including) 2026-01-17. Confirmation window: events from 2026-01-17 onward, **not used to choose any setting**.
- Adoption rule: a change is adopted only if its paired-bootstrap 95% interval (resampling whole events) is entirely below baseline, the gain is at least 0.002 log loss per match, and (for dominance variants) calibration error does not worsen by more than 0.005. Policy variants are reported but never adopted automatically.

## Data and exclusions

Rows read: 67,736. Rated: 64,050. Excluded: 3,686.

| Reason | Rows |
|---|---:|
| invalid_date | 0 |
| missing_name | 0 |
| placeholder_opponent | 0 |
| self_match | 1 |
| non_contested_method | 3,679 |
| unrecognized_method | 6 |
| duplicate_row | 0 |

Excluded non-contested methods: forfeit 2891, medical_forfeit 342, default 358, no_contest 30, disqualification 58.
**Unrecognised win_type values (excluded; classify them in src/lib/rating/outcomes.ts):** OTHER1 ×6.

Scored in the confirmation window: 16,819 matches in 56 events (47,231 earlier matches used only for warm-up).

## Model comparison (confirmation window)

| | Matches | Accuracy | Log loss | Brier | ECE |
|---|---:|---:|---:|---:|---:|
| glicko2 | 16,819 | 68.2% | 0.5733 | 0.1975 | 0.024 |
| elo | 16,819 | 67.5% | 0.5878 | 0.2020 | 0.037 |
| win_rate_log5 | 16,819 | 66.2% | 0.6026 | 0.2084 | 0.024 |
| legacy_heuristic (not a probability) | 16,819 | 69.6% | 0.8187 | 0.2241 | 0.118 |
| coin_flip | 16,819 | 50.0% | 0.6931 | 0.2500 | 0.000 |
| candidate: Combined: period-1 + dominance-dec-0.8 | 16,819 | 69.4% | 0.5593 | 0.1917 | 0.016 |

Candidate minus baseline Glicko-2 log loss: -0.0140 (95% interval -0.0164 to -0.0117, 56 events). Negative is better.

**Recommendation: adopt the candidate.** the combined change also wins on held-out events.

## Calibration (baseline Glicko-2, confirmation window)

Each match contributes two points (winner at p, loser at 1−p), so the table is symmetric.

| Predicted | Matches | Mean predicted | Observed win rate |
|---|---:|---:|---:|
| 0.0–0.1 | 1,826 | 5.8% | 4.5% |
| 0.1–0.2 | 2,837 | 15.2% | 17.2% |
| 0.2–0.3 | 3,513 | 25.0% | 29.4% |
| 0.3–0.4 | 3,758 | 34.9% | 38.3% |
| 0.4–0.5 | 3,694 | 45.1% | 46.3% |
| 0.5–0.6 | 6,076 | 53.0% | 52.2% |
| 0.6–0.7 | 3,758 | 65.1% | 61.7% |
| 0.7–0.8 | 3,513 | 75.0% | 70.6% |
| 0.8–0.9 | 2,837 | 84.8% | 82.8% |
| 0.9–1.0 | 1,826 | 94.2% | 95.5% |

## Segments (baseline Glicko-2, confirmation window)

Newcomer = either wrestler has fewer than 5 prior recorded bouts. Established = both have 15 or more. Weight/age context compares the match's bracket with each wrestler's most recent earlier bracket; `unknown` means that information was unavailable (age is only known when the weight-class label carries an age group).

| | Matches | Accuracy | Log loss | Brier | ECE |
|---|---:|---:|---:|---:|---:|
| activity:recently_active | 12,590 | 68.7% | 0.5651 | 0.1942 | 0.017 |
| activity:returning_after_gap | 4,229 | 66.8% | 0.5979 | 0.2074 | 0.047 |
| age:age_unknown | 16,634 | 68.1% | 0.5742 | 0.1979 | 0.024 |
| age:cross_age_group | 103 | 75.7% | 0.4619 | 0.1510 | 0.076 |
| age:same_age_group | 82 | 72.0% | 0.5393 | 0.1825 | 0.071 |
| experience:both_established | 3,986 | 77.1% | 0.4676 | 0.1537 | 0.025 |
| experience:both_unseen | 1,176 | 50.0% | 0.6931 | 0.2500 | 0.000 |
| experience:developing | 4,028 | 76.9% | 0.4818 | 0.1588 | 0.017 |
| experience:newcomer_involved | 7,629 | 61.8% | 0.6584 | 0.2328 | 0.068 |
| weight:cross_weight_band | 6,357 | 74.5% | 0.5082 | 0.1696 | 0.005 |
| weight:same_weight_band | 4,265 | 77.0% | 0.4760 | 0.1568 | 0.025 |
| weight:weight_unknown | 6,197 | 55.7% | 0.7071 | 0.2542 | 0.076 |

## Tuning sweep (tuning window, one factor at a time)

| Variant | Log loss | Accuracy | ECE | Δ log loss vs baseline (95% interval) | Adopted | Note |
|---|---:|---:|---:|---|:---:|---|
| Baseline Glicko-2 (7-day periods, τ 0.5, binary outcomes) | 0.5772 | 67.8% | 0.009 | reference | no | reference |
| Rating period 1 day | 0.5738 | 68.0% | 0.007 | -0.0035 (-0.0047 to -0.0023) | yes | significant, meaningful gain on the tuning window |
| Rating period 3 days | 0.5757 | 68.0% | 0.008 | -0.0015 (-0.0023 to -0.0009) | no | gain 0.0015 is below the 0.002 threshold |
| Rating period 14 days | 0.5854 | 66.9% | 0.012 | 0.0081 (0.0054 to 0.0112) | no | no significant improvement over baseline |
| Rating period 30 days | 0.5955 | 65.7% | 0.014 | 0.0183 (0.0138 to 0.0236) | no | no significant improvement over baseline |
| System constant τ 0.3 | 0.5772 | 67.8% | 0.009 | 0.0000 (-0.0000 to 0.0000) | no | no significant improvement over baseline |
| System constant τ 0.75 | 0.5772 | 67.8% | 0.009 | -0.0000 (-0.0000 to 0.0000) | no | no significant improvement over baseline |
| System constant τ 1 | 0.5772 | 67.8% | 0.009 | -0.0000 (-0.0000 to 0.0000) | no | no significant improvement over baseline |
| System constant τ 1.2 | 0.5772 | 67.8% | 0.009 | -0.0000 (-0.0000 to 0.0000) | no | no significant improvement over baseline |
| Newcomer starting RD 200 | 0.5847 | 67.6% | 0.024 | 0.0074 (0.0049 to 0.0099) | no | no significant improvement over baseline |
| Newcomer starting RD 250 | 0.5807 | 67.6% | 0.011 | 0.0034 (0.0019 to 0.0048) | no | no significant improvement over baseline |
| Initial volatility 0.03 | 0.5783 | 67.7% | 0.009 | 0.0010 (0.0007 to 0.0014) | no | no significant improvement over baseline |
| Initial volatility 0.09 | 0.5761 | 67.9% | 0.008 | -0.0011 (-0.0015 to -0.0008) | no | gain 0.0011 is below the 0.002 threshold |
| Forecast with opponent RD only | 0.5866 | 67.8% | 0.020 | 0.0093 (0.0050 to 0.0143) | no | no significant improvement over baseline |
| ⚗ Decision wins score 0.90 | 0.5751 | 67.9% | 0.010 | -0.0022 (-0.0026 to -0.0017) | no | significant, meaningful gain on the tuning window |
| ⚗ Decision wins score 0.80 | 0.5736 | 68.0% | 0.008 | -0.0036 (-0.0044 to -0.0027) | yes | significant, meaningful gain on the tuning window |
| ⚗ Graded: decision .85, major .93, tech .98, fall 1 | 0.5741 | 68.0% | 0.007 | -0.0031 (-0.0039 to -0.0023) | no | significant, meaningful gain on the tuning window |
| ⚗ Decision margin interpolates .75→1 over 8 points | 0.5747 | 67.9% | 0.008 | -0.0026 (-0.0031 to -0.0020) | no | significant, meaningful gain on the tuning window |
| Also count defaults and disqualifications | 0.5786 | 67.7% | 0.009 | 0.0049 (0.0036 to 0.0063) | no | policy choice: reported only, never adopted automatically |
| Ignore the alias table | 0.5772 | 67.8% | 0.009 | 0.0000 (0.0000 to 0.0000) | no | policy choice: reported only, never adopted automatically |

⚗ = experimental dominance variant. Adopted changes: period-1, dominance-dec-0.8.

## Limitations

- Ratings are fitted on the same events used for scoring only through the walk-forward process; the tuning/confirmation split limits, but cannot eliminate, selection effects.
- Same-name wrestlers are one identity in this database; the report cannot detect two different people sharing a name.
- The 2025 season is absent from the imported data, so predictions after that gap rely on long-inactive ratings and measure the inactivity policy as much as the rating model.
