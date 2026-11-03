# Status

Last updated: 2026-11-03 by Claude (session on branch work; commits not yet pushed). Update this file whenever functionality completes or priorities change.

## What is live in production (as last known)

Last known production commit: `9dbe59a` ("Canonicalize saved comparison aliases"). Working: wrestler search, comparison builder, results browser, add-missing-bout, saved comparisons, notes, rankings page, alias resolution, legacy heuristic strength and cohort rank, evidence-based age/weight inference, tournament placements. The ratings in production are the **legacy heuristic**.

## Implemented in the repository, not in production

Everything below exists on the working branch only until it is pushed, migrated and deployed.

| Area | State |
|---|---|
| Glicko-2 engine (`src/lib/rating/`) | Implemented; unit-tested including the paper's worked example |
| Batch calculation CLI | Implemented; works offline and against Supabase; writes versioned models; **never run against production** |
| Backtest and tuning CLI | Implemented; **never run against production** (`docs/BACKTEST_REPORT.md` is a placeholder) |
| Migration `202611030009` (rating tables, views, activation function) | Written; verified in PGlite; **not applied** to Supabase |
| UI: power rating ± RD, conservative score, status chip, rating details, head-to-head, common opponents | Implemented with legacy fallback; compiled and type-checked; **not viewed against live data** |
| Docs set and PR template | This change |

Verification actually run in the build environment: `pnpm lint` (clean), `pnpm typecheck` (clean), `pnpm test` (91 passing: rating math, preparation, leakage, backtests, relations, migration/RLS), `pnpm build` with dummy environment variables (succeeds). The CLIs ran offline on a synthetic export. No live Supabase, Vercel or GitHub access was available, so none of the production steps below were done or verified.

## Not implemented

- Club identity normalization and club rankings (planned, see `REQUIREMENTS.md`).
- In-repo match CSV importer (matches are imported outside the repo).
- Any automatic identity merging beyond reviewed aliases.
- Dominance/margin adjustments in the live model (experimental, off).

## Known limitations and unverified facts

- Production `win_type` values, duplicate rates and same-name collisions have not been inspected. Run `supabase/audits/match_outcome_audit.sql`.
- README previously stated 31,177 bouts; not re-verified. Other notes mention a different count; reconcile with `select count(*) from matches`.
- No 2025 season data in the imports, which makes long-inactive ratings rely on the inactivity policy.
- Rating defaults (k, status thresholds, tau, period) are not calibrated to real data.
- Opponent-strength metrics use current ratings (explanatory).

## Next priorities (owner actions first)

1. Push the commits (link the GitHub account to the session, or push from a local clone) and review the PR.
2. Run `supabase/audits/match_outcome_audit.sql` in the Supabase SQL editor; update `src/lib/rating/outcomes.ts` for any unrecognized `win_type`; record the findings here.
3. Apply `202611030009_create_versioned_opponent_adjusted_ratings.sql` (Supabase CLI or SQL editor).
4. `pnpm ratings:calculate --dry-run`, review exclusions and top lists; then with `SUPABASE_SERVICE_ROLE_KEY` set **only in your local environment**, `pnpm ratings:calculate` (candidate), inspect, then `--activate`.
5. `pnpm ratings:backtest`; commit the generated `docs/BACKTEST_REPORT.md`; adopt any default change only per the rule in `RANKINGS.md`, and record it in `DECISIONS.md`.
6. Deploy on Vercel and check the compare page and rankings on a phone: power rating, RD, status, fallback behaviour if no model is active.
7. Design club identity normalization and club rankings (separate PR, separate decision entry).
