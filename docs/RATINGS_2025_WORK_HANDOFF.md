# 2025 backfill, Glicko-2 reactivation, and youth recency — execution handoff

**Prepared:** 2026-11-04 through direct GitHub + Supabase chat connections, **without Work/Codex**.
**Repository:** https://github.com/rpmanning17/wrestling
**Live application:** https://wrestling-plum.vercel.app
**Supabase project:** `tprodwivvwvpmpzaedom`
**Experimental branch / draft PR:** `experiment/youth-rating-recency-drift` / https://github.com/rpmanning17/wrestling/pull/6

## Objective and strict boundaries

1. Safely persist, validate and activate the **expanded existing production Glicko-2 model** using all 2024–2026 imported results, including the newly added calendar-2025 rows.
2. Independently evaluate the **optional youth skill-drift extension** against that exact production baseline; never switch rating formulas based only on intuition.
3. Preserve raw matches, source provenance, name/club mappings, previous models, authorization/RLS, and existing rollback procedure. No automatic opposite-winner or same-pair deduplication.
4. Keep **one writer / release owner at a time**. Work may handle secure data execution and live checks; Codex can review the draft code/experiment. Avoid two agents simultaneously altering `main`, rating config, or the same model.
5. **No service-role secrets in chat, logs, code, PRs, or unprotected build jobs.** Do not widen anonymous database permissions to bypass a tool restriction.

## Current production state (verified from Supabase on 2026-11-04)

| Metric | Active existing model | Expanded calculated target |
|---|---:|---:|
| Raw input matches | 31,845 | 67,736 |
| Rated contested matches | 30,133 | 64,050 |
| Wrestler ratings | 7,788 | 11,724 |
| Historical rating points | 16,951 | 34,809 |
| As-of date | 2026-11-03 | 2026-11-04 |
| Latest match date | 2026-10-31 | 2026-10-31 |

- Active UUID: `d64fd4ba-de14-4d07-bac8-2961e12d506d` (`glicko2-daily-dec08-v1`, intact and complete).
- **Incomplete, never-activate** building UUID: `a957ed42-8ee2-4792-944d-5f63a0b4ce72`; metadata claims 11,724 wrestlers but contains **500 ratings and zero history records**.
- The new calculation was completed independently in a prior chat and reproduced the old-model baseline to <0.0005 rating points (database 3-decimal rounding), but its full output was not persisted. Treat the expanded model as **calculated, not active**.
- Production config hash: `1eb854346d016d2c1276d8cc5209f73acac90c433fcc23636743e6a5e1881a67`.
- Expected full-input fingerprint from the building model: `7a19ca2f486aac6f1889e9f8e28a700115adb7ddb83a213c6e4be17b449101a9`.
- Baseline config remains `config/ratings.production.json` (daily Glicko-2 periods, decision score 0.8, other contested results 1, tau 0.5, RD 350, conservative k 1). **Do not introduce experimental drift into this baseline rebuild.**

## 2025 import provenance and verification

The 2026-11-04 import added **35,891 rows**, not 35,861 alone:
- **35,861** bouts dated 2025 from **96** source files in `2025 Results.zip`;
- **30** bouts dated **2026-01-02**, event `Titan Holiday Tapout`, source `2025 Results.zip/TitanHolidayTapout.csv`.

Entire source: 2024 Oct–Dec **11,647** rows in 38 files; calendar 2025 **35,861** in 96 files; 2026 Jan–Oct **20,228** in 65 files; total **67,736** across **199 files**, 2024-10-05 to 2026-10-31.

