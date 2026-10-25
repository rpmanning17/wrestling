# Mat Notes

A private, personal youth wrestling results notebook built with Next.js, Supabase, and Vercel.

## Current setup

- Live site: https://wrestling-plum.vercel.app
- Source: https://github.com/rpmanning17/wrestling
- Supabase project: https://supabase.com/dashboard/project/tprodwivvwvpmpzaedom
- There is no application login, signup, password, or Supabase user account.
- Vercel Authentication is the single private entrance to the site.
- The browser never receives the database access key. Next.js sends it from the server to Supabase.
- Supabase row-level security rejects direct reads and writes that do not have that server-only key.
- Production database variables are scoped to Vercel Production only.
- Responses are private/no-store and carry no-index, no-referrer, no-sniff, and frame-denial headers.
- No athlete records, credentials, database exports, or secret values are stored in this repository.

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
- `20261025212304_personal_app_access.sql` converts the empty database to the personal-app model: it removes account ownership, grants the minimum Data API permissions to `anon`, and requires the private server header through RLS.
- `20261025212902_optimize_personal_access_policy.sql` keeps that check in a private, security-invoker function so it runs once per request.

All migrations are already applied to the linked Supabase project. Do not run them again there.

## Deployment

The current production deployment is protected by Vercel Authentication. Keep that protection enabled: no-index headers are not access control.

The required Production variables are:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_PERSONAL_APP_KEY` (encrypted/server-only)

Preview deployments intentionally have no production database variables. A future GitHub connection is optional; the current deployment can be updated directly.

## Privacy

The GitHub repository is currently public, but it contains code only. Keep names, imported result files, screenshots, exports, and credentials out of commits, issues, and build logs. You may still make the repository private in GitHub settings if you prefer.

Use aliases where practical. Store only necessary result information and sources you are permitted to use. Do not store birthdates, addresses, contact details, medical details, or photos. Delete stale or incorrect records. Supabase backups may retain deleted data for the project's configured retention period.

Results are historical context, not a prediction or assessment of a child.
