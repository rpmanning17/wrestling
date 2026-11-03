# First production rating activation — 2026-11-03

## Outcome

Model `d64fd4ba-de14-4d07-bac8-2961e12d506d` (`glicko2-daily-dec08-v1`) is active on the existing Mat Notes production application, https://wrestling-plum.vercel.app. Calculation code: deployed main commit `003bf0f9aa1d1de795519383628c1b789961ea08` (`glicko2-engine-1`). As-of date 2026-11-03; latest bout 2026-10-31; first bout 2024-10-05.

## Input provenance and preservation

Read 31,845 matches and the reviewed alias table through the connected Supabase SQL tool for project `tprodwivvwvpmpzaedom`, ordered by event date/id. The local export was outside the repository and is not committed. One reviewed alias was present; its source spelling no longer occurs in the match snapshot, so applying aliases changed no rating identities.

- Input fingerprint: `4557991aab330770371797f529d45aca21e5a47b5e36e263c70b4cfa9bdb49f6` (existing CLI fingerprint algorithm).
- Resolved configuration hash: `1eb854346d016d2c1276d8cc5209f73acac90c433fcc23636743e6a5e1881a67`.
- Raw table row count before/after: 31,845 / 31,845.
- Raw id/result/win_type checksum before/after: `f11fe5b13c36aab8389654b4afb80b33` / identical. This checksum is a preservation check, not the model fingerprint.
- No raw matches, evidence, identity mappings, access policies or schema objects were modified. No secret was requested or extracted. No Vercel project was created.

The fingerprint currently includes ids, dates, participants, outcome, score, bracket and alias keys, but does not include every context field (event name, round, team and alias display name). Keep the code commit and source audit context with the model; a future fingerprint revision should cover all calculation-relevant fields before relying on identical-input detection after context edits.

## Duplicate investigation

Grouping by normalized date/event/bracket/round and unordered participants finds 310 groups with 319 extra records; 57 groups have opposite winners. These are broader candidates than the initial audit's same-direction count, not established duplicates. Source examples inspected include:

- Sunshine Open, 2024-12-28: an opposite-result pair under a repeated final-round label with different score/clock text and distinct source rows.
- Mariner IOF, 2026-01-04: opposite decisions 15–9 and 5–4, blank rounds, distinct source rows; other pairs have different fall score/clock text.
- D19's Bradenton Brawl example remains relevant: a fall and an opposite 11–10 result can represent separate meetings.

A repeated round label or blank round does not establish duplication. Opposite administrative outcomes are excluded by outcome policy, not treated as proof that a contested match is invalid. No new pair-based suppression was added. The actual preparation signature (directed canonical participants plus date/event/bracket/round/result/method) excluded **zero** rows. All contested candidate rematches were retained. Source-level adjudication remains a separate future task.

## Backtest and configuration decision

Ran the repository's `ratings:backtest` CLI against the real-data snapshot with 20 variants and 1,000 deterministic paired-bootstrap iterations, resampling entire events. The 60-day warm-up starts evaluation on 2024-12-04; tuning stops before 2026-08-15; confirmation uses events beginning 2026-08-15 onward. The existing frozen pre-event snapshot protocol prevents same-event/day-two and future-result leakage.

| Held-out model | Bouts | Accuracy | Log loss | Brier | ECE |
|---|---:|---:|---:|---:|---:|
| Seven-day binary Glicko-2 reference | 8,146 | 65.37% | 0.60451 | 0.21025 | 0.02453 |
| Elo comparison baseline | 8,146 | 64.9% | 0.6178 | 0.2148 | 0.042 |
| Smoothed win-rate baseline | 8,146 | 63.8% | 0.6248 | 0.2180 | 0.035 |
| Adopted daily/decision-0.8 candidate | 8,146 | 66.17% | 0.59524 | 0.20634 | 0.01567 |

Candidate minus reference log loss: -0.00927, event-bootstrap 95% CI [-0.01156, -0.00727], 26 confirmation events. This clears the predefined 0.002 minimum improvement with an interval below zero and improved calibration. The legacy heuristic stand-in has 65.6% ordering accuracy; its artificial logistic probabilities are not a meaningful calibration comparator. No claim is made that the Glicko reference beats that heuristic on accuracy.