Read-only SQL checks found:
- Zero missing event dates, participant names, source filenames or source-row identifiers.
- `count(distinct (source_file,source_row))=67,736`; zero repeated source-file/row pairs.
- Zero strictly identical same-direction date/event/weight/round/result/win-type groups under the literal normalized SQL audit; the preparation pipeline also reported zero excluded exact-duplicate signatures.
- **921** normalized wrestler names appear in all three years; **2,462** appear in both 2025 and 2026; **676** recorded at least 10 bouts in each of 2025 and 2026. This is useful developmental coverage, *not proof* of unique verified persons.
- Year 2025 has **1,095** same-date/event/bracket/unordered-pair multiple-contested-bout groups, with **164** opposite-winner groups, under a **broader grouping that ignores round**. This is not evidence of duplication; D19 forbids automatic suppression. These counts are NOT directly comparable to earlier narrower audits.
- Six `OTHER1` records remain excluded from rating: two 0-0 scores, four nonzero scores in 2025. The four scored rows are `SomersetSpringBash#1 (1).csv` source_row 316 (2025-04-19, 1-6); `VieraHammersJuggernautQualifier.csv` rows 166 (13-1) and 180 (20-7) (2025-10-18); `LAInvitational2025.csv` row 210 (2025-12-13, 16-2). Review original Flo context before assigning a contested method; **do not guess from numeric scores**.
- Season labels include an existing 668-row `2026-2027` hyphen variant alongside `2026–2027`; rating calculation uses event dates, not season labels.
- Only 860 / 35,861 calendar-2025 rows carry an explicit 6U–18U age token under a simple regex audit. This is a limited proxy, not the engine parser or an exact youth-age population. Avoid claims that age-specific recency calibration is strong without verifying sample sizes.
- `2025Poseidon (1).csv` on 2025-04-26 contains **4,476** rows. Check sensitivity of chronological backtest conclusions to large events; the recency experiment now prints event-concentration diagnostics.

**Immutable raw-source checksums (read before AND after activation):**
- `md5(id/result/win_type ordered by id)` = `6d0c35fc56e3f9acecc54bca603bc771`;
- `md5(id/date/event/weight/round/winner/loser ordered by id)` = `055ef1cf665dc4a1d8cdee5cd76bcae6`.

The exact reproducible SQL for these and for post-model checks is committed at **`supabase/audits/rating_2025_readiness.sql` on the experimental branch**. Its model checks were executed successfully against Supabase: old active model passes balance, history, valid rating states and SOS; the 500-row building model fails completion and balance as expected.

## Phase A — put the expanded BASELINE ratings live first

1. Read `AGENTS.md`, `docs/STATUS.md`, `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/RANKINGS.md`, `docs/DECISIONS.md` and this handoff. Inspect `main`, remote PRs, current Supabase model statuses, and current import hashes before changing anything. Check for concurrent agent work.
2. Use a secure environment already authorized to execute `pnpm`; do not paste or print keys. **Run the baseline from `main`**, not an unreviewed alternative config. Install dependencies with locked versions.
3. Optional preflight (read-only but calculates the entire dataset):
   ```bash
   pnpm ratings:calculate --config config/ratings.production.json --as-of 2026-11-04 --dry-run --out /tmp/ratings-20261104-preflight.json
   ```
   Check expected **67,736 input / 64,050 rated / 11,724 wrestlers**, exclusion report, config hash `1eb854...` and input fingerprint `7a19ca...`. Abort and investigate any source change, unexpectedly different hash, identity count or unfamiliar method.
4. Persist a **fresh candidate, without activation**, using authorized existing owner-local credentials:
   ```bash
   pnpm ratings:calculate --config config/ratings.production.json --as-of 2026-11-04 --force
   ```
   `--force` is needed because the existing partial building model has the same fingerprint. The script creates a new versioned model; it writes 500-row rating batches and 1000-row history batches, then marks the new model `candidate`. Do **NOT** use `--activate`: the CLI two-request switch is not atomic.
5. Capture the **new model UUID** from the calculation output. Run the SQL audit against this UUID. Require **11,724 ratings, 34,809 history points, 11,724 distinct history athletes, 64,050 wins AND 64,050 losses**, zero invalid rating/record/conservative/SOS/history values, `candidate` status, expected config/input hashes. Review rating extremes, W–L distribution, outlier opponents and SOS. Do not mark complete solely because the CLI printed success.
6. Only when all gates pass, atomically activate with existing restricted admin function:
   ```sql
   select private.activate_rating_model('<new-validated-candidate-uuid>'::uuid);
   ```
   This archives the prior active model and activates the target in one transaction; do not broaden grants or create a public activation RPC. Re-run the SQL audit and both raw-source checksums; verify exactly one active model and the old complete model is archived and available for rollback.
7. Verify live https://wrestling-plum.vercel.app (protected app) with authenticated access: wrestler profiles, ranking/tier populations, Glicko rating/RD, conservative values, SOS, club pages, no regressions/timeout, mobile layout, noindex/no-store, and production logs. A database status change alone does not establish UI success.
8. Document actual candidate UUID, report, source hashes, verified counts and deployment/live checks in `docs/STATUS.md` and a release report. Never claim the incomplete building model or a dry run was an activation. Do not delete original source rows.

