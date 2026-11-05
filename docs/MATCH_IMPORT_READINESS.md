# Match ingestion: normalized CSV validation and guarded staging

**Status:** offline staging implemented in draft feature PR; not production deployed; no imports or schema changes performed. Raw Flo/Trackwrestling converters are still external and must be audited separately. This path accepts only **normalized Mat Notes match CSVs** (such as `mat_notes_2025_matches.csv`), not arbitrary Flo CSVs.

## Existing normalized shape

Required CSV header fields, in any order:

`event_date,season,event_name,city,state,weight_class,round,winner_name,winner_team,loser_name,loser_team,result,win_type,source_file,source_row`

Optional: `index` or `Unnamed: 0` from a dataframe export. All other columns are rejected rather than silently discarded. Supports UTF-8 BOM, CRLF, quoted commas and quoted newlines. The data format matches public.matches column lengths and strict date parsing.

**Source identity is `(source_file, source_row)`**. Values must identify the original CSV inside its original archive, not this newly generated staging CSV. Never reuse source row numbers from different files under the same source_file label. Duplicates inside a proposed import are rejected. The database has a unique constraint on this key.

## Stage a new normalized file locally

Use a reviewed private local CSV **outside the repository**:

```bash
node --import tsx scripts/imports/prepare-matches.ts --input ../private/tournament-normalized.csv
node --import tsx scripts/imports/prepare-matches.ts --input ../private/tournament-normalized.csv --out ../private/tournament-guarded.sql --report ../private/tournament-report.json
```

The first command is validation-only. The second also writes **reviewable SQL containing participant identities** outside Git. Both perform **zero database calls** and make no DB changes. Repeated/opposite-winner same-event match pairs are only reported; genuine rematches are not dropped. Source methods such as `OTHER1` are preserved for review (and separately excluded by the rating classifier). New unknown method codes cause the staging command to fail, not guess.

Only use the SQL through the already authorized administrator connection after reviewing the source/provenance and taking a source snapshot. Each batch is an atomic `DO` block that checks exact existing source rows, inserts only missing unique source keys, and rechecks for conflicts. A same-key changed score/name/team/date aborts the batch. No upsert, overwrite, match deletion, alias merge, rating update, permission grant or schema change is generated.

### Important boundaries

- The upstream process that converts original Flo/Trackwrestling exports to the normalized schema is **not bundled** or certified. Its original headers, event/date/age parsing, method mapping, source row numbering, and completeness must be verified against the actual external archive before use. Do not call this an end-to-end raw Flo importer.
- The normalized CSV does not create placements, identity aliases, tournament observations, or age evidence. Those have distinct reviewed pipelines.
- Results are historical raw records; do not infer bodyweight from bracket labels, change identities, or collapse same-opponent pairings.
- SQL generation is for a human/authorized execution workflow. It does **not** upload automatically or run as a production API.
- After executing any import, verify affected row counts and source fingerprints, refresh evidence through the established reviewed procedure, and recalculate ratings separately using `docs/RATING_OPERATIONS.md`. The new warning banner detects changes to **source row count**; it does not validate the full rating input fingerprint or alias changes.
- Changes to existing rows (including manual edits) with the same row count may not trigger the banner. For authoritative freshness, compare the frozen full input fingerprint and active model provenance.

## Regression tests

`tests/imports/matches-csv.test.ts` checks real normalized columns, date/source validation, quoted text and CSV parsing, source-key uniqueness, same-event opposite-winner rematches, and actual SQL execution in PGlite: exact retries, rollback on source-key conflicts, and quote-injection safety.

No imports or rating recalculations have been run using this new importer in production.