Production overrides are committed in `config/ratings.production.json`: daily periods; decision winner score 0.8 (loser 0.2); major, technical fall and fall winner scores 1. Tau 0.5, initial RD 350, initial volatility 0.06, combined-RD prediction and conservative k=1 stay unchanged. Score margins remain disabled. This fractional decision update is a validated extension of Glicko-2 for this dataset, not standard binary Glicko-2 or a literal fractional bout result; displayed W–L records still count actual winners.

The generated `BACKTEST_REPORT.md` retains the full tuning sweep, baseline calibration and segment metrics. Its calibration sections describe the reference model; adopted candidate aggregate metrics are in the comparison table and stored database metrics. Engine defaults intentionally remain the original reference so a rerun does not silently change the experimental baseline.

## Calculation and validation

| Check | Result |
|---|---|
| Input rows | 31,845 |
| Rated contested bouts | 30,133 |
| Excluded | 1,710 non-contested; one contested self-match; one OTHER1 |
| Exact duplicate exclusions | 0 |
| Wrestler rating/SOS rows | 7,788 |
| Period-history rows | 16,951, covering all 7,788 rated identities |
| Sum of wins / losses | 30,133 / 30,133 |
| Invalid stored record, conservative score or missing SOS | 0 |
| Active models | Exactly one |
| Current rating / cohort view rows | 7,788 / 770 |
| Numeric outputs | All finite; RD >0 and ≤350; SOS expectation within [0,1] |
| Rating range | 626.44–2271.79 |
| Status counts | 7,665 provisional; 121 developing; two established |

The high provisional share is plausible for sparse imported histories and daily inactivity inflation, including the missing 2025 data. Status thresholds were not tuned to improve appearances. Quality-win threshold 1739.97 uses the 123 non-provisional wrestlers (RD <120), including developing wrestlers; it does not require 20 strictly established wrestlers.

Top conservative-score outputs were reviewed alongside W–L, RD and recent activity; no nonfinite, extreme or internally inconsistent outputs appeared. This does not solve uncertain identities or disconnected age/weight networks. Only 72 confirmation bouts have known age context, so age-segment calibration is insufficient for strong conclusions. SOS is current-opponent hindsight explanation, never used as an additional rating input.

## Secure persistence and activation

Used existing connected Supabase administrator authorization to insert one `building` model, rating rows and history in batches. Validated database counts and invariants before promotion. Stored the chronological backtest summary in both model metadata and `rating_backtest_runs`, associated with the selected production config hash.

Candidate promotion and activation were one transaction using the existing restricted `private.activate_rating_model(uuid)` function; no anonymous grants, public administrative RPC or service-key extraction was needed. The function is not exposed to the application client. The model is now immutable in operational use; a later calculation should create a new model.

For subsequent owner-authorized recalculation with secure local credentials already available:

```bash
pnpm ratings:backtest
pnpm ratings:calculate --config config/ratings.production.json --dry-run
pnpm ratings:calculate --config config/ratings.production.json
```

Review candidate outputs before activating. Prefer the atomic administrator SQL path over the CLI's two-request `--activate` path:

```sql
select private.activate_rating_model('<validated-candidate-model-id>'::uuid);
```

The currently active UUID above supports future rollback to this version through the same restricted function. No automatic refresh was added. Do not use `supabase db push` against the unreconciled historical migration names.

## Live verification

- Production `/rankings` returned 200, explicitly described opponent-adjusted conservative scoring and displayed cohort values matching Supabase. Example: Waylon Jones, 12U 70–79 lb cohort, rank 18/36, strength 531.26.
- Opened the deployed comparison UI, searched and added Waylon Jones, then expanded Rating details. It showed rating 1514 ±122, conservative 1392, 55 rated bouts, W–L 29–26, average opponent 1588, schedule-expected win 41%, quality W–L 1–18, and model `glicko2-daily-dec08-v1` through 2026-11-03. Rounded values match the active database row (rating 1513.787, RD 121.764, average opponent 1588.12, SOS expectation 0.41272). The profile's latest 80 lb evidence gives the 80–89 lb cohort score 616.29; the rankings list uses the explicit 70–79 lb cohort. This is expected cohort-specific scaling.
- Production `/clubs` returned 200 with populated conservative-strength and average-opponent SOS fields; Longwood displayed schedule 1569.6 and typical strength 1295.7.
- Production responses retained private/no-store caching and `noindex, nofollow, noarchive` robot headers.
- Repository verification: `pnpm lint`, `pnpm typecheck`, `pnpm test` (101 passed), `pnpm build` (dummy environment values) all passed. No application code changed for activation; the final commit records configuration and operational evidence.
