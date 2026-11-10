# USA Bracketing release verification — November 10, 2026

This report records verified facts. Final application verification and merge are pending while the Clubs follow-up builds; consult the newest STATUS entry for current activation state.

## Immutable inputs and calculation

The ignored private export contains 221 verified pages / 219,195 rows: 68,783 source matches, 138,661 current source assignments, 11,750 people and one wrestler alias. The 1,047 new USA Bracketing contested bouts cover 13 events. Placements remain separate observations. All 341 held source appearances stay held; raw results, source names and legitimate repeated bouts are preserved. Input root definitions and exact four table roots are in USA_IMPORT_CONTINUATION_20261109.md and the read-only audit.

Run `70b59c01-34ac-4ff0-bf2a-114571d4f41c` uses unchanged daily Glicko-2 / decision-0.8 settings, as-of November 9 and source cutoff November 8. It rates 64,970 bouts and 11,650 people, with 35,421 history rows. Excluded: 3,679 administrative, six OTHER1 and 128 unresolved-identity bouts; zero duplicate exclusions. All 7,467 repeated opponent pairs remain. Recorded wins and losses each total 64,970.

Every canonical serialized output field was replayed exactly. An independent bisection solver audited daily states, current values, uncertainty, history and SOS; outcomes, identities and records were independently reconstructed from source rows. RANKINGS.md records explicit epsilon-derived comparison bounds and maximum deviations; no calculation settings changed to satisfy the audit. Input fingerprint: `9fdd702f52b77ea649fc3b5e117d052b65cf0e1b24f3f2a7632231875877a196`. Current assignment fingerprint: `935db7eab2db00b57fca9aebd97b2032d2cb4ea71ddd3e4aad7381b7c810a3ba`.

All 189 guarded write batches and all 189 independent typed read-back batches completed, with zero mismatches across 47,071 rows. No completed writes were replayed after a timeout. Full stored typed output roots (SHA256 of ordered 250-row chunk roots, each over ordered full-row MD5 leaves):

| Output | Rows | Root |
|---|---:|---|
| Ratings | 11,650 | `1f1bad5b14753d5be78bb768da397c9250ccbb796cba0d21c50d614263b45e86` |
| History | 35,421 | `8105c92c2b2b6abe47725ce9ae366dfe347891058d5e1d0f50a5a55498661e0e` |

## Release and rollback guards

Every promotion, activation and rollback locks model/source/child inputs and verifies full metadata, formula configuration, source/assignment/people/alias fingerprints, all typed output roots, counts, records and UUID keys. It checks the sole expected active model and the complete rollback predecessor. Atomic status changes use the existing restricted activation function. Failed live read checks restored predecessor `a29c4460-5e56-4d22-902d-ea39c65bfcac`; the new model was archived intact and re-promoted only after the same complete guards. The older person candidate `cd6d932e-289d-42e2-a79c-a699d1dedcfa` was never activated.

The predecessor still has 11,724 ratings (MD5 `2f6dcc16a26368c4aa018884a2116cbe`) and 34,809 history rows (MD5 `1893a665b47ad8965cdf42eba622d73c`). History ordering is full-row text COLLATE C with LF separators. `supabase/audits/usa_release_20261110.sql` verifies the active release and rollback contents without changing model status; private promotion/activation/rollback scripts are retained locally with expected-state guards.

## Read reliability work

The first live activation exposed a history timeout, subsequent trials exposed protected person classification, search and club reads. Every failed release check was followed by the guarded predecessor restoration; passing administrator measurements alone were never treated as success.

Final read design uses fixed-search-path invokers, indexed history lookup with complete paging, a synchronous source/current-person appearance projection, the shared classifier scoped by age or requested people, complete age-population standings, and season/club-scoped aggregation. Source and assignment writes serialize through a transaction advisory lock and maintain nullable person IDs in the same transaction. This creates no asynchronous classification cache. RLS, denied private evidence, no-login, noindex/no-store and the three-second app role timeout remain unchanged.

The initial complete person Rankings gate passed ten fresh protected reloads with numeric strengths and no stale warning. Comparison showed Nolan Manning 1338 ±291 / 0–1 and Luke Palazzo 1662 ±291 / 1–0; Nolan's November 7 loss remains TF 16–1 (3:09), 12U, bracket 70–74. Final verification after the Clubs deployment is still pending at this checkpoint.

Local lint, typecheck, 194 tests and build pass. Regression fixtures compare every cohort, standing, club metric and roster field, retaining mixed-age histories, rematches, null held sides, source/assignment mutation and rollback, complete history paging, and denied access. The historical held-out backtest remains unchanged because this release changes inputs and read planning, not the adopted formula or evaluation protocol.

The owner explicitly chose continued Free-plan optimization. The final club directory uses 23,555 private transaction-maintained source count groups representing 128,840 eligible appearances. Directory trial: ~96 ms under the restricted-role plan. Complete details are fetched four keys per query, at most two queries concurrently, with exact returned-key reconciliation. A transaction-local candidate-view audit over the entire production source found zero differences across 4,284 summary rows, 38,065 roster rows and all six all-season sort values. Only the floating schedule aggregate is normalized to 12 decimal places for read equality (the existing audit convention); every other field compares exactly. The transaction rolled back without changing model state or other sessions' reads.

Additional production migration versions: club normalization 20261110180014; bounded rating reads 20261110180104; season/club reads 20261110180223; projection-driven reads 20261110180547; transactional club inputs 20261110181622; covering rating inputs 20261110181937; obsolete-index retirement 20261110183231; bounded directory/details 20261110183531. Exact source definitions remain in supabase/migrations; intermediate applied migrations must not be replayed or edited. Final page deployment and complete live verification remain pending at this checkpoint.
