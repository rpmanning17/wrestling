# Data model

November 10 person-read extension: `private.match_cohort_appearances.person_id` is the exact nullable current match-side assignment, maintained transactionally with source/assignment changes. Held sides stay null. A statement-level advisory lock serializes these two write paths; maintenance functions are private definers with direct execution revoked, and reads retain the existing personal-app RLS. The migration verifies every projected person ID and unchanged complete classifier output. `person_cohorts_by_ids(uuid[])` is an invoker read of the shared classifier, retaining every event in each selected person's history; empty/null arrays return no rows.

November 10 history read follow-up: `person_match_history(uuid[],text)` returns the same source bout fields and independent side assignments as filtering `person_matches`, with indexed UUID lookups, exact source-ID equality and invoker RLS. It is read-only; no source/assignment/output schema or data changed. Invalid side parameters are rejected and default PUBLIC/authenticated/service-role execution is revoked; the existing application role has execution subject to underlying RLS.

The private `match_cohort_appearances` relation holds exactly two classification-input rows per source bout. Its primary key is (source_match_id, side); it preserves source names, team, date, event and parsed bracket labels. Generated name/age keys and private indexes support selective reads. The source-table AFTER trigger updates this projection atomically; no asynchronous refresh or derived rating is stored. Client roles cannot write the table or execute its maintenance trigger. The same personal-app authorization check guards reads. Alias and person assignment resolution occurs at query time, so corrections do not require refreshing this projection.

November 9 scoped-query follow-up: existing cohort views now use shared invoker functions with an optional age argument. NULL retains the full result. Both new functions require the same underlying table RLS; PUBLIC/authenticated execution is revoked and only existing app-role anon execution is granted. No source, assignment, rating, cohort vote or persistence change. See STATUS and USA_IMPORT_CONTINUATION_20261109.md.


November 9 query follow-up: source migration `20261109183704_bound_cohort_input_duplicates.sql` is applied as production `20261109184313`. Only the invoker cohort view changes: identical raw classification tuples collapse before canonical joins, preserving the existing downstream DISTINCT result. No source table, identity, vote, rating, tier rule or permission changes. Full cohort and standing checksums are preserved; intermittent app-role timeout remains open. See USA_IMPORT_CONTINUATION_20261109.md.

The 2026-11-05 finite club alias catch-up adds 27 literal rows to `public.club_aliases` and a denied private insertion ledger for guarded rollback. It retains original team text in `matches`, entries and observations. Club views resolve those rows at read time. Production version `20261105150602` is applied; see CLUB_NORMALIZATION.md.

The person-identity branch adds `wrestler_people`, `identity_decisions`, `identity_assignment_batches`, append-only `source_identity_assignments`, and indexed `source_identity_current_rows`. These are **local migration definitions until applied**. Each match winner and loser, tournament entry, and observation has its own current assignment or an explicit null. Source rows and spellings remain unchanged. Every assignment revision points to a decision with owner-confirmed, agent-inferred, source-evidenced or administrative authority. The `private.assign_source_identity` and bounded `private.apply_identity_batch` functions compare source names and expected revisions; rollback records a new revision and retains history. `wrestler_notes.person_id` is nullable, so an old name-key note is not guessed onto either same-name wrestler. The application reads `person_matches`, `person_tournament_entries`, `person_tournament_observations`, `person_cohort_current`, `person_strength_current`, `person_rating_current`, and person club views only after a person-keyed model is active.

## Reviewed club aliases (2026-11-04)

The finite `config/club-normalization.approved.json` drives source migration `20261104161040_approved_club_normalization.sql`, production version `20261104161409`. It inserts 377 aliases and preserves all 13 original rows. Exact punctuation replacement may leave a trailing space. Original team labels and raw/evidence/model/history records remain unchanged; ordinary club views aggregate canonical organizations. `private.club_normalization_20261104_inserted` captures actual insertions with timestamps, RLS enabled and client/service-role privileges revoked, for guarded administrator rollback. See CLUB_NORMALIZATION.md for measurements and reconstruction differences.


Source of truth for tables is `supabase/migrations/`. This document explains meaning and relationships. Row counts are deliberately omitted; query the database.

## Tables and views

