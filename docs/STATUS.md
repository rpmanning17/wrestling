# Status

Last updated: 2026-11-03 by Claude (second session, branch `claude/opponent-adjusted-ratings-and-docs`; commits pushed; PR not yet opened). Update this file whenever functionality completes or priorities change.

## What is live in production (as last known)

Last known production commit: `9dbe59a` ("Canonicalize saved comparison aliases"). Working: wrestler search, comparison builder, results browser, add-missing-bout, saved comparisons, notes, rankings page, alias resolution, legacy heuristic strength and cohort rank, evidence-based age/weight inference, tournament placements. The ratings in production are the **legacy heuristic**.

## Implemented in the repository, not in production

Everything below exists on branch `claude/opponent-adjusted-ratings-and-docs` (pushed to GitHub) and is not merged, migrated or deployed.

| Area | State |
|---|---|
| Glicko-2 engine (`src/lib/rating/`) | Implemented; unit-tested including the paper's worked example |
| Batch calculation CLI | Implemented; works offline and against Supabase; writes versioned models; **never run against production** |
| Backtest and tuning CLI | Implemented; **never run against production** (`docs/BACKTEST_REPORT.md` is a placeholder) |
| Migration `202611030009` (rating tables, views, activation function) | Written; verified in PGlite; **not applied** to Supabase |
| UI: power rating ± RD, conservative score, status chip, rating details, head-to-head, common opponents | Implemented with legacy fallback; compiled and type-checked; **not viewed against live data** |
| Docs set and PR template | On the branch |
| Audit SQL test (`tests/db/match-audit.test.ts`) and audit queries 0 and 8 | On the branch; audit **not yet run against production** |
| PR description draft | `docs/pr/opponent-adjusted-ratings.md`; delete once the PR is opened |

Verification re-run 2026-11-03 in the second session (fresh `pnpm install --frozen-lockfile`, Node 22): `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` 93 passing (91 earlier plus 2 audit-SQL tests), `pnpm build` with dummy env vars succeeds. That session had a working Vercel connector but no GitHub API access (connector and `gh` token both rejected) and no Supabase connector, so the PR is not opened and no production step was done.

First-session verification: `pnpm lint` (clean), `pnpm typecheck` (clean), `pnpm test` (91 passing: rating math, preparation, leakage, backtests, relations, migration/RLS), `pnpm build` with dummy environment variables (succeeds). The CLIs ran offline on a synthetic export. No live Supabase, Vercel or GitHub access was available, so none of the production steps below were done or verified.

## Not implemented

- Club identity normalization and club rankings (planned, see `REQUIREMENTS.md`).
- In-repo match CSV importer (matches are imported outside the repo).
- Any automatic identity merging beyond reviewed aliases.
- Dominance/margin adjustments in the live model (experimental, off).

## Known limitations and unverified facts

- Production `win_type` values, duplicate rates and same-name collisions have not been inspected. Run `supabase/audits/match_outcome_audit.sql`.
- Known classifier gaps (spellings returned as `unknown`, so excluded) are listed in `DECISIONS.md` D16; fix only what the audit finds.
- Same bout recorded with winner and loser swapped is rated twice (audit query 8); weight labels like `100 (14U)` lose the bracket weight (audit query 7). Neither is handled yet.
- README previously stated 31,177 bouts; not re-verified. Other notes mention a different count; reconcile with `select count(*) from matches`.
- No 2025 season data in the imports, which makes long-inactive ratings rely on the inactivity policy.
- Rating defaults (k, status thresholds, tau, period) are not calibrated to real data.
- Opponent-strength metrics use current ratings (explanatory).

## Next priorities (owner actions first)

1. Open the PR from `docs/pr/opponent-adjusted-ratings.md` and review it (needs the GitHub connector reconnected for an agent session).
2. Run `supabase/audits/match_outcome_audit.sql` in the Supabase SQL editor; update `src/lib/rating/outcomes.ts` for any unrecognized `win_type`; record the findings here.
3. Apply `202611030009_create_versioned_opponent_adjusted_ratings.sql` (Supabase CLI or SQL editor).
4. `pnpm ratings:calculate --dry-run`, review exclusions and top lists; then with `SUPABASE_SERVICE_ROLE_KEY` set **only in your local environment**, `pnpm ratings:calculate` (candidate), inspect, then `--activate`.
5. `pnpm ratings:backtest`; commit the generated `docs/BACKTEST_REPORT.md`; adopt any default change only per the rule in `RANKINGS.md`, and record it in `DECISIONS.md`.
6. Deploy on Vercel and check the compare page and rankings on a phone: power rating, RD, status, fallback behaviour if no model is active.
7. Design club identity normalization and club rankings (separate PR, separate decision entry).
