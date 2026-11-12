# Architecture

The Free-plan club directory reads transaction-maintained source counts (season/recorded team/person), then the server requests complete live summaries in four-key batches, one call at a time (concurrent batches were cancelled together at the three-second limit under Free-plan CPU starvation). Club detail pages likewise read the summary, roster and each roster age's standings sequentially. All requested keys must reconcile exactly. `person_club_directory` shares the original sort metrics; `person_club_rankings_for_keys` bounds source reads using literal alias-key indexes. Ratings, aliases, schedules and final club results are calculated live. Roster aggregation sums the same source counts before reading current ratings. Tests compare every sort metric, summary and roster row with the original formulas, including mutations, holds and rollback.

Club input reads also use the same synchronous source-side projection: normalized source season/team keys, original win type and nullable opposite person ID are maintained with source/assignment changes. This avoids repeated full source joins and per-bout parsing. Alias mappings and active rating values are still read live in each statement; club summaries remain calculated results.

Person Clubs reads use invoker `person_club_rankings_for_season(season,club)` and `person_club_roster_for_season(season,club)`. They reuse the original formulas with one materialized active-rating input, distinct team-label normalization and one transactional source/person bout input. They calculate only the selected season/club; roster standings classify selected people and rank their complete age populations. These materialized CTEs exist only within each live statement.

Person cohort reads share `private.calculate_person_cohorts(age,people)`, a stable invoker with fixed empty search path. `current_person_cohorts(age)` preserves full age-population reads; `person_cohorts_by_ids(people)` preserves complete evidence histories only for requested people (null/empty IDs return none). Search and profiles use the latter. Profile strength requests each represented age's complete population and then filters the selected keys.

The private source-side appearance projection also stores the current nullable person UUID. Source and current-assignment write statements share one transaction advisory lock; protected triggers synchronously maintain person IDs on source insert/replacement and assignment insert/update/delete. Reads remain concurrent. Classification and rating results are calculated from inputs, with no result-cache refresh window.

## Scoped current cohorts

Source matches also maintain a private indexed appearance projection in the same insert/update/delete transaction. It contains source-side classification inputs, with no cohort or rating result cache. Name/age indexes drive scoped reads; live aliases/assignments are joined afterward. `current_wrestler_strength` and `current_person_strength` take the same optional age argument, and their NULL calls back the full strength views. Ranking profiles reuse the candidate classification and ask for complete age-population standings. Active models skip the unused legacy heuristic query.

The full cohort views and Rankings RPCs share `current_wrestler_cohorts(target_age)` and `current_person_cohorts(target_age)`. NULL evaluates every athlete. An explicit age reduces the athlete population before event/vote windows using any supporting source-age value; it retains every source row for selected athletes and the caller still filters the final classification. Thus the three-event classifier has one authority per identity scheme. Both functions are stable invokers with empty search_path and parameterized static query execution, without stored derived state. This forces planning for each actual argument while preserving access controls.

## Runtime

The November 5 offline identity audit (`scripts/identity/audit.ts`) remains the read-only source-evidence discovery tool. The person-identity branch adds `revalidate-links.ts`, `plan.ts`, `calculate-candidate.ts`, `validate-candidate.ts`, `rollout-sql.ts` and `candidate-rollout-sql.ts` for agent-side decisions, immutable private output, and supervised connector batches. No identity-matching UI or public write endpoint exists. See IDENTITY_AUDIT.md and IDENTITY_OPERATIONS.md.

## Person identity path (database prepared; app deployment and activation pending)

Person history reads use `person_match_history(person_ids,match_side)`, a stable invoker function over current assignments and original matches. Requested identities drive UUID match primary-key lookups; original text equality preserves exact appearance semantics. It reads the opposite side separately, keeping null held identities. The server still pages complete histories by date and UUID. No match-history cache or identity reassignment is introduced.

`wrestler_people.id` is a permanent UUID. Every original match side, tournament entry and observation has an independent versioned assignment in `source_identity_assignments`; `source_identity_current_rows` is the indexed current state and `source_identity_current` the invoker view. `identity_decisions` records authority and evidence; batches and revisions support compensating rollback. Unassigned source rows retain their original names and cannot enter a person history. Existing notes remain unattributed until linked by evidence; new notes under a person model carry `person_id`.

The rating engine accepts reviewed match-side IDs without changing Glicko-2 arithmetic. Candidate rows use UUID strings as rating keys and also store `person_id`; the model records `identity_scheme=person_uuid` and an assignment fingerprint. Until such a model is active, app reads continue through the current name-key views. After activation, search, profiles, comparisons, cohorts, rankings and club views use the person-specific invoker views. The same validated three-event cohort vote, conservative score, tier and club-SOS formulas are reused with person-keyed inputs. Current assignment writes are refused while a person model is active, so correction requires a new supervised rating release. The database guard checks person rating counts and current assignment fingerprint before active promotion.

- **Next.js 16 App Router** on Vercel. Server components and server actions read and write Supabase using a server-only key. The browser only receives rendered HTML and action results.
- **Supabase Postgres** with row-level security. The `anon` role may read/write only when the request carries the personal-app key (`private.personal_app_request_is_valid()`); the existing administrator connector is used for guarded rating batch writes. Views use `security_invoker`.
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

The current-source person exporter reads the four-table verified bounded snapshot and uses current source assignments directly, including null held sides. It verifies exact recorded source names and person/appearance coverage before calculating. `calculate-snapshot-candidate.ts` requires clean committed calculation sources, explicit as-of date and a new private output. The separate validator replays every serialized engine field and independently reconstructs reviewed outcomes, records, SOS and every daily Glicko/history state using a separate bisection volatility implementation. Neither command connects to the database. Full snapshot roots, current-assignment fingerprint, source-input v2 fingerprint and payload hashes accompany the candidate.

