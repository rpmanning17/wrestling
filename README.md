# Mat Notes
Private youth wrestling results notebook built with Next.js App Router, TypeScript, and Supabase. Deploys on Vercel.

## Included
- Password sign-in; no self-registration UI.
- Add, search by athlete and season, and delete match records.
- Supabase row-level security (RLS): each authenticated adult account can access only its own records, including direct API requests.
- Signed-out users see no results. Missing configuration shows a setup screen.
- Private, no-store response headers; no-index metadata; no analytics.
- No real athlete records, credentials, or database exports in this repository.

## Local setup
Requires Node.js 22+ and pnpm 11.25.0 (packageManager is pinned).
1. Run `pnpm install --frozen-lockfile`.
2. Copy `.env.example` to `.env.local`.
3. Fill in your Supabase project URL and **publishable** key from the project's Connect dialog / API settings. These are public identifiers; RLS protects data. Never use a secret or service-role key in this app.
4. Run `pnpm dev` and open http://localhost:3000.
5. Checks: `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build`.

## Supabase: first-time setup
1. Create a dedicated project at https://supabase.com/dashboard. Choose your organization and region and review the plan/cost before creation. Keep the database password in a password manager.
2. In SQL Editor, execute `supabase/migrations/202610250001_private_results.sql` once, or apply it through the Supabase CLI migration workflow.
3. In Authentication settings, disable **Allow new users to sign up**, anonymous sign-ins, and unused providers. Do this before putting data into the app. A hidden sign-up screen alone does not prevent API registration.
4. In Authentication > Users, create your adult account with an owner-assigned password (Add user > Create new user); mark the email confirmed only after verifying it yourself. Use this password to sign in. The current app does not implement invitation-link callbacks or self-service password recovery. Use dashboard account management for initial access and resets. Do not send invitation links expecting this app to complete them.
5. Additional adult accounts have separate notebooks. Shared family workspaces are not implemented.
6. Set Site URL to your eventual production domain. Do not allow wildcard preview redirect URLs. Password sign-in itself does not need a redirect callback.

## Vercel deployment
1. Publish the source to https://github.com/rpmanning17/wrestling.
2. At https://vercel.com/new, import that repository. If GitHub access is requested, grant Vercel access to this repository.
3. Select Next.js, repository root, default build/output settings. Vercel uses the pinned pnpm version and lockfile.
4. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` under project environment variables for Production only, then deploy.
5. Preview deployments can safely show the setup screen with no environment variables. Use a separate Supabase test project with synthetic records if previews need data. Never connect previews to real minors' records.
6. Verify sign-in and RLS before entering real records. After changing environment variables, redeploy.
7. Enable Vercel Deployment Protection for previews where available. Application authentication and RLS protect records regardless of the hosting URL.

No Vercel access token or Supabase service-role key is needed by the app.

## Privacy and data handling
The GitHub repository is currently public. Consider changing it to private in GitHub Settings > General > Danger Zone > Change visibility. Code can be public safely only if it contains no records or secrets. Keep names, result imports, screenshots, logs, and exports out of issues, commits, and build logs.
Use aliases where possible. Store only necessary event information and result sources you have permission to use. Do not store birthdates, addresses, contact details, medical details, or photos. No scraping or bulk import is included.
Delete stale or incorrect records with the Delete button. Deleting an auth account cascades removal of its records; Supabase backups may retain copies under your project's retention policy. Review your retention and correction process before collecting data.
No-index instructions reduce discovery but are not access control. Database RLS and verified server-side sessions enforce access.
Results are historical context, not a prediction or assessment of a child.

## Required live acceptance checks
Use synthetic aliases only:
1. Signed-out visit to / redirects to /login once configured.
2. Create adult test accounts A and B in Supabase.
3. As A, save a synthetic match; verify search by athlete/season and delete.
4. As B, confirm A's records are absent. Attempt direct API select/update/delete against A's record using B's token: reads must return no rows and writes must change no rows. Attempt to insert a row with A's owner_id using B's token: must fail.
5. Use the publishable key without an authenticated token: public.results reads/writes must fail.
6. Log out; revisit / and use browser back/reload; no data should remain available.
7. Confirm new-user API registration is disabled.
These checks require a configured Supabase project and cannot be replaced by a successful Next.js build.

## References
- https://supabase.com/docs/guides/auth/server-side/creating-a-client
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://vercel.com/docs/frameworks/full-stack/nextjs
