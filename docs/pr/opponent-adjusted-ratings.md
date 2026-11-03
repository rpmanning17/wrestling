# PR draft: Add opponent-adjusted Glicko-2 ratings, backtesting, and shared project docs

Base `main` (production `9dbe59a`) ← head `claude/opponent-adjusted-ratings-and-docs`. Delete this file once the PR is opened; the PR itself is then the record.

---

## Changes

Add opponent-adjusted Glicko-2 ratings, backtesting, and shared project docs.

- Pure rating engine (`src/lib/rating`): Glicko-2 per the published spec, outcome classification, walk-forward leakage rule, conservative score, SOS and quality metrics, head-to-head and common opponents, experimental dominance variants.
- Batch CLIs: `ratings:calculate` (versioned models, dry-run/offline/activate) and `ratings:backtest` (chronological, paired-bootstrap, held-out confirmation).
- Migration `202611030009` (versioned rating tables and views); **not applied to production**; verified in PGlite.
- UI: power rating ± RD, conservative score, status, rating details, with fallback to the legacy view when no model is active.
- Docs: README, AGENTS.md, CLAUDE.md, `docs/{REQUIREMENTS,ARCHITECTURE,DATA_MODEL,RANKINGS,DECISIONS,STATUS}.md`, PR template, read-only outcome audit SQL.
- Follow-up commit: audit SQL gains a totals query (0) and a swapped winner/loser query (8), team lists for same-name collisions, and a weight-range check matching `parseBracketWeight`; new `tests/db/match-audit.test.ts` runs the audit in PGlite; classifier review recorded as D16.

## Tests

Run 2026-11-03 on a fresh `pnpm install --frozen-lockfile` (Node 22):

- `pnpm lint`: clean
- `pnpm typecheck`: clean
- `pnpm test`: 93 passed, 0 failed (rating math including the Glicko-2 paper example, preparation, leakage, backtests, relations, migration/RLS, audit SQL)
- `pnpm build` with dummy `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PERSONAL_APP_KEY`: succeeds (`/`, `/rankings`, `/results` dynamic)

Not run: anything against production data (audit, `ratings:calculate`, `ratings:backtest`), and no visual check of the UI with live data.

## Database migrations

- `supabase/migrations/202611030009_create_versioned_opponent_adjusted_ratings.sql`: **not applied**. Apply through a Supabase migration after merge. The UI falls back to the legacy ratings until a model is active, so merging before applying is safe (unverified against production; verified in the build).
- Rollback: no model active means the legacy view is used; the new tables can be dropped by a new migration if needed. Applied migrations are never edited.
- Backfill: `pnpm ratings:calculate` writes a candidate model and needs `SUPABASE_SERVICE_ROLE_KEY` in the owner's local environment only; `--activate` is a separate, deliberate step.

## Outstanding issues

- Production `win_type` values, duplicate rates, same-name collisions and season coverage not inspected; run `supabase/audits/match_outcome_audit.sql`.
- Classifier spellings that currently fall to `unknown` (excluded): see `docs/DECISIONS.md` D16.
- Swapped winner/loser duplicates are rated twice; `100 (14U)`-style weight labels lose the bracket weight.
- Defaults (k = 1, 7-day periods, tau 0.5, RD thresholds 120/80) are uncalibrated until the real backtest; `docs/BACKTEST_REPORT.md` is a placeholder.
- No 2025 season data in imports.

## Design decisions

See `docs/DECISIONS.md` D7–D17: Glicko-2 baseline, versioned batch models, conservative score k = 1, contested outcomes only, SOS explanatory only, dominance experimental and off with an explicit adoption rule, one global pool with cohort views, walk-forward leakage rule, 7-day periods and tau 0.5, no speculative classifier widening, audit SQL under test.

## Docs updated
- [x] README / AGENTS / CLAUDE (if setup or rules changed)
- [x] docs/STATUS.md
- [x] docs/REQUIREMENTS.md, ARCHITECTURE.md, DATA_MODEL.md, RANKINGS.md, DECISIONS.md (as relevant)

## Safety checklist
- [x] No credentials, keys, `.env` files, exports or raw result archives committed
- [x] Raw matches and evidence preserved; no placement converted to a win
- [x] Access controls, `noindex` and the no-login model unchanged

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01EavQmEpZss4Wnb5jWSLxE3
