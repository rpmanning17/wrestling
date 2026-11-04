# Club normalization — 2026-11-04

Production migration `approved_club_normalization` applied to `tprodwivvwvpmpzaedom` as **20261104161409**. Source: `supabase/migrations/20261104161040_approved_club_normalization.sql`. The existing migration-history filename mismatch remains; do not use a blind CLI push.

## Scope and provenance

The owner approved all 154 naming-pattern groups and supplied the explicit cross-group relationships. The conversation reader did not return the earlier executable SQL/mapping. `config/club-normalization.approved.json` is a finite reconstruction from the supplied decisions and current ranked labels, not a claim of byte-for-byte reproduction of the unavailable earlier SQL.

Discovery removed superficial Wrestling, Club, WC, Academy, Team and Youth tokens (including separated W/C abbreviation tokens), yielding 154 naming groups. Explicit pairs connect entire groups. **Discovery is not a runtime rule:** only literal manifest aliases are inserted; future imports are not fuzzy-merged. School/location words outside this finite reconstruction are not indiscriminately stripped.

All 13 existing alias rows, timestamps, canonical keys and relationships remain intact. Longwood retains `longwood-wrestling-club`; Spartan retains `spartan-rtc`, with program relationships, separate from LHP. Camden County A is a team under Camden Outsiders; combined Caveman/Phoenix labels are programs. Team Barracuda`s is included. I Own Florida, Jefferson Dragons, Panthers Legacy and Pensacola remain unmapped.

## Actual production result

| Measurement | Before | After |
|---|---:|---:|
| All-season club identities | 1,182 | **952** |
| Alias rows | 13 | **390** |
| All-season wrestler/club memberships | 11,007 | **9,943** |
| Raw matches | 31,845 | **31,845** |
| Contested matches excluding the self-match | 30,133 | **30,133** |
| Raw contested matches resolving to the same club | 2,009 | **2,076** |
| Club-view participant appearances | 59,850 | **59,850** |
| Club-view in-house participant appearances | 4,004 | **4,138** |

The manifest contains **148 consolidated groups / 378 previously ranked identities**, plus the raw Barracuda typo. Two manifest rows existed, so **377 aliases were inserted**. Affected memberships consolidate **5,285 → 4,221**, a reduction of **1,064**. These are membership aggregations, never deleted bouts.

The earlier handoff projected 146 groups / 376 identities / 375 inserts and 5,309 → 4,243 memberships (1,066 fewer). The reconstructed mapping differs by two groups, two identities and two insertions, while preserving the exact **952-club** and **67-additional-in-house-match** results. The unavailable earlier row-level mapping prevents attributing the difference to specific earlier rows. This is recorded as a reconstruction difference, not falsely attributed to imports or silently adjusted to match totals.

Seven raw in-house matches have empty club labels. Club views exclude blank affiliations, so their after count is twice 2,069 rather than twice 2,076. Query semantics are unchanged.

## Migration and rollback

The migration locks aliases, validates exact PostgreSQL keys, rejects duplicate keys and canonical/name/relationship conflicts, and rejects changes to its expected existing-row baseline. No upsert/overwrite path exists.

The production envelope (`scripts/clubs/production-rollout.ts`) additionally locks protected inputs, compares complete-row checksums, preserves every existing alias, and asserts 952 clubs / 390 aliases / 9,943 memberships / unchanged participation totals before commit. Failed assertions roll back the entire transaction.

Actual insertions, including timestamps, are captured in `private.club_normalization_20261104_inserted`. RLS is enabled; public/anon/authenticated/service-role privileges are revoked. Security advisor reports one **informational** RLS-without-policy notice for this intentionally denied private ledger, no warnings/errors. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Administrator rollback: run `supabase/rollbacks/20261104_approved_club_normalization.sql` separately from normal migration replay. It verifies every inserted row still matches the ledger, aborts on later edits/missing rows, deletes only actual insertions and removes the ledger. Reconcile migration history separately after rollback.

Regenerate SQL with `node --import tsx scripts/clubs/generate-normalization.ts`; this command does not connect to a database.

## Verification

- Mapping tests cover every manifest row, explicit cross-group pairs, conflict rejection, precise rollback, refusal after later edits, protected existing relationships and denied ledger privileges.
- Both literal Gateway keys and both Sunset keys are retained. Exact normalizer: `regexp_replace(lower(trim(name)), '[^a-z0-9]+', ' ', 'g')`. Never trim its result.
- A synthetic 1,182-identity fixture becomes 952, preserves every raw label/bout/season and returns to 1,182 on rollback.
- Complete-row before/after checksums match for matches, wrestler aliases, entries, observations, evidence, model configuration, all 7,788 model ratings, all 16,951 history rows and all 729 cohort standings.
- Independent raw-participation audit checks **2,248 club/season summaries** for records, roster cardinalities, opponent averages and reference-1,500 schedule expectations: **zero mismatches**.
- Unauthorized anonymous reads return zero aliases, rankings and rosters. Invoker views/access controls remain unchanged.
- Live Camden: 122 wrestlers / 1,126 appearances / 719–407 / 45% schedule difficulty, with Camden County A in mapped labels. Longwood: 76 / 1,072 / 43%; club comparison agrees.
- Rankings and Longwood preserve Waylon's **524.34 / #12 of 28 / Tier 5**, Glicko 1514 ±122 and wrestler schedule difficulty 41%.
- Phone-width Camden, Longwood, rankings and club comparison have equal scroll/client widths (375 CSS pixels excluding the scrollbar); screenshot inspection confirms layout.

Aliases take effect immediately through ordinary views. No rating formulas or models were recalculated. Release checks and publication status are in STATUS and the final release report.

