# Data model

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

Migration `202611030009` was **applied to production on 2026-11-03** (production version `20261103174437`). The rating tables are empty until the first model is written.

**Migration naming:** production records the timestamp at which each migration was applied through the Supabase connector, so 10 of 13 repo file names (`202610250001` and `202611030001` to `202611030009`) differ from the production versions. Do not run `supabase db push` against production without reconciling first.

## Known data-quality issues in `matches` (audit 2026-11-03)

| Issue | Count | Rating pipeline today |
|---|---|---|
| Possible duplicates (same date, event, weight class, round, participants) | 261 groups, 262 extra rows | dropped only if result and method also match; otherwise rated twice |
| Swapped records (same bout, winner and loser reversed) | 65 pairs | both rated (cancel or distort); proposal D19 |
| Self-matches | 12 | excluded |
| Weight label with no parseable 30–400 number | 139 (nearly all HWT) | rated; excluded from weight-context segments |
| Season label `2026-2027` (hyphen) vs `2026–2027` (en dash) | 668 vs 8,292 | ignored (ratings do not use `season`) |
| `win_type` OTHER1 | 1 (0-0) | excluded as unknown |
| No bouts 2024-12-30 to 2026-01-04 | whole of 2025 | handled by RD growth for inactivity |

## Relationships and normalization

- There is no `wrestlers` table. A wrestler's identity is a **normalized name string**: `lower(trim(name))` in SQL (`athlete_key`), `identityKey()` in TypeScript, with the app's own `wrestlerKey()` slug for notes and URLs. Matches, entries, observations and ratings relate by that key, not by foreign key.
- `wrestler_aliases.alias_key` maps a raw label to its canonical name. Raw labels are preserved (`tournament_observations.source_athlete_name`) and aliases stay searchable. The only alias today is Grayson Piaseck → Grayson Piasecki (user confirmed). Migration 008 also rewrote `matches` names for that alias.
- `wrestler_evidence.source_entry_id` → `tournament_entries(id)`; `source_match_id` → `matches(id)`; both cascade on delete.
- Clubs are free-text `team` columns copied onto matches, entries, observations and ratings. **Club normalization is not implemented** (see `REQUIREMENTS.md` F13).

## Identity resolution rules

1. Exact normalized-name match is the same identity. This is a known weakness: two different wrestlers with the same name merge, and the rating model cannot separate them. `supabase/audits/match_outcome_audit.sql` query 5 lists names seen with more than one club: on 2026-11-03, 2,439 of 7,797 distinct names (31%) appeared under more than one club label. Most are probably club-name variants or club switches rather than different people, but the data cannot tell them apart without club normalization.
2. Spelling variants are merged only through a reviewed row in `wrestler_aliases` with a stated reason and confidence.
3. Observation rows use `identity_resolution`; `ambiguous` rows are shown labelled "identity review" and not merged; `placeholder` rows are excluded.
4. Rating computation applies aliases retrospectively (the whole alias table is a reviewed fact, not an outcome signal) and the backtest reports the effect of turning that off.

## Age and weight inference

- Age group comes from division evidence only: a confirmed roster (`tournament_entries`) or a division birth-year band. Mapping: birth years 2012/13 → 14U, 2014/15 → 12U, 2016/17 → 10U, 2018/19 → 8U. Birth years 2020 to 2022, girls' birth-year bands and high-school levels are **not** forced into youth groups.
- Weight is the **bracket class**, never body weight. `matches.weight_class` is parsed by taking the trailing number. A bracket weight is evidence of the class, not of the athlete's weight.
- `private.refresh_wrestler_evidence()` rebuilds `wrestler_evidence`: confirmed entries first (confidence 100), then a bounded graph walk from wrestlers with one unambiguous age band through opponents in the same event/bracket (July 2026 onward) to label other participants, with lower confidence by distance. Anything that maps to more than one age band is dropped, not guessed.
- Cohorts for ranking are (age group, 10 lb band of the bracket weight), using each wrestler's most recent evidence in that cohort.

## Outcome representation (matches)

`win_type` is a short code (at most 20 characters). The app's add-bout form uses F, DEC, TF, MD, FOR, DEF, M FOR, DQ, MFFL, NC. The importer drops BYEs and rows without a named opponent, and de-duplicates exact repeats. **The actual distribution of `win_type` values in production has not been inspected** (no database access from the sessions that wrote the rating code). `RANKINGS.md` documents the classification applied and what happens to unrecognized values.
