# Mat Notes

A personal, mobile-first Florida youth wrestling scouting site: look up wrestlers, compare a bracket, read results, placements and age/weight evidence, rank opponents, and keep scouting notes. Built with Next.js (App Router), Supabase (Postgres) and Vercel.

**This repository is the authoritative record of the project.** Chat histories are not. Humans, Claude and ChatGPT/Codex all start from the documents below. Before changing anything, read them in this order:

1. [`docs/STATUS.md`](docs/STATUS.md) – what exists right now, what is unverified, what is next.
2. [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) – what the product must do and the rules that must not be broken.
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) – how the code, database and rating pipeline fit together.
4. [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) – tables, views, identity resolution, age/weight inference.
5. [`docs/RANKINGS.md`](docs/RANKINGS.md) – the rating methodology (Glicko-2) and how outcomes are represented.
6. [`docs/DECISIONS.md`](docs/DECISIONS.md) – why things are the way they are.

Agent-specific instructions: [`AGENTS.md`](AGENTS.md) (coding agents in general, including Codex) and [`CLAUDE.md`](CLAUDE.md) (Claude).

## Current setup

- Live site: https://wrestling-plum.vercel.app
- Source: https://github.com/rpmanning17/wrestling
- Supabase project: https://supabase.com/dashboard/project/tprodwivvwvpmpzaedom
- There is no application login, signup, password, or Supabase user account.
- Vercel Authentication controls access to the deployed site; responses also carry `noindex` and `no-store` headers (`src/proxy.ts`).
- The browser never receives the database access key. Next.js sends it from the server to Supabase.
- Supabase row-level security rejects direct reads and writes that do not carry that server-only key.
- Production database variables are scoped to Vercel Production only.
- No credentials, database exports, or raw result archives are stored in this repository.

## Data

Match results live in `public.matches`. The verified November 4, 2026 snapshot contains 67,736 source rows, including 35,861 calendar-2025 bouts and 30 additional January-2026 bouts. The active canonical model rates 64,050 contested bouts across 11,724 wrestlers, with 34,809 history points. Each source file/row pair is unique for idempotent import. Known identity, rematch and source-label limitations remain; see [docs/RATING_RECOVERY_RELEASE.md](docs/RATING_RECOVERY_RELEASE.md).

Source ZIPs and CSV contents are intentionally not committed. The repository has an **offline staging tool for normalized Mat Notes match CSVs** (`pnpm matches:prepare`), not a raw Flo/Trackwrestling-to-normalized converter. The tournament-observation builder is separate (`supabase/importers/`). See [MATCH_IMPORT_READINESS](docs/MATCH_IMPORT_READINESS.md). Reviewed club normalization and the finite Scorpions/Kongkrete catch-up are live; see [CLUB_NORMALIZATION](docs/CLUB_NORMALIZATION.md).

The person-identity branch implements agent-reviewed wrestler UUIDs, reversible assignments for each source appearance, and person-based search, profiles, comparisons, rankings, cohorts and club reads. Matching happens offline through `scripts/identity/`; the app has no matching screen. These additions are not live until the additive migrations, supervised assignment/candidate rollout, app deployment and separately authorized model activation are complete. See [identity operations](docs/IDENTITY_OPERATIONS.md).

## Ratings

Two rating systems exist side by side:

- **Legacy heuristic** (`public.wrestler_ratings` view, `src/lib/scoring.ts`): win rate, placement, finishing, recency and volume. It ignores opponent quality. It remains available as fallback when no model is active.
- **Opponent-adjusted Glicko-2** (migration `202611030009`, `src/lib/rating/`, `scripts/ratings/`): rating, uncertainty (RD), conservative score, provisional status, strength-of-schedule and chronological backtesting. **Current active model (2026-11-04):** `glicko2-daily-dec08-canonical-recovery-20261104-v1` (`a29c4460-5e56-4d22-902d-ea39c65bfcac`), based on **67,736 raw bouts / 64,050 rated bouts, 11,724 wrestlers and 34,809 rating-history points**. Existing daily periods and decision weighting 0.8 are unchanged. Recalculation and activation follow the **guarded** [rating operations runbook](docs/RATING_OPERATIONS.md); `scripts/ratings/calculate.ts` is read-only. The initial 7,788-wrestler activation is retained separately as [historical evidence](docs/RATING_ACTIVATION.md).

The site reads the opponent-adjusted views when a model is active and falls back to the legacy view otherwise.

## Local development

Requires Node.js 22+ and pnpm 11.25.0.

