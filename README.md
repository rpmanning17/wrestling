# Mat Notes

A personal Florida youth wrestling results index built with Next.js, Supabase, and Vercel.

## Current setup

- Live site: https://wrestling-plum.vercel.app
- Source: https://github.com/rpmanning17/wrestling
- Supabase project: https://supabase.com/dashboard/project/tprodwivvwvpmpzaedom
- There is no application login, signup, password, or Supabase user account.
- Vercel Authentication controls access to the deployed site.
- The browser never receives the database access key. Next.js sends it from the server to Supabase.
- Supabase row-level security rejects direct reads and writes that do not have that server-only key.
- Production database variables are scoped to Vercel Production only.
- No credentials, database exports, or raw result archives are stored in this repository.

## Imported data

The database contains 31,177 distinct bouts:

- 11,647 bouts from 38 CSV files dated October 5 through December 30, 2024.
- 19,530 bouts from 64 CSV files dated January 4 through October 24, 2026.

The 2026 import assigns January–July bouts to the 2025–2026 season and August–October bouts to the 2026–2027 season. It excludes BYEs, rows without a named opponent, and 465 exact duplicate rows repeated across the source files.

Each imported row keeps its source archive, source filename, and source row number in the database so a repeat import is idempotent. Source ZIPs and CSV contents are intentionally not committed to GitHub.

## Local development

Requires Node.js 22+ and pnpm 11.25.0.

1. Run `pnpm install --frozen-lockfile`.
2. Copy `.env.example` to `.env.local`.
3. Add the Supabase project URL, publishable key, and a local personal app key that matches the database policy.
4. Run `pnpm dev` and open http://localhost:3000.
5. Check with `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build`.

Never commit `.env.local` or put `SUPABASE_PERSONAL_APP_KEY` in a `NEXT_PUBLIC_` variable.

## Database migrations

- `202610250001_private_results.sql` created the initial owner-based schema.
- `20261025212304_personal_app_access.sql` converted the empty database to the personal-app model.
- `20261025212902_optimize_personal_access_policy.sql` moved the server-key check into a security-invoker function.
- `20261025220936_create_private_matches.sql` replaced the empty one-sided results table with the match-oriented schema used by the imports.

All migrations are already applied to the linked Supabase project. Do not run them again there.

## Deployment

The current production deployment is protected by Vercel Authentication.

The required Production variables are:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_PERSONAL_APP_KEY` (encrypted/server-only)

Preview deployments intentionally have no production database variables. The current deployment can be updated directly.

## Data handling

The result data comes from publicly available wrestling sites. The GitHub repository contains application code and database migrations, while the result archives and imported records remain outside GitHub.

Results are historical context, not a prediction of a future match.