**Important:** A prior backtest validating daily/decision-0.8 used only the old dataset with calendar 2025 missing. Recheck the chosen baseline's chronological performance on the expanded population and record whether the old confirmation numbers changed; do not pass off the old backtest as a fresh expanded-data result.

## Phase B — evaluate experimental youth recency (separate from Phase A)

- Draft PR **#6** provides optional Glicko process drift; absence of `recency.skillDriftRdPerYear` preserves **exact** production config hash and calculation behavior. The option adds `(d / 173.7178)^2 × periodDays / 365.25` to internal rating variance per period; enabled candidates store `recency.policy=glicko2_continuous_skill_drift` and the existing model keeps its original policy/config hash. This is **additional** to Glicko-2's normal volatility (roughly 199 RD/√year when sigma stays 0.06 with daily periods), **NOT** a literal 12-month half-life; no historical match expires.
- GitHub CI has already passed **136/136 tests**, lint, typecheck and build on initial PR commit; rerun checks after the subsequent diagnostic/audit/handoff commits.
- On `experiment/youth-rating-recency-drift`, run the **read-only** experiment with the exact production config:
  ```bash
  pnpm ratings:recency-backtest --config config/ratings.production.json --out docs/RECENCY_EXPERIMENT_REPORT.md --json docs/RECENCY_EXPERIMENT_REPORT.json --iterations 1000
  ```
- Candidate drift amplitudes are **50 / 100 / 150 / 200 RD/√year**; tune on earlier events, freeze one winner, and evaluate it on untouched later events. Gate: held-out paired event-bootstrap 95% CI for log-loss gain entirely below zero, improvement ≥0.002 log-loss/bout, ECE degradation ≤0.005. Read the new event-concentration and subgroup diagnostic sections; age/weight strata are weak where the source lacks explicit context.
- The recency holdout is separated from its *new* parameter tuning, but the already-deployed daily/decision-0.8 baseline was selected using some overlapping 2026 events. A positive retrospective result is not fully independent of prior model selection; confirm prospectively on future imported tournaments before treating improvement as durable.\n- If it fails, keep the newly expanded **baseline** model. If it passes, review the actual mechanics and changes to wrestler rankings / RD and cohort tiers; create a **new** model version/config and recalculate all 67,736 rows separately, validate in `candidate`, and use guarded activation with rollback. A passing CI test or drift grid is not an authorization to change live ratings.
- Athlete and club lifetime SOS stays as presently defined. **Recent-365-day SOS is a separate product change**, not an input to Glicko and not part of this rating activation; plan a versioned/tested view/metric if added.

## Completion checklist (copy into final report)

- [ ] Full raw source and provenance checked; imported 2025 and the additional Jan 2, 2026 rows accounted for.
- [ ] Baseline CLI matches expected source/config fingerprints and 67,736 / 64,050 / 11,724 / 34,809 counts.
- [ ] Fresh baseline candidate stored completely; per-model invariants and SOS pass.
- [ ] One atomic restricted activation; old model intact and rollback available.
- [ ] Source MD5 hashes unchanged; UI, clubs, cohort ranks, tiers, SOS, privacy headers, logs verified.
- [ ] Expanded-data baseline/backtest results recorded separately from old-dataset 66.2% report.
- [ ] PR #6 recency experiment run on same snapshot; segment and event-dominance limitations reviewed.
- [ ] New recency option adopted **only** if it passes held-out accuracy/calibration and owner review; otherwise unchanged.
- [ ] Docs and PR handoff updated with actual results, report files and outstanding questions.

## If a tool or execution method fails

Do not repeatedly attempt forbidden bulk writes in the connected SQL tool, download or expose privileged credentials, add privileged public RPCs, or mark partial results as complete. Stop safely with the old model active. The exact remaining work and validation evidence are in this handoff and the read-only audit.


## 2026-11-04 — Codex Phase A preflight; execution blocked before writes

Checked GitHub main `d99f0428a102202027876fafe207cf0b8fc2a6fb` and draft PR #6 head `4b1439f6b1fae8621f14fff53c87d64d86ea92be` in a separate checkout. Related Codex chats were idle in the app inventory; no concurrent repository/model writer was observed. No production writes were performed.

