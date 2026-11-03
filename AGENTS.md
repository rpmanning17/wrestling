<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project instructions for coding agents (Codex, Claude, others)

This repository, not any chat history, is the source of truth. **Before changing code or the database, read these in order:** `docs/STATUS.md`, `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/RANKINGS.md`, `docs/DECISIONS.md`. Claude-specific notes are in `CLAUDE.md`; both agents follow the same rules.

### Rules

- Inspect the current repo state (`git log`, `git status`, open branches and PRs, `docs/STATUS.md`) before starting. Another agent may have changed things. Do not overwrite or re-implement their work, and do not add a competing solution without reconciling it first.
- Document the system as it actually is. Never describe planned work as implemented. Mark anything not verified against production as unverified.
- Schema changes only via new files in `supabase/migrations/` (never edit applied migrations). Rating-table changes also update `tests/db/rating-migration.test.ts` expectations.
- Never commit credentials, access keys, service-role keys, `.env*` files, database exports, raw result archives, or unnecessary personal data. Never ask the owner to paste secrets into chat.
- Preserve raw matches and evidence. Do not turn placements into wins, infer exact body weight from a bracket, infer a birth date from a division, or merge identities that are not confirmed.
- Preserve access controls, `noindex`/`no-store` headers, and the no-login model. Keep the app generalized; it is not only for one wrestler.
- Do not use future results to evaluate a past prediction. Do not present unvalidated rating variants (for example dominance adjustment) as fact.
- A passing build alone is not success: run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

### Every substantial feature PR

- Updates the relevant docs (see the table in `CLAUDE.md`/this file) and `docs/STATUS.md` when functionality completes or priorities change.
- Records a major decision in `docs/DECISIONS.md` with the reasoning and alternatives rejected.
- Uses the pull request template (`.github/pull_request_template.md`): changes, tests run, database migrations, outstanding issues, design decisions.

### Which doc to update

| Change | Update |
|---|---|
| Behaviour users see, setup, commands | `README.md`, `docs/STATUS.md` |
| Product rules or scope | `docs/REQUIREMENTS.md` |
| Modules, data flow, deployment | `docs/ARCHITECTURE.md` |
| Tables, views, identity or age/weight inference | `docs/DATA_MODEL.md` |
| Rating math, outcomes, defaults, backtests | `docs/RANKINGS.md` (and regenerate `docs/BACKTEST_REPORT.md`) |
| A choice with trade-offs | `docs/DECISIONS.md` |
