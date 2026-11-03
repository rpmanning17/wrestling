# Status

Last updated: 2026-11-03, club analytics and search work-in-progress. Production remains on main unless confirmed otherwise.

## Current work, not yet in production
- **PR #1**: opponent-adjusted ratings, Glicko-2 engine, SOS, UI fallback and tests on `claude/opponent-adjusted-ratings-and-docs`. The temporary PR description file was removed; PR is open as draft.
- **Feature branch `feature/florida-club-analytics`**: adds `202611030010_club_aliases_and_rankings.sql`, event-specific club records, club profiles, rankings, club comparisons, navigation, and live athlete autocomplete with age group / bracket weight / team. Migration 010 was tested in a rollback transaction and **applied to production Supabase** as version `20261103223232` (`create_club_aliases_and_rankings`); it creates only new club objects and leaves matches and legacy views untouched. Supabase security advisors returned no findings.
- The separate `feature/athlete-search-autocomplete` branch was created before implementation; the autocomplete is now integrated into the club feature branch.
- **No opponent-adjusted model is active**; until one is calculated and activated, club power/SOS fields intentionally show a dash rather than guessed values.
- **Vercel preview blocker**: `git_info_fail` when pulling GitHub refs. An attempt to link the existing repository reported that the Vercel account needs a GitHub Login Connection, and the Vercel Git namespace list was empty. Production `main` is still serving its last READY deployment. Do not recreate the Vercel project.

## What is live in production (as last known)

Last known production commit: `9dbe59a` ("Canonicalize saved comparison aliases"). Working: wrestler search, comparison builder, results browser, add-missing-bout, saved comparisons, notes, rankings page, alias resolution, legacy heuristic strength and cohort rank, evidence-based age/weight inference, tournament placements. The ratings in production are the **legacy heuristic**.

## Implemented in the repository, not in production

The Glicko-2 components below exist on `claude/opponent-adjusted-ratings-and-docs` (and are inherited by the club feature branch). They are not merged or deployed. The database migration is applied (below); the code that uses it is not deployed.

| Area | State |
|---|---|
| Glicko-2 engine (`src/lib/rating/`) | Implemented; unit-tested including the paper's worked example |
| Batch calculation CLI | Implemented; works offline and against Supabase; writes versioned models; **never run against production** |
| Backtest and tuning CLI | Implemented; **never run against production** (`docs/BACKTEST_REPORT.md` is a placeholder) |
| Migration `202611030009` (rating tables, views, activation function) | **Applied to production 2026-11-03** via a Supabase migration (recorded as version `20261103174437`, name `create_versioned_opponent_adjusted_ratings`). Reported by the main session: 4 new tables with RLS and 1 policy each, both views `security_invoker`, security advisors clean. This session confirmed the migration entry with `list_migrations`. **No rating model exists yet**, so the site still uses the legacy ratings |
| UI: power rating ± RD, conservative score, status chip, rating details, head-to-head, common opponents | Implemented with legacy fallback; compiled and type-checked; **not viewed against live data** |
| Docs set and PR template | On the branch |
| Audit SQL test (`tests/db/match-audit.test.ts`) and audit queries 0 and 8 | On the branch; audit **run against production 2026-11-03** (results below) |
| GitHub PR | #1 opened in draft, awaiting integration/preview verification |

Verification re-run 2026-11-03 in the second session (fresh `pnpm install --frozen-lockfile`, Node 22): `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` 93 passing (91 earlier plus 2 audit-SQL tests), `pnpm build` with dummy env vars succeeds. That session had a working Vercel connector but no GitHub API access (connector and `gh` token both rejected) and no Supabase connector, so the PR is not opened and no production step was done.

First-session verification: `pnpm lint` (clean), `pnpm typecheck` (clean), `pnpm test` (91 passing: rating math, preparation, leakage, backtests, relations, migration/RLS), `pnpm build` with dummy environment variables (succeeds). The CLIs ran offline on a synthetic export. No live Supabase, Vercel or GitHub access was available, so none of the production steps below were done or verified.

## Not implemented

- Club rankings beyond the initial implemented depth, elite-strength, participation and SOS views: causal development analysis and age/weight-specific club strength remain future refinements.
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
- Potential same-opponent repeated records are **not verified duplicates**. Many have blank round labels and some source CSVs contain opposite wins in distinct source rows, consistent with genuine rematches. Do not suppress both results just because the pair matches (D19); only exact identical row signatures are currently removed.
- Self-matches (12) are already excluded by the pipeline.
- The README's earlier 31,177 was stale; the extra 668 bouts are the 2026-10-31 event.
- The 2025 gap means every wrestler active in both 2024 and 2026 returns from more than a year of inactivity; their ratings rely on the inactivity (RD growth) policy.
- Migration file names in `supabase/migrations/` do not match the versions recorded in production for 10 of 13 migrations (for example `202611030009_…` is `20261103174437` in production). Migrations have been applied through the Supabase connector, which records its own timestamp. `supabase db push` from this repo would therefore treat them as unapplied; do not use it without first reconciling (`supabase migration repair`) or renaming in a dedicated change.

## Other known limitations

- Rating defaults (k, status thresholds, tau, period) are not calibrated to real data.
- Opponent-strength metrics use current ratings (explanatory).

## Next steps

1. Verify GitHub login connection for the existing Vercel project, then require a successful preview build of the latest feature commit.
2. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` in an authenticated development environment. Migration 010 has already been parsed and executed successfully under a rollback-only production database test.
3. ~~Review and apply migration 010~~ done 2026-11-03; no `supabase db push` against unreconciled migration history.
4. Merge approved PRs in dependency order. Verify new pages on a phone. Leave the legacy ratings active until the walk-forward real-data backtest and model activation are explicitly validated.
5. Reconcile club identity candidates through confirmed aliases only; do not merge Spartan RTC with LHP or unrelated Alpha organizations without evidence.