Re-executed all eight sections of `supabase/audits/rating_2025_readiness.sql` separately through the authorized Supabase connector: **67,736** raw rows / **199** source files / **35,861** calendar-2025 rows, date range 2024-10-05–2026-10-31; no missing essentials/provenance, repeated source-file/row pairs or strict duplicate groups. Import breakdown confirms the additional 30 calendar-2026 rows. Six OTHER1 outcomes remain unchanged. Both raw MD5s match the handoff: `6d0c35fc56e3f9acecc54bca603bc771` and `055ef1cf665dc4a1d8cdee5cd76bcae6`. Independently reconstructed the existing CLI input-fingerprint algorithm in read-only SQL (C-collated ordered lines and reviewed aliases): **`7a19ca2f486aac6f1889e9f8e28a700115adb7ddb83a213c6e4be17b449101a9`**, exact match.

Exactly one active model remains `d64fd4ba-de14-4d07-bac8-2961e12d506d`: 7,788 ratings / 16,951 history points; 30,133 wins and losses; zero audited invalid record/rating/conservative/SOS/history states. Building `a957ed42-8ee2-4792-944d-5f63a0b4ce72` remains **500 ratings / zero history**, with unbalanced totals; **NEVER activate it**. Inspected the existing atomic activation function: building status is rejected; anon/authenticated EXECUTE privileges are false. No function/grant changes.

Installed locked dependencies and attempted the exact main baseline command with production config, `--as-of 2026-11-04 --force`. It exited before database reads/writes because this fresh environment has no `.env.local` or applicable credential variables. Owner must securely configure the existing local execution credentials (never paste into chat) or identify an already configured environment. No candidate was created; 64,050 / 11,724 / 34,809 remain expected targets, **not freshly calculated or persisted results**. No activation or post-activation live verification has occurred. Phase B full-data backtest remains pending Phase A; no drift adoption.

Main validation: lint, typecheck, **132/132 tests**, optimized build passed (dummy build-only values). Initial Windows checkout CRLF conversion caused the existing generated-SQL byte-equality test to fail; restoring those files directly from committed Git bytes made the suite pass without source changes. PR #6 runtime changes were inspected only, not executed on production data. Resume with Phase A candidate persistence, all audit gates, guarded atomic activation and live/log/privacy checks, then Phase B as specified above.


## 2026-11-04 — connector-only execution results; supersedes credential blocker above

Owner clarified that the existing authorized Supabase connector is the execution authority; **do not request/create/extract local credentials**. Using that connection, exported exactly 67,736 calculation-input rows (67,736 distinct IDs) plus the reviewed alias into a private local scratch snapshot outside the repository. No raw export or complete athlete output is committed. The local fingerprint exactly matches `7a19ca2f486aac6f1889e9f8e28a700115adb7ddb83a213c6e4be17b449101a9`.

### Phase A calculation PASS; persistence BLOCKED by existing unique index

Ran main's unchanged calculation CLI read-only with `--input ../ratings-input.json --config config/ratings.production.json --as-of 2026-11-04 --dry-run`. Then generated the complete persistence payload using the same main engine and the CLI's unchanged model/rating/history field mappings and rounding, replacing only transport with local output. Results: **64,050** rated bouts / **11,724** rating rows / **34,809** history points; total wins **64,050**, total losses **64,050**; production config hash **`1eb854346d016d2c1276d8cc5209f73acac90c433fcc23636743e6a5e1881a67`**. Exclusions: 3,679 administrative outcomes, one self-match, six OTHER1; zero exact duplicate exclusions. Quality threshold 1,737.80 (142 non-provisional athletes); statuses 11,582 provisional / 140 developing / two established.

A fresh **building** metadata insert through the existing administrator connector failed atomically with PostgreSQL **23505**, constraint `rating_models_identical_run_idx`. Verified production definition: UNIQUE on `(config_hash, input_fingerprint, as_of_date, COALESCE(match_cutoff,'1900-01-01'))`. The incomplete building model already occupies that exact key. **The handoff's `--force` instruction is insufficient:** it bypasses the CLI's precheck but cannot bypass this database index. No new model was created and no ratings/history were inserted. Do not retry unchanged, delete/relabel the incomplete model, falsify hashes/dates/cutoff, or activate it. No schema or permission changes were made.

