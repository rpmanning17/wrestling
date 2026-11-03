# CLAUDE.md

Instructions for Claude working in this repository. `AGENTS.md` holds the rules shared with ChatGPT/Codex; read it too. The Next.js notice in `AGENTS.md` applies: this Next.js version has breaking changes, so read `node_modules/next/dist/docs/` before writing framework code.

## Start here

1. Read `docs/STATUS.md`, then `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/RANKINGS.md`, `docs/DECISIONS.md`.
2. Run `git log --oneline -20` and `git status`. Check whether another agent has open work before you start. Reconcile, do not duplicate.
3. Confirm what the session can actually reach. Sessions often cannot reach Supabase, Vercel or GitHub; say so, finish the safe repository work, and tell the owner exactly which action only they can do.

## Working rules specific to Claude sessions

- Chat context does not persist. Anything a future agent needs (assumptions, audit results, open questions, decisions) must be written to the docs in the same PR.
- State confidence and mark unverified production facts as unverified. Do not guess database contents; query them, or provide a read-only SQL file (see `supabase/audits/`).
- Keep the owner's attribution trailers on commits and PRs as configured by the session.
- Ask the owner a question only when a decision genuinely needs their input; otherwise make a conservative assumption, document it in `docs/DECISIONS.md`, and continue.
- Never paste or commit secrets. Writing ratings needs `SUPABASE_SERVICE_ROLE_KEY`; it belongs only in the owner's local environment.

## Commands

```
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm ratings:calculate --dry-run     # see AGENTS.md / README.md for all rating commands
pnpm ratings:backtest
```

`pnpm build` needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PERSONAL_APP_KEY` set (dummy values are fine for a compile check).

## Where things live

- UI: `src/app/` (`compare-builder.tsx`, `rankings/`, `results/`, server actions).
- Data access for profiles: `src/lib/scouting.ts`; legacy score heuristic: `src/lib/scoring.ts`.
- Rating engine (pure TypeScript, no I/O): `src/lib/rating/`. Batch CLIs: `scripts/ratings/`.
- Tests: `tests/rating/`, `tests/db/` (applies every migration to an in-process Postgres).
- Migrations: `supabase/migrations/`. Read-only audit SQL: `supabase/audits/`.