| Object | Purpose | Key facts |
|---|---|---|
| `matches` | One row per contested or recorded bout | `event_date`, `season`, `event_name`, `weight_class` (free text, bracket weight is the trailing number), `round`, `winner_name/team`, `loser_name/team`, `result` (score text), `win_type` (method code), `source_file` + `source_row` unique (idempotent re-import), generated `search_text` |
| `tournament_entries` | Confirmed division rosters | age group (6U..18U), `division_birth_year_start/end`, `experience_division` (open/rookie), `bracket_weight_lbs`, optional `placement`, `confidence` confirmed/derived |
| `tournament_observations` | Placers and weight-class tables captured from Flo event pages | division gender and basis (birth-year band or school level), `bracket_weight_label/lbs`, `placement`, `identity_resolution` (exact_existing/new_identity/ambiguous/placeholder), `source_athlete_name` (original text), provenance (filter id, file names, ZIP SHA-256) |
| `wrestler_evidence` | Derived: where a wrestler was seen, with age group, bracket weight and a confidence | `evidence_type` confirmed_entry / inferred_identity / inferred_same_bout / inferred_same_bracket; `confidence_score` 0..100; rebuilt by `private.refresh_wrestler_evidence()` |
| `wrestler_aliases` | Reviewed spelling aliases | `alias_key` → `canonical_key`, with reason and confidence |
| `wrestler_notes` | Private scouting notes | keyed by `wrestler_key`, client id for sync |
| `wrestler_ratings` (view) | **Legacy** heuristic strength per (wrestler, age group, 10 lb band) | win rate, placement, finishing, recency, volume; cohort min-max 0..1000 |
| `rating_models` | One row per calculation | status building/candidate/active/archived; full config JSON and hash; input fingerprint; as-of date; match cutoff; period policy; k; recency policy; dominance flag; counts; exclusions; quality threshold; backtest metrics. At most one `active` (partial unique index) |
| `wrestler_model_ratings` | Ratings of one model | rating, RD, volatility, conservative score, status, record, method counts, pin/bonus %, margins, SOS metrics, quality W-L, trend |
| `wrestler_rating_history` | Rating over time | one row per wrestler per rating period they played |
| `rating_backtest_runs` | Stored backtest summaries | metrics JSON per config hash |
| `wrestler_rating_current`, `wrestler_strength_current` (views) | Active model only | strength view adds cohort rank, size and the 0..1000 display |

Migration `202611030009` was **applied to production on 2026-11-03** (production version `20261103174437`). The first model was calculated and atomically activated 2026-11-03; see `RATING_ACTIVATION.md`.

**Migration naming:** production records the timestamp at which each migration was applied through the Supabase connector, so 10 of 13 repo file names (`202610250001` and `202611030001` to `202611030009`) differ from the production versions. Do not run `supabase db push` against production without reconciling first.

## Historical data-quality audit (2026-11-03; superseded counts)

Calendar 2025 was backfilled November 4. Current baseline: 67,736 source rows, 64,050 rated bouts; exclusions 3,679 administrative, one self-match and six OTHER1, zero exact duplicates. The table below preserves the earlier investigation, not current coverage.

| Issue | Count | Rating pipeline today |
|---|---|---|
| Possible duplicates (same date, event, weight class, round, participants) | 261 groups, 262 extra rows | dropped only if result and method also match; otherwise rated twice |
| Swapped records (same bout, winner and loser reversed) | 65 preliminary audit pairs | not proven duplicates; contested rematches retained under D19 |
| Self-matches | 12 | excluded |
| Weight label with no parseable 30–400 number | 139 (nearly all HWT) | rated; excluded from weight-context segments |
| Season label `2026-2027` (hyphen) vs `2026–2027` (en dash) | 668 vs 8,292 | ignored (ratings do not use `season`) |
| `win_type` OTHER1 | 1 (0-0) | excluded as unknown |
| No bouts 2024-12-30 to 2026-01-04 | whole of 2025 | handled by RD growth for inactivity |

## Relationships and normalization

- The currently active production model still uses the historical normalized-name key (`lower(trim(name))`). The new candidate uses `wrestler_people.id`; rating `athlete_key` is its UUID text and `person_id` is a foreign key. The app's `wrestlerKey()` slug remains only for legacy note compatibility.
- `wrestler_aliases.alias_key` maps a raw label to its canonical name. Raw labels are preserved (`tournament_observations.source_athlete_name`) and aliases stay searchable. The only alias today is Grayson Piaseck → Grayson Piasecki (user confirmed). Migration 008 also rewrote `matches` names for that alias.
- `wrestler_evidence.source_entry_id` → `tournament_entries(id)`; `source_match_id` → `matches(id)`; both cascade on delete.
- Clubs are free-text `team` columns copied onto matches, entries, observations and ratings. Confirmed club aliases and event-specific attribution are implemented by migration 010 (see `REQUIREMENTS.md` F13); raw team labels remain preserved.

## Identity resolution rules

November 5 audit: all historical matches, entries and observations were scanned without changing source rows. Candidate case/evidence hashes are private review identifiers, **not person IDs**. The additive person tables and assignment lineage are implemented in branch migrations but have not yet been applied to production. See IDENTITY_AUDIT.md and IDENTITY_OPERATIONS.md.

1. The old active model groups exact normalized names; this is a known weakness. The person plan uses source-side overrides for confirmed same-name splits, reviewed links for spelling/nickname merges, and a provisional name bucket only for other uncontradicted appearances. This baseline is not proof of identity. Held source appearances remain unattributed; future rows require a new agent-side decision.
2. Spelling variants are merged only through a reviewed row in `wrestler_aliases` with a stated reason and confidence.
3. Observation rows use `identity_resolution`; `ambiguous` rows are shown labelled "identity review" and not merged; `placeholder` rows are excluded.
4. Rating computation applies aliases retrospectively (the whole alias table is a reviewed fact, not an outcome signal) and the backtest reports the effect of turning that off.