Remaining secure path: review a dedicated new migration and CLI regression test reconciling duplicate-run uniqueness with intentional fresh `--force` calculations while retaining the separate one-active-model guard, immutable prior runs and current grants/RLS. Apply only through the existing administrator authority after review; then persist a genuinely fresh complete candidate, run all stored-data/SOS gates, activate atomically and verify live rankings/profiles/clubs/privacy/logs. Connector-only staged persistence is technically available, but complete bulk persistence has **not** been established because the first metadata insert is blocked. A new credential is neither needed nor an appropriate remedy. Post-activation UI/log checks remain **not run**, because no activation occurred.

Final repeated database audit confirms exactly the original two models: old active remains complete and balanced (7,788 / 16,951 / 30,133 wins and losses); incomplete building remains 500 / zero history. Both raw preservation MD5s remain identical. No source/alias/evidence/model/permission mutation succeeded.

### Read-only full-data evaluation COMPLETE; keep existing formula

Per owner's fallback instruction, continued Phase B read-only despite blocked Phase A persistence. Evaluated original PR runtime head `4b1439f6b1fae8621f14fff53c87d64d86ea92be`; no experimental formula was activated. Reports: [RECENCY_EXPERIMENT_REPORT.md](RECENCY_EXPERIMENT_REPORT.md), [JSON](RECENCY_EXPERIMENT_REPORT.json), [BACKTEST_EXPANDED_REPORT.md](BACKTEST_EXPANDED_REPORT.md), [JSON](BACKTEST_EXPANDED_REPORT.json). Both experiments use the exact same snapshot and 1,000 deterministic event-bootstrap iterations. Tuning dates 2024-12-04 through before 2026-01-17; confirmation from 2026-01-17.

- **Recency:** tuning 40,916 bouts / 129 events. Drift 50/100/150/200 log-loss differences versus actual production settings: **-0.00006886 / -0.00022953 / -0.00037440 / -0.00040505**. All fail required 0.002 improvement; 200 also has a CI crossing zero. No candidate selected, so no drift candidate was evaluated on confirmation or recommended for adoption. Do not select another drift after seeing these results.
- **Production baseline confirmation:** 16,819 bouts / 56 events; accuracy **69.424%**, log loss **0.559318**, Brier **0.191714**, ECE **0.015520**. Largest tuning event 3.20%; largest confirmation event 6.26%. Event-balanced production log loss 0.573821 tuning / 0.564598 confirmation. The 4,476-row Poseidon source is split across event labels (including duals/open); individual-event concentration understates shared-date/source dependence. No drift passed, so this limitation cannot justify adopting one.
- **Segments:** confirmation has 4,229 returning-after-gap bouts (production log loss 0.58763); 6,376 cross-weight-band bouts (0.49718). Only **185** bouts have known age context (82 same / 103 cross); **16,634** unknown. No candidate segment deltas exist because none passed tuning. Experience segment labels in the backtest are not the displayed RD provisional/developing/established labels. Do not claim calibrated age-specific improvement.
- **Expanded original grid:** independently selects the already deployed **daily + decision-0.8** combination versus seven-day binary reference. Confirmation log-loss gain **0.014007**, event-bootstrap 95% CI **[-0.016402,-0.011690]**; reference accuracy 68.200%, log loss 0.573325, ECE 0.024309. This confirms the current formula retrospectively on expanded data; it is not adoption of new drift and is not the earlier 8,146-bout result. Overlap with prior 2026 baseline selection still limits independence; require future tournaments for prospective claims.

Validation on main: 132 tests + lint/typecheck/build pass. Original PR runtime head: **137/137 tests + lint/typecheck/build pass**, builds with dummy values only. No production credential requested/exposed, new RPC, grant expansion, deployment or model activation.


## 2026-11-04 — interrupted-run resume investigation: STOP on provenance mismatch

Compared every one of the 500 stored rows across all 25 persisted payload fields against the main-engine output: **zero differences**. Twenty of 21 calculation metadata fields match; **code_version differs** (`chat-20261104/glicko2-engine-1` versus `glicko2-engine-1`), and historical notes confirm the stored run used a chat JavaScript port. Under the owner's exact-match rule, do not resume/relabel/activate that model. No database writes or uniqueness-index changes were attempted. Source MD5s and both model counts/statuses remain unchanged. [RATING_RECOVERY_INVESTIGATION.md](RATING_RECOVERY_INVESTIGATION.md) records the exhaustive comparison, a proposed genuinely versioned replacement with identical formula and preserved failed-run evidence, and the required idempotent-resume design/regression cases. Replacement and resume implementation/tests are deferred pending review of this mismatch; no implementation or activation is claimed.
