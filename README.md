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

Match results live in `public.matches`. As of the 2026-11-03 audit the database holds 31,845 bouts dated 2024-10-05 to 2026-10-31: 11,647 in the 2024–2025 season (October 5 to December 30, 2024), 11,238 in 2025–2026 (January 4 to July 26, 2026) and 8,960 in 2026–2027 (from August 2026; 668 of them, all from 2026-10-31, carry the label `2026-2027` with a hyphen instead of an en dash). There are no bouts from calendar 2025. The earlier figure of 31,177 predates the 2026-10-31 event. The 2026 import assigns January–July bouts to the 2025–2026 season and August–October to 2026–2027, and excludes BYEs, rows without a named opponent, and exact duplicate rows. Known data-quality issues (near-duplicates, swapped records, club-label variants) are listed in [`docs/STATUS.md`](docs/STATUS.md). Each row keeps its source file and row number so a repeat import is idempotent.

Source ZIPs and CSV contents are intentionally not committed. The match CSV importer is **not** in this repository; only the tournament-observation importer is (`supabase/importers/`). See [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md).

## Ratings

Two rating systems exist side by side:

- **Legacy heuristic** (`public.wrestler_ratings` view, `src/lib/scoring.ts`): win rate, placement, finishing, recency and volume. It ignores opponent quality. It remains available as fallback when no model is active.
- **Opponent-adjusted Glicko-2** (migration `202611030009`, `src/lib/rating/`, `scripts/ratings/`): rating, rating deviation (uncertainty), conservative score, provisional status, strength-of-schedule explanations and chronological backtesting. **Live and active as of 2026-11-03:** `glicko2-daily-dec08-v1`, 7,788 wrestlers from 30,133 contested bouts. Daily periods and decision score 0.8 passed real-data held-out validation. Use `config/ratings.production.json` for recalculation; see `docs/RATING_ACTIVATION.md` for results and the secure activation procedure. See [`docs/STATUS.md`](docs/STATUS.md).

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
pnpm ratings:calculate --config config/ratings.production.json # write candidate; review, then activate atomically through restricted SQL function
pnpm ratings:backtest                         # chronological, leakage-free evaluation -> docs/BACKTEST_REPORT.md
```

Writing a model needs `SUPABASE_SERVICE_ROLE_KEY` in your **local** environment only. Reads use the same personal-app credentials as the site.

## Database migrations

Schema changes happen only through version-controlled files in `supabase/migrations/`. Never edit the database by hand without a matching migration, and never edit an applied migration; add a new one.

| Migration | Purpose | Applied to production |
|---|---|---|
| `202610250001_private_results` | initial owner-based schema | yes |
| `20261025212304_personal_app_access` | personal-app access model | yes |
| `20261025212902_optimize_personal_access_policy` | server-key check in a security-invoker function | yes |
| `20261025220936_create_private_matches` | `matches` table used by imports | yes |
| `202611030001`–`202611030008` | tournament entries, birth-year naming, notes, evidence + legacy ratings, observations, aliases | recorded as applied by the owner; verify with `supabase migration list` |
| `202611030009_create_versioned_opponent_adjusted_ratings` | versioned rating tables and views | **yes**, production version `20261103174437` |

Do not re-run applied migrations on the linked project.

## Deployment

The production deployment is protected by Vercel Authentication. Required Production variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_PERSONAL_APP_KEY` (encrypted, server-only). Preview deployments intentionally have no production database variables.

## Data handling

Result data comes from publicly available wrestling sites. The repository contains application code and migrations; result archives and imported records stay outside GitHub. Results are historical context, not a prediction of a future match.


Current age/weight estimates use three distinct recent events (50/30/20), shared across search, comparisons and active rankings. Bracket labels are estimates, not bodyweight; optional verified entry weigh-ins take priority. Named duals have half classification influence. See docs/DECISIONS.md D25 and docs/DATA_MODEL.md for exact rules.
