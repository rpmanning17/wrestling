# Identity audit — November 5, 2026

This document records the original read-only audit. The person-identity branch now implements canonical person IDs, assignment lineage and person-keyed candidate code; its production rollout and activation are still pending. See [IDENTITY_OPERATIONS.md](IDENTITY_OPERATIONS.md). The original audit itself performed no production writes.

## Verified full-history pass

Read all **67,736 matches / 135,472 participant appearances**, plus 125 entries, 322 observations, the reviewed wrestler alias and 390 reviewed club aliases. The audit indexes **11,816 current normalized name keys**, including entry/observation-only keys. These keys are not verified distinct people. No scouting-note text was read or exported.

Private match export pages contained 67,736 distinct source UUIDs. The full raw-row checksum was identical before and after collection: `62b66f3179fc648dfac09c4be09a15a6`. This is a checked paginated read of an unchanged source, not a claim that the connector maintained a repeatable-read transaction. Keep the private snapshot and metadata together; recheck freshness before considering any later correction. No export or participant report belongs in Git.

Automatic noise handling identified **122 name keys with casing/outer-space display variations already handled by existing identity rules**, and **30 administrative self-results already excluded by the rating policy**. These do not require owner review. No new identity merge is implied by handling that noise.

The first pass produced **610 candidate cases**, not 610 proven errors: one contested source self-match, one same-name context conflict, and 608 name-variant pairs with contextual or formatting signals. The first 25 cases, all original affected source rows and source coordinates are in a private review report. Some pairs share a wrestler label; they are separate proposed links, not automatic transitive identity groups.

The same-name context case combines 55 lb and 175 lb bracket appearances at different Florida events/clubs on the same date. It is a high-priority possible mixed history. Bracket labels remain source evidence, not measured bodyweight. The self-match may be a source error or two same-name people; it is not an automatic split. Participant names and the complete case evidence are deliberately retained only in the private report.

## Reuse

```powershell
pnpm identity:audit --input C:/private/identity-snapshot.json --report C:/private/identity-report.json --review C:/private/identity-first-25.md
pnpm identity:audit --input C:/private/identity-snapshot.json --report C:/private/identity-next.json --review C:/private/identity-next.md --decisions C:/private/identity-decisions.json --batch-size 25
```

All commands have zero network/database calls. Outputs are exclusive private writes outside the repository, including symlink resolution. Stdout contains counts, never participant names. Batch sizes are 1–30; the JSON report preserves all queued cases. The Markdown report expands each selected case to its affected original match records; entry/observation context is retained in JSON. Inputs have a 128 MiB file limit and 250,000-match bound.

Snapshot contract:

- `matches`: compact arrays in this exact order: `[id,event_date,event_name,city,state,weight_class,round,winner_name,winner_team,loser_name,loser_team,result,win_type,source_file,source_row]`. IDs must be unique; source coordinates may be null.
- `aliases`: existing `alias_key,canonical_key,canonical_name` records.
- `clubs`: existing `alias_key,club_key` records. SQL-compatible normalization preserves punctuation-boundary spaces before matching reviewed club aliases.
- `entries` and `observations`: original context rows; omit observation free-text notes and unrelated private content when exporting.
- Optional `source_checksum`: provenance for the retained input. This CLI does not independently verify a live database.

## Discovery rules and limitations

Apply existing reviewed wrestler aliases without editing raw names. Scan the full match history for contested same-key opponents and for same-day different-event/different-club appearances with different recorded states or unambiguous numeric bracket ratios of at least 1.6. The latter is an explicit triage heuristic, not a validated identity test. Club switching, atypical weight changes or multiple brackets at one event alone never produce a split case. Combined/range bracket labels abstain from numeric comparisons.

Generate nearby spelling candidates using a one-character deletion index: exact punctuation/spacing variants, one-character substitutions and one-character insertions/deletions. This bounded first pass does not cover all nicknames, transliterations, transpositions or multi-character misspellings. Non-formatting candidates additionally need a shared club, shared event/club/bracket context or at least two shared opponents. Current entries/observations are included as case evidence; they are not treated as proof that two labels identify the same person.

Repeated bouts at an event do not multiply the number of shared event contexts. Direct matches between proposed aliases are explicitly flagged as evidence to preserve separation. A shared club or opponent is not confirmation: siblings and unrelated teammates can share both. Names with asterisks, internal spaces or spelling differences therefore remain candidate links until source evidence establishes identity; no arbitrary name edits are made merely to reduce the queue.

Priority ranks contested self-matches, context contradictions, distinct shared contexts/opponents and affected source volume. It is not a probability, a computed rating-impact estimate, or a claim that a large history is more likely erroneous. Connected-opponent counts indicate review scope; no ratings were recalculated. Discovery is a full-data scan with limited candidate rules, not proof that all identity errors were found.

## Durable decisions without repeated questions

Keep a private JSON array of decisions:

```json
[{"caseId":"<64 hex characters>","evidenceHash":"<64 hex characters>","disposition":"unresolved","reason":"No additional source evidence; retain separately"}]
```

`unresolved` and `keep_separate` suppress a case only while its relevant evidence hash matches. The hash covers the versioned keys, all affected source records, context records and resolved club keys. Unrelated imports do not reopen it; changed relevant evidence does. Duplicate decisions, empty reasons and merge directives are rejected. Suppression affects only the private review queue, never database records or ratings. Existing name-key collision cases cannot actually be separated in the current schema by a queue decision.

## Next architecture step (planned)

Introduce permanent person IDs independently of names, source appearance-to-person assignments, reviewed source aliases, and a reversible merge/split decision ledger. Same-name people require appearance/context-specific mappings; a global name alias is insufficient. Preserve original raw rows, all model versions and note associations. Before applying any identity change, produce a complete affected-reference/notes report and retain reversible prior assignments. Notes with uncertain person attribution must remain unresolved rather than guessed. Existing global name aliases remain compatible during transition. This architecture and its migration are separate work; this audit does not implement them.

## Validation

Local lint, typecheck, **164 tests** (10 new identity tests) and production build pass. Build uses dummy environment values. pnpm scripts use the existing Windows sandbox workaround `--config.verify-deps-before-run=false --config.manage-package-manager-versions=false`; the dependency lockfile is unchanged. The existing generated club-SQL test normalizes CRLF as in importer PR #13, without modifying applied SQL. Tests verify no input mutation, existing aliases, same-name candidates, innocent club/bracket changes, context counts, source ordering, evidence-aware suppression, malformed snapshots and private CLI outputs.
