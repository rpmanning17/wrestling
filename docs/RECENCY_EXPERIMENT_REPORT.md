# Youth-rating recency experiment — NOT a production adoption

Generated 2026-11-04 from file:../ratings-input.json; reference `config/ratings.production.json`.
Input matches: 67,736; rated matches: 64,050.
Input fingerprint: `7a19ca2f486aac6f1889e9f8e28a700115adb7ddb83a213c6e4be17b449101a9`. Reference configuration SHA-256: `1eb854346d016d2c1276d8cc5209f73acac90c433fcc23636743e6a5e1881a67`.
Walk-forward event tuning: [2024-12-04, 2026-01-17); untouched confirmation: from 2026-01-17.

Experimental parameter: additional annual random-walk RD (points per sqrt(year)).
This increases uncertainty about evolving ability even between regular appearances. It does NOT
multiply individual bout weights, impose a hard expiration, or imply a literal 12-month half-life.
All candidates retain production daily periods and decision-0.8 outcomes.

Adoption gate: paired event-bootstrap 95% log-loss interval entirely below 0, mean improvement ≥ 0.002, ECE increase ≤ 0.005.
Candidates are selected only on tuning matches; the confirmation window is not used for selection.

## Tuning

| Model | Bouts | Accuracy | Log loss | Brier | ECE | Δ log loss vs production | 95% CI | Eligible |
|---|---:|---:|---:|---:|---:|---:|---|:---:|
| Production | 40,916 | 0.6835 | 0.57021 | 0.19576 | 0.00655 | — | — | Reference |
| Drift 50 | 40,916 | 0.6838 | 0.57014 | 0.19573 | 0.00725 | -0.00007 | [-0.00011, -0.00003] | no |
| Drift 100 | 40,916 | 0.6834 | 0.56998 | 0.19565 | 0.00664 | -0.00023 | [-0.00039, -0.00007] | no |
| Drift 150 | 40,916 | 0.6835 | 0.56983 | 0.19559 | 0.00580 | -0.00037 | [-0.00070, -0.00005] | no |
| Drift 200 | 40,916 | 0.6845 | 0.56980 | 0.19556 | 0.00748 | -0.00041 | [-0.00092, 0.00011] | no |

Tuning-selected candidate: none.

## Untouched confirmation

| Model | Bouts | Accuracy | Log loss | Brier | ECE |
|---|---:|---:|---:|---:|---:|
| Production | 16,819 | 0.6942 | 0.55932 | 0.19171 | 0.01552 |

No candidate met the tuning gate; production configuration remains preferred.

**Decision: keep production unchanged**. No data or live model was altered.

## Holdout segment diagnostics (not individually powered adoption tests)

The following rows are descriptive; small populations and ambiguous age/weight evidence are not strong proof.

| Segment | Bouts | Production log loss | Candidate log loss | Candidate − production | Production ECE | Candidate ECE |
|---|---:|---:|---:|---:|---:|---:|
| experience:newcomer_involved | 7629 | 0.63934 | n/a | n/a | 0.05094 | n/a |
| experience:developing | 4031 | 0.47081 | n/a | n/a | 0.02400 | n/a |
| experience:both_established | 3988 | 0.45641 | n/a | n/a | 0.03251 | n/a |
| activity:recently_active | 12590 | 0.54981 | n/a | n/a | 0.01607 | n/a |
| activity:returning_after_gap | 4229 | 0.58763 | n/a | n/a | 0.02812 | n/a |
| weight:same_weight_band | 4259 | 0.46272 | n/a | n/a | 0.03370 | n/a |
| weight:cross_weight_band | 6376 | 0.49718 | n/a | n/a | 0.01425 | n/a |
| weight:weight_unknown | 6184 | 0.68992 | n/a | n/a | 0.06092 | n/a |
| age:same_age_group | 82 | 0.54150 | n/a | n/a | 0.05523 | n/a |
| age:cross_age_group | 103 | 0.45664 | n/a | n/a | 0.05941 | n/a |
| age:age_unknown | 16634 | 0.56004 | n/a | n/a | 0.01578 | n/a |

## Event concentration (check for outsized tournament effects)

Tuning: 129 events; largest event 3.2% of scored bouts; event-balanced log loss 0.57382.
Holdout: 56 events; largest event 6.3% of scored bouts; event-balanced log loss 0.56460.

| Holdout event identifier | Bouts | Event log loss |
|---|---:|---:|
| i own florida championships 2026@2026-02-15 | 1053 | 0.53928 |
| juggernaut fall championships@2026-10-31 | 617 | 0.54245 |
| venice iof@2026-02-01 | 590 | 0.44153 |
| palm bay juggernaut@2026-09-26 | 552 | 0.56688 |
| juggernaut orlando qualifier@2026-10-10 | 530 | 0.59611 |

## Limitations

- Only ~2 years of imported bouts: cannot validate a three- or four-year cutoff or long-term development effects.
- Age division can be ambiguous; do not treat bracket labels as exact age or bodyweight.
- Match/network identity errors and event coverage affect all comparisons.
- The recency confirmation dates are withheld from recency selection, but the deployed production baseline was previously tuned using some overlapping 2026 events. This is retrospective, not a pristine independent research holdout.
- Re-running tuning after seeing confirmation metrics requires NEW future tournament results for an independent prospective check.