## Age and weight inference

- Age group comes from division evidence only: a confirmed roster (`tournament_entries`) or a division birth-year band. Mapping: birth years 2012/13 → 14U, 2014/15 → 12U, 2016/17 → 10U, 2018/19 → 8U. Birth years 2020 to 2022, girls' birth-year bands and high-school levels are **not** forced into youth groups.
- Weight is the **bracket class**, never body weight. `matches.weight_class` is parsed by taking the trailing number. A bracket weight is evidence of the class, not of the athlete's weight.
- `private.refresh_wrestler_evidence()` rebuilds `wrestler_evidence`: confirmed entries first (confidence 100), then a bounded graph walk from wrestlers with one unambiguous age band through opponents in the same event/bracket (July 2026 onward) to label other participants, with lower confidence by distance. Anything that maps to more than one age band is dropped, not guessed.
- Cohorts for ranking are (age group, 10 lb band of the bracket weight), using each wrestler's most recent evidence in that cohort.

## Outcome representation (matches)

`win_type` is a short code (at most 20 characters). The app's add-bout form uses F, DEC, TF, MD, FOR, DEF, M FOR, DQ, MFFL, NC. The importer drops BYEs and rows without a named opponent, and de-duplicates exact repeats. **Production classification was verified 2026-11-03:** 30,134 contested source rows, of which one is a self-match; 1,710 administrative rows; one unknown OTHER1. The exact-row duplicate filter removed zero rows. Earlier candidate counts in the audit table are broad matching heuristics, not proven duplicates or actual exclusion counts. `RANKINGS.md` documents the classification applied and what happens to unrecognized values.


## Current classification authority (2026-11-04)
`wrestler_cohort_current` supersedes the historical-cohort rule above. It reads all matches, entries, unambiguous observations and derived evidence under caller RLS, applies reviewed aliases, and emits one row per athlete with independent nullable age and weight estimates. Ranking excludes incomplete classifications. See D25 for exact event, source, vote, tie and dual rules. `tournament_entries.weigh_in_lbs` is optional verified event measurement (30–400 lb); existing brackets are not backfilled into it. The view's compatibility field `bracket_weight_lbs` is the selected weight estimate and can use that measurement. Division birth-year outputs are null: eligibility is not birthdate evidence. Applied migration sequence: `20261104140253_consistent_current_cohorts.sql`, `20261104140854_bound_cohort_vote_plan.sql`, `20261104141033_hash_cohort_label_join.sql`. Existing history mismatch still prohibits blind CLI pushes.


## Tier metadata (2026-11-04)
Migration `20261104143500_cohort_tiers_and_rating_clarity.sql` appends `tier_eligible` to `wrestler_cohort_current` and `cohort_tier` / `tier_unavailable_reason` to `wrestler_strength_current`. Eligibility reports unique top vote support in both dimensions; it does not change inferred labels or grant stronger evidence confidence. The strength view is the sole tier authority. `club_rankings_current.schedule_expected_win_pct` averages 1/(1+10^((opponent_rating−1500)/400)) across the same opponent appearances already used for the club's opponent average. All views retain security_invoker and existing grants. No tables or raw/model rows are changed. The CLI's local telemetry write was prohibited in this session; the reviewed SQL was saved locally and applied through the authorized administrator connector, preserving the existing migration-history caveat.


Two immutable query-plan follow-ups for the same club calculation are applied: `20261104145000_bound_club_schedule_read.sql` and `20261104145400_bound_filtered_club_schedule.sql`. They preserve existing club metrics/affiliations and the reference-1500 formula, while avoiding per-bout repeated scans and arbitrary-precision exponentiation. All raw and model tables remain untouched.


Expanded-source read fixes (2026-11-04): source migrations 20261104201302 and 20261104202147 map to production 20261104201755 and 20261104202335. View outputs and invoker security/grants are preserved; raw/derived/model tables are unchanged by these read optimizations. Current active ratings are the complete canonical recovery run documented in RATING_RECOVERY_RELEASE.md. Do not perform unreconciled CLI migration pushes.


## Source-input freshness and imported match staging (PR #10, deployed)

A newly generated normalized match source must preserve `source_file` and `source_row` and pass the same schema constraints as `public.matches`. The offline validator stages conflict-checked inserts through the existing unique source index, never overwriting a prior source row. Input quality and older source files can only be verified by reviewing the original archives; this tool does not invent stable wrestler IDs, merge clubs, or infer measured bodyweight.

The global warning compares the live source count to the active model's `matches_total`, not a database-maintained fingerprint or last-modified timestamp. Equal counts can hide same-count edits; source/alias fingerprint checks remain necessary for authoritative recalculation.

Migration-version differences are recorded without modification at `docs/MIGRATION_HISTORY_AUDIT.md`. Never apply previously deployed local migrations simply because their source filename has a different version.
