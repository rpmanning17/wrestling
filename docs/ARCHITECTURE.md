# Architecture

## Runtime

- **Next.js 16 App Router** on Vercel. Server components and server actions read and write Supabase using a server-only key. The browser only receives rendered HTML and action results.
- **Supabase Postgres** with row-level security. The `anon` role may read/write only when the request carries the personal-app key (`private.personal_app_request_is_valid()`); `service_role` is used for batch writes run from the owner's machine. Views use `security_invoker`.
- No authentication layer in the app. `src/proxy.ts` adds `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow, noarchive` and other hardening headers to every response.

## Code map

```
src/app/                    pages, server actions, UI (mobile-first CSS in globals.css)
  compare-builder.tsx       comparison UI; ProfileCard, PowerRatingStrip, RatingDetails
  rankings/page.tsx         "most likely for Nolan" and strongest list
  results/page.tsx          result browser
src/lib/
  supabase.ts               server-side client (adds x-personal-app-key)
  scouting.ts               findWrestlers, buildProfiles, strongestPool, likelyNolanPool
  scouting-types.ts         WrestlerProfile, PowerRating, ...
  scoring.ts                legacy strength heuristic and matchup likelihood
  rating/                   pure rating engine (no I/O), see below
scripts/ratings/            CLIs: calculate.ts, backtest.ts, common.ts (I/O lives here)
supabase/migrations/        the only way the schema changes
supabase/importers/         tournament-observation SQL builder (PowerShell)
supabase/audits/            read-only audit SQL
tests/rating, tests/db      node:test suites (tests/db applies migrations in PGlite)
```

## Rating pipeline

```
public.matches ──read──▶ prepareMatches ──▶ calculateRatings ──▶ batch write ──▶ rating_models (building→candidate→active)
public.wrestler_aliases ─┘   (classify, dedupe,       (walk-forward Glicko-2)        wrestler_model_ratings
                              alias, events)                                         wrestler_rating_history
                                                                                      │
                                              wrestler_rating_current / wrestler_strength_current (views, active model only)
                                                                                      │
                                               scouting.ts ──▶ ProfileCard / rankings page
```

- `src/lib/rating/glicko2.ts` implements Glickman's published Glicko-2 (validated against the paper's worked example in tests).
- `prepare.ts` classifies outcomes, drops non-contested and duplicate rows, applies aliases, groups bouts into events, and returns an exclusion report.
- `walk.ts` is the leakage rule shared by ratings and backtests: every bout is predicted from a snapshot taken before the rating period containing its event's first bout; updates apply after.
- `engine.ts` produces ratings, uncertainty, status, conservative score and explanatory statistics. `backtest.ts`, `grid.ts`, `report.ts` produce the evaluation. `relations.ts` computes head-to-head and common opponents.
- It is a **batch** pipeline on purpose (a rolling filter over time cannot be expressed as a simple SQL view). Models are immutable once written; a new calculation inserts a new model, and activation is a status switch (`private.activate_rating_model`, production activation uses this atomic function; the CLI has a non-atomic two-step alternative).

## Fallback behaviour

`buildProfiles` first checks `wrestler_rating_current`. If the view is missing (migration not applied), errors, or has no active model, `ratingSource` is `"legacy"` and the original `wrestler_ratings` view drives the 0 to 1000 number. When a model is active, every wrestler is scored from it (a wrestler with no contested bouts shows as unrated rather than falling back), so one comparison never mixes the two systems.

## Deployment

Vercel builds from GitHub. Production variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PERSONAL_APP_KEY`. Migrations are applied to Supabase manually (CLI or SQL editor) before deploying code that needs them. Code that reads the new views tolerates their absence.

## Validated production model

As of 2026-11-03 the live application reads `glicko2-daily-dec08-v1`. Production configuration is committed separately in `config/ratings.production.json`; engine defaults remain the seven-day binary-outcome reference for reproducible backtests. Rating/SOS rows and history were calculated locally from a read-only connected Supabase snapshot, inserted as a building model through the connected administrator SQL tool, validated, marked candidate and atomically activated with the existing restricted function. No extra public RPC or credential was created. See `RATING_ACTIVATION.md` for provenance and verification.


## Shared cohort read path (2026-11-04)
`wrestler_cohort_current` is the sole current age/weight classifier; `wrestler_strength_current` joins it to unchanged active ratings. Search discovers candidate names then reads their authoritative classification; profile classification is not derived from limited match batches or user filters. Missing classification view raises an error instead of silently supplying historical labels. The old pure TypeScript classifier was removed; migration tests exercise the actual SQL. No credentials or caching were added.


## Shared rating display (2026-11-04)
The database appends tier metadata to its existing strength view. `cohort-standing.ts` maps that metadata, without ranking math, for profiles and existing club rosters. `components/cohort-standing.tsx` renders 10→1 left-to-right and explanatory unavailable states; `components/glicko-metrics.tsx` consistently labels raw ratings, uncertainty and schedule. Ranking lists reuse profile data. The roster fetch reads current standing once for its existing athlete set; historical team attribution is unchanged. No club browsing, filters, navigation or sorting capability was added.


Production read optimization: profile construction uses current age/weight fields from the same strength-view row as rank/tier; missing/unrated athletes fetch classification separately. Club schedule calculations materialize their rating join once, including for filtered club pages. Neither path uses a data cache or widens permissions.
