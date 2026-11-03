# Status

Last updated: 2026-11-03 by Claude (second session, branch `claude/opponent-adjusted-ratings-and-docs`; commits pushed; PR not yet opened; production audit and migration 009 done from the owner's main session). Update this file whenever functionality completes or priorities change.

## What is live in production (as last known)

Last known production commit: `9dbe59a` ("Canonicalize saved comparison aliases"). Working: wrestler search, comparison builder, results browser, add-missing-bout, saved comparisons, notes, rankings page, alias resolution, legacy heuristic strength and cohort rank, evidence-based age/weight inference, tournament placements. The ratings in production are the **legacy heuristic**.

## Implemented in the repository, not in production

Everything below exists on branch `claude/opponent-adjusted-ratings-and-docs` (pushed to GitHub) and is not merged or deployed. The database migration is applied (below); the code that uses it is not deployed.

| Area | State |
|---|---|
| Glicko-2 engine (`src/lib/rating/`) | Implemented; unit-tested including the paper's worked example |
| Batch calculation CLI | Implemented; works offline and against Supabase; writes versioned models; **never run against production** |
| Backtest and tuning CLI | Implemented; **never run against production** (`docs/BACKTEST_REPORT.md` is a placeholder) |
| Migration `202611030009` (rating tables, views, activation function) | **Applied to production 2026-11-03** via a Supabase migration (recorded as version `20261103174437`, name `create_versioned_opponent_adjusted_ratings`). Reported by the main session: 4 new tables with RLS and 1 policy each, both views `security_invoker`, security advisors clean. This session confirmed the migration entry with `list_migrations`. **No rating model exists yet**, so the site still uses the legacy ratings |
| UI: power rating ± RD, conservative score, status chip, rating details, head-to-head, common opponents | Implemented with legacy fallback; compiled and type-checked; **not viewed against live data** |
| Docs set and PR template | On the branch |
| Audit SQL test (`tests/db/match-audit.test.ts`) and audit queries 0 and 8 | On the branch; audit **run against production 2026-11-03** (results below) |
| PR description draft | `docs/pr/opponent-adjusted-ratings.md`; delete once the PR is opened |

Verification re-run 2026-11-03 in the second session (fresh `pnpm install --frozen-lockfile`, Node 22): `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` 93 passing (91 earlier plus 2 audit-SQL tests), `pnpm build` with dummy env vars succeeds. That session had a working Vercel connector but no GitHub API access (connector and `gh` token both rejected) and no Supabase connector, so the PR is not opened and no production step was done.

First-session verification: `pnpm lint` (clean), `pnpm typecheck` (clean), `pnpm test` (91 passing: rating math, preparation, leakage, backtests, relations, migration/RLS), `pnpm build` with dummy environment variables (succeeds). The CLIs ran offline on a synthetic export. No live Supabase, Vercel or GitHub access was available, so none of the production steps below were done or verified.

## Not implemented

- Club identity normalization and club rankings (planned, see `REQUIREMENTS.md`).
- In-repo match CSV importer (matches are imported outside the repo).
- Any automatic identity merging beyond reviewed aliases.
- Dominance/margin adjustments in the live model (experimental, off).

## Production data facts and known data-quality issues

Production audit, 2026-11-03 (`supabase/audits/match_outcome_audit.sql`, read-only, project `tprodwivvwvpmpzaedom`, run from the owner's main session):

- 31,845 bouts, 2024-10-05 to 2026-10-31, none future-dated.
- `win_type`: F 18,393; DEC 4,666; TF 4,218; MD 2,857; FOR 1,341; DEF 150; M FOR 150; DQ 31; MFFL 19; NC 19; OTHER1 1. Every value except OTHER1 is recognized by `outcomes.ts`; no hyphenated, dotted or other variant spellings exist. OTHER1 is one 0-0 bout (Juggernaut Wellington Qualifier, 2026-08-22, weight 52), correctly excluded as unknown.
- Seasons: `2024–2025` 11,647; `2025–2026` 11,238 (2026-01-04 to 2026-07-26); `2026–2027` (en dash) 8,292; `2026-2027` (hyphen) 668, all dated 2026-10-31. The two 2026–27 labels are an import inconsistency; ratings ignore `season`, but anything grouping by season splits that season in two.
- No bouts between 2024-12-30 and 2026-01-04: calendar 2025 is entirely missing.
- Possible duplicates (same date, event, weight class, round and participants): 261 groups, 262 extra rows.
- Swapped records (same bout with winner and loser reversed): 65 pairs.
- Self-matches (winner name = loser name): 12.
- Unparseable or out-of-range weight labels: 139, nearly all HWT-style labels with no number.
- Names seen under more than one club label: 2,439 of 7,797 distinct names (31%). Likely mostly club-name variants and club switches rather than different people, but not separated; this is the main evidence for club normalization (not built).

Consequences and open issues:

- The classifier stays unchanged (`DECISIONS.md` D18); the spellings in D16 do not occur.
- Swapped records (65 pairs) are both rated today; the 262 duplicate extra rows are rated unless they also match on result and method. Proposal to drop them: `DECISIONS.md` D19 (proposed, not implemented).
- Self-matches (12) are already excluded by the pipeline.
- The README's earlier 31,177 was stale; the extra 668 bouts are the 2026-10-31 event.
- The 2025 gap means every wrestler active in both 2024 and 2026 returns from more than a year of inactivity; their ratings rely on the inactivity (RD growth) policy.
- Migration file names in `supabase/migrations/` do not match the versions recorded in production for 10 of 13 migrations (for example `202611030009_…` is `20261103174437` in production). Migrations have been applied through the Supabase connector, which records its own timestamp. `supabase db push` from this repo would therefore treat them as unapplied; do not use it without first reconciling (`supabase migration repair`) or renaming in a dedicated change.

## Other known limitations

- Rating defaults (k, status thresholds, tau, period) are not calibrated to real data.
- Opponent-strength metrics use current ratings (explanatory).

## Next priorities (owner actions first)

1. Owner opens the PR from the branch link using `docs/pr/opponent-adjusted-ratings.md` as the description, then deletes that file; review and merge.
2. ~~Run the outcome audit~~ done 2026-11-03 (above). ~~Apply migration 009~~ done 2026-11-03.
3. Decide D19 (drop swapped and conflicting duplicate records in the rating pipeline).
4. On the owner's computer (the cloud session has no read key): `pnpm ratings:calculate --dry-run`, review exclusions and top lists; then with `SUPABASE_SERVICE_ROLE_KEY` set **only in your local environment**, `pnpm ratings:calculate` (candidate), inspect, then `--activate`.
5. `pnpm ratings:backtest`; commit the generated `docs/BACKTEST_REPORT.md`; adopt any default change only per the rule in `RANKINGS.md`, and record it in `DECISIONS.md`.
6. Deploy on Vercel and check the compare page and rankings on a phone: power rating, RD, status, fallback behaviour if no model is active.
7. Design club identity normalization and club rankings (separate PR, separate decision entry).