Bounded connector exports preserve each row's original PostgreSQL `to_jsonb(row)::text` in ordered private JSON pages. `scripts/ratings/snapshot.ts` reconstructs and verifies all pages against full-row table fingerprints captured together in one SQL statement. Thus the verified reconstructed inputs correspond to that single MVCC snapshot; independent page counts are insufficient. The CLI writes only a private integrity report and cannot activate a model. See USA_IMPORT_CONTINUATION_20261109.md for ordering and fingerprint encoding.

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
- It is a **batch** pipeline on purpose (a rolling filter over time cannot be expressed as a simple SQL view). Models are immutable once written; a new calculation inserts a new model, and activation is a status switch (`private.activate_rating_model`, activation uses this atomic function under the runbook locks; CLI activation is disabled).

## Fallback behaviour

`buildProfiles` first checks `wrestler_rating_current`. If the view is missing (migration not applied), errors, or has no active model, `ratingSource` is `"legacy"` and the original `wrestler_ratings` view drives the 0 to 1000 number. When a model is active, every wrestler is scored from it (a wrestler with no contested bouts shows as unrated rather than falling back), so one comparison never mixes the two systems.

## Deployment

Vercel builds from GitHub. Production variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PERSONAL_APP_KEY`. Migrations are applied to Supabase manually (CLI or SQL editor) before deploying code that needs them. Code that reads the new views tolerates their absence.

## Validated production model

As of 2026-11-04 the live application reads `glicko2-daily-dec08-canonical-recovery-20261104-v1` (model `a29c4460-5e56-4d22-902d-ea39c65bfcac`), including calendar 2025. Production configuration is committed separately in `config/ratings.production.json`; engine defaults remain the seven-day binary-outcome reference for reproducible backtests. Rating/SOS rows and history were calculated locally from a read-only connected Supabase snapshot, inserted as a building model through the connected administrator SQL tool, validated, marked candidate and atomically activated with the existing restricted function. No extra public RPC or credential was created. See `RATING_RECOVERY_RELEASE.md` for current provenance and `RATING_OPERATIONS.md` for the repeatable import/recalculation workflow.


## Shared cohort read path (2026-11-04)
`wrestler_cohort_current` is the sole current age/weight classifier; `wrestler_strength_current` joins it to unchanged active ratings. Search discovers candidate names then reads their authoritative classification; profile classification is not derived from limited match batches or user filters. Missing classification view raises an error instead of silently supplying historical labels. The old pure TypeScript classifier was removed; migration tests exercise the actual SQL. No credentials or caching were added.


## Shared rating display (2026-11-04)
The database appends tier metadata to its existing strength view. `cohort-standing.ts` maps that metadata, without ranking math, for profiles and existing club rosters. `components/cohort-standing.tsx` renders 10→1 left-to-right and explanatory unavailable states; `components/glicko-metrics.tsx` consistently labels raw ratings, uncertainty and schedule. Ranking lists reuse profile data. The roster fetch reads current standing once for its existing athlete set; historical team attribution is unchanged. No club browsing, filters, navigation or sorting capability was added.


Production read optimization: profile construction uses current age/weight fields from the same strength-view row as rank/tier; missing/unrated athletes fetch classification separately. Club schedule calculations materialize their rating join once, including for filtered club pages. Neither path uses a data cache or widens permissions.


Canonical recovery (2026-11-04): calculate.ts and the read-only recovery exporter share persisted-field serialization. Administrator connector batches lock/check immutable building metadata and exact rows; candidate promotion and activation are separate validated steps. Expanded source reads parse repeated literal labels once inside invoker-view CTEs, collapse redundant classification tuples, and fence classification joins. These are statement-local query intermediates, not persistent caches. See RATING_RECOVERY_RELEASE.md.


## Input freshness and offline normalized match staging (PR #10, deployed 2026-11-04)

`src/components/rating-freshness-banner.tsx` performs a server-only, RLS-protected exact source-bout count and reads the sole active `rating_models` metadata in parallel. `src/lib/rating/freshness.ts` classifies count divergence; warnings are conditional and are **not** full input-fingerprint validation. It is mounted asynchronously beneath the global navigation without sending Supabase credentials to the client.

`src/lib/imports/matches-csv.ts` validates normalized historical match columns and produces transactional idempotent, conflict-checked SQL. `scripts/imports/prepare-matches.ts` stages a private reviewed SQL file; it never writes to Supabase. The raw Flo CSV converter is not included. This is an independent process from alias review, evidence refresh and rating calculation; use `RATING_OPERATIONS.md` for the latter.

## Agent-operated release pipeline (2026-11-12)

Agents store a raw tournament file and a run request in private tables through the administrator connector, then dispatch `.github/workflows/tournament-release.yml`. That runs on `main`, in the `production-data` environment, with the `MATNOTES_DATABASE_URL` secret for `matnotes_release`. Phases: `plan` (rolled-back dry run), administrator approval of the plan hash, `release`, `verify` and `rollback`. The CLI (`scripts/release/run.ts`) talks to Postgres directly. It streams the snapshot in one repeatable-read transaction and executes the existing guarded rollout requests with typed read-back, so bulk data never transits an AI conversation. Details: [RELEASE_PIPELINE.md](RELEASE_PIPELINE.md).
