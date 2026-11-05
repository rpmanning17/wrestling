# Production migration-history audit — 2026-11-04

## 2026-11-05 addendum

The finite club alias catch-up source file `20261105150000_club_alias_catchup.sql` was applied through the administrator connector as production version `20261105150602`, name `club_alias_catchup_20261105`. This adds one more local/remote version difference to the historical inventory below. The 23-file/23-record counts remain the original 2026-11-04 snapshot, not a current count. Existing differences have not been reconciled; do not run blind `supabase db push`.

**Read-only inventory. NOT A REPAIR, NOT A SCHEMA CHANGE.**

Project: `tprodwivvwvpmpzaedom`. Local directory: `supabase/migrations/` as of merged PR #9.
Local SQL files: **23**; Supabase applied records: **23**; same version: **3**; divergent version: **20**.

Production records the time each migration was applied, not always the timestamp embedded in the checked-in filename. Some names also differ. A simple `supabase db push` risks replaying already-applied DDL. **Do not run a migration push or repair until the owner has reviewed a version-map and separately verified SQL equivalence.**

| Checked-in file version | Checked-in slug | Production recorded version | Production name | Match |
|---|---|---|---|---|
| `202610250001` | `private_results` | `20261025205500` | `private_results` | no |
| `20261025212304` | `personal_app_access` | `20261025212304` | `personal_app_access` | yes |
| `20261025212902` | `optimize_personal_access_policy` | `20261025212902` | `optimize_personal_access_policy` | yes |
| `20261025220936` | `create_private_matches` | `20261025220936` | `create_private_matches` | yes |
| `202611030001` | `create_tournament_entries` | `20261103140402` | `create_tournament_entries` | no |
| `202611030002` | `clarify_division_birth_year_evidence` | `20261103140648` | `clarify_division_birth_year_evidence` | no |
| `202611030003` | `create_wrestler_notes` | `20261103143611` | `create_wrestler_notes` | no |
| `202611030004` | `add_wrestler_evidence_and_ratings` | `20261103151004` | `add_wrestler_evidence_and_ratings` | no |
| `202611030005` | `index_wrestler_evidence_sources` | `20261103151140` | `index_wrestler_evidence_sources` | no |
| `202611030006` | `create_tournament_observations` | `20261103160036` | `create_tournament_observations` | no |
| `202611030007` | `index_tournament_observation_links` | `20261103160356` | `index_tournament_observation_links` | no |
| `202611030008` | `resolve_wrestler_aliases` | `20261103162349` | `resolve_wrestler_aliases` | no |
| `202611030009` | `create_versioned_opponent_adjusted_ratings` | `20261103174437` | `create_versioned_opponent_adjusted_ratings` | no |
| `202611030010` | `club_aliases_and_rankings` | `20261103223232` | `create_club_aliases_and_rankings` | no |
| `20261104140253` | `consistent_current_cohorts` | `20261104140707` | `consistent_current_cohorts` | no |
| `20261104140854` | `bound_cohort_vote_plan` | `20261104140907` | `bound_cohort_vote_plan` | no |
| `20261104141033` | `hash_cohort_label_join` | `20261104141046` | `hash_cohort_label_join` | no |
| `20261104143500` | `cohort_tiers_and_rating_clarity` | `20261104144056` | `cohort_tiers_and_rating_clarity` | no |
| `20261104145000` | `bound_club_schedule_read` | `20261104144756` | `bound_club_schedule_read` | no |
| `20261104145400` | `bound_filtered_club_schedule` | `20261104144956` | `bound_filtered_club_schedule` | no |
| `20261104161040` | `approved_club_normalization` | `20261104161409` | `approved_club_normalization` | no |
| `20261104201302` | `bound_expanded_cohort_reads` | `20261104201755` | `bound_expanded_cohort_reads` | no |
| `20261104202147` | `bound_expanded_club_reads` | `20261104202335` | `bound_expanded_club_reads` | no |

## Safety / next action

1. Before any repair, export/back up `supabase_migrations.schema_migrations` metadata and compare the archived applied statement body with the checked-in SQL **by substance**, including transaction wrappers and applied follow-up fixes. Equal migration names are not proof of equivalent DDL.
2. Avoid editing previously applied migration contents. There are two documented reconciliation options: (a) a deliberate repository-only rename to remote applied versions with review/links preserving provenance; (b) an authorized `supabase migration repair` for history-only bookkeeping after confirming the exact CLI version and `--help`. Never casually combine both approaches.
3. Validate a disposable/branch database migration plan first; ensure it is empty for already deployed schema changes, and that a fresh database can replay the ordered migrations. Do not apply destructive or duplicate DDL.
4. Use the latest Supabase CLI help and documentation for exact commands; record before/after schema_migrations hashes and a clean `supabase migration list`. Resume CLI pushes only after a fully reconciled audit.
5. This audit does **not** compare stored remote migration SQL text or certify historical equivalence. Database and source records were not modified.

### Observed remote-only records
None by recorded migration name.