1. `pnpm install --frozen-lockfile`
2. Copy `.env.example` to `.env.local` and fill in the Supabase URL, publishable key and the local personal app key that matches the database policy.
3. `pnpm dev`, then open http://localhost:3000.

Checks to run before every pull request:

```
pnpm lint
pnpm typecheck
pnpm test          # rating math, preparation, leakage, backtests, and migration tests (in-process Postgres)
pnpm build
```

Never commit `.env.local`, and never put `SUPABASE_PERSONAL_APP_KEY` or any service-role key in a `NEXT_PUBLIC_` variable.

### Rating commands

```
pnpm ratings:calculate --config config/ratings.production.json --dry-run # validated production settings; writes nothing
pnpm ratings:calculate --input export.json --dry-run   # offline, from { "matches": [], "aliases": [] }
node --import tsx scripts/ratings/recovery-export.ts --config config/ratings.production.json --input ../snapshot.json --as-of YYYY-MM-DD --out ../candidate.json # private export; no writes
pnpm ratings:backtest                         # chronological, leakage-free evaluation -> docs/BACKTEST_REPORT.md
```

Candidate writes use the existing authorized administrator connector and guarded batches. The calculation CLI is read-only; `--activate` and `--force` are disabled. Follow [the import/recalculation runbook](docs/RATING_OPERATIONS.md); never create or extract credentials for this workflow.

## Database migrations

Schema changes belong in new reviewed `supabase/migrations/` files; never edit or replay applied migrations. **Production migration history is not yet reconciled:** the [read-only migration audit](docs/MIGRATION_HISTORY_AUDIT.md) maps 23 repository files to 23 production records, with 20 version differences. Do **not** run `supabase db push` or a blind migration repair until the applied SQL has been compared and a safe migration plan verified. Production data and historical migrations have not been changed by that audit.

## Deployment

The production deployment is protected by Vercel Authentication. Required Production variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_PERSONAL_APP_KEY` (encrypted, server-only). Preview deployments intentionally have no production database variables.

## Data handling

`pnpm identity:audit --input C:/private/identity-snapshot.json --report C:/private/identity-report.json --review C:/private/identity-first-25.md` performs a read-only identity audit with private source evidence and review decisions. It never merges people or changes ratings. See [identity audit operations and limitations](docs/IDENTITY_AUDIT.md).

Result data comes from publicly available wrestling sites. The repository contains application code and migrations; result archives and imported records stay outside GitHub. Results are historical context, not a prediction of a future match.


Current age/weight estimates use three distinct recent events (50/30/20), shared across search, comparisons and active rankings. Bracket labels are estimates, not bodyweight; optional verified entry weigh-ins take priority. Named duals have half classification influence. See docs/DECISIONS.md D25 and docs/DATA_MODEL.md for exact rules.


Cohort Tier shows a population decile (1 strongest, 10 weakest) when at least 20 rated wrestlers and unambiguous current cohort support are available. Equal conservative ratings share a tier. Cohort Strength remains 0–1,000; raw Glicko and opponent ratings have no fixed upper limit. Schedule Difficulty is a reference-1,500 expected win percentage: lower means harder opposition. Matchup Likelihood measures relevance/fit, not ability.


Canonical recovery uses `config/ratings.recovery-20261104.json` and the read-only `scripts/ratings/recovery-export.ts`; see [recovery execution](docs/RATING_RECOVERY_RELEASE.md). This is a provenance-only version with the production formula unchanged. Never commit full output or use the legacy CLI activation switch.


## Result ingestion and rating freshness (released 2026-11-04)

`pnpm matches:prepare --input ../private/normalized.csv` validates a **normalized Mat Notes match CSV** offline; add `--out ../private/guarded.sql` to stage reviewable, idempotent administrator SQL. It does NOT connect to Supabase or parse raw Flo CSVs. Do not commit private files or execute generated SQL without source review. See [docs/MATCH_IMPORT_READINESS.md](docs/MATCH_IMPORT_READINESS.md).

A small server-rendered warning on all pages compares the active rating model's source-bout count to the current results table. If counts differ, the app warns that ratings may be stale. Equal counts **do not prove** source/alias freshness (same-count edits are not detected); the full input fingerprint and operational review remain authoritative. Released through merged PR #10. GitHub CI passed 154/154 tests, lint, typecheck and build; Vercel reports the production deployment READY. The warning's actual appearance on authenticated pages has not yet been independently browser-verified.

Read-only production migration-version mapping: [docs/MIGRATION_HISTORY_AUDIT.md](docs/MIGRATION_HISTORY_AUDIT.md). Applied SQL versions are **not yet reconciled**; do not run `supabase db push` until the mapping and actual applied SQL are verified.
