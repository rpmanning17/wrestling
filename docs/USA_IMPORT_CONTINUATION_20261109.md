# USA Bracketing continuation — November 9, 2026

## Additional bounded Rankings tuning (2026-11-09)

After the earlier query improvement, read-only `EXPLAIN (ANALYZE, BUFFERS)` against production evaluated 12,043 cohorts in 4.97s, with 5,312 temporary blocks read and 8,263 written. Follow-up controlled trials were: default 4 MB 2.044s with temp spill; 16 MB 1.872s and 1.906s without spills; 32 MB 1.675s and 1.682s without spills. These are individual administrator-run full-view plans; none establishes app-role tail latency or repeated live-page success.

A new additive migration `supabase/migrations/20261109210000_rankings_anon_work_mem.sql` was applied through the administrator migration connector as **production version 20261109202737**, setting only the PostgREST `anon` role's `work_mem` to 32 MB. PostgreSQL/PostgREST support impersonated role transaction settings. Read-back verified `anon` config `statement_timeout=3s`, `work_mem=32MB`. No source/model/access changes were made. Eight existing informational no-policy notices remain unchanged. Under increasing concurrency, watch memory and error logs; revert using a new migration (`ALTER ROLE anon RESET work_mem`), not an edit to applied SQL.

**Release gate remains open** until repeated authenticated production Rankings loads and logs establish stability, followed by new person-based ratings calculation, full validation, source-fingerprint recheck and authorized activation.


## Verified outcome

The ratings-input export is complete and verified. A semantics-preserving cohort query improvement is applied, but Rankings still intermittently times out. No new rating calculation, rating persistence, candidate promotion or activation was performed. Do not activate the older person candidate.

Started from clean local branch `codex/person-identity`, refreshed remote history, and created `codex/usa-import-stability` from deployed main `b571038`. No open PRs were returned. PR #17 is merged and production deployment `dpl_5kxXkS9NvmfYwgwwSUgebqyP8rYC` is READY. The previous chat's reported counts were independently queried, not assumed.

## Source and identities

| Item | Verified count |
|---|---:|
| All source matches | 68,783 |
| Imported USA Bracketing bouts / events | 1,047 / 13 |
| Preserved private placement evidence | 878 |
| Imported placement observations | 648 |
| Assigned / held new bout sides | 1,926 / 168 |
| Assigned / held imported placements | 491 / 157 |
| All current source assignments | 138,661 |
| People | 11,750 |
| Wrestler aliases (not club aliases) | 1 |

No source, identity decision or held appearance was changed. Placements remain separate from bouts.

## Complete private export

Files live in ignored `exports/usa-20261109/`. This directory contains private source records; never add it to Git. There are 69 match pages, 139 assignment pages, 12 people pages and one alias page: **221 pages / 219,195 rows**, each page at most 1,000 rows. `snapshot-integrity.json` contains the successful offline validation. A connector interruption at match page 11 was investigated with a trivial connection check; earlier files were retained, and export resumed after the connector recovered. No interrupted database model was deleted or reused.

`supabase/audits/ratings_input_snapshot_manifest.sql` captures four full-row table fingerprints together in one SQL statement, hence one database MVCC snapshot. Each leaf is MD5 of the exact UTF-8 PostgreSQL `to_jsonb(row)::text`; each table root is SHA256 of the concatenated ordered leaf hex strings, with no separator. This is an operational equality/preservation check, not a signed archive authenticity claim. Ordering is UUID `id` for matches/people, `(source_kind COLLATE "C", source_id COLLATE "C")` for assignments, and `alias_key COLLATE "C"` for aliases.

Pages preserve those original JSON strings, rather than reserializing objects with different key order or whitespace. Verification reconstructs the root from every row, checks page sizes including the short final page, and rejects missing, extra, changed or reordered pages. Matching all roots reconstructs the atomic baseline snapshot despite transporting pages independently. A second production manifest and another post-migration manifest match the initial baseline exactly. This does not authorize activation against future changed inputs.

| Table | Verified root |
|---|---|
| matches | `d49c4c8c05a49004298830f14b73d41f6067e6d00dce0380ea5538bc558875a2` |
| assignments | `179c69b4fdc049b345485bed95d2f98c6bd9732c3830e044537a18648a377bf9` |
| people | `a2c3aa9ac6e134399e4666466b9e66c91a6f73f4d85efdc0afcf6b569faef985` |
| aliases | `5c5d646405687bc3ae7a21aa564734ca26cd69659689d2e339e63ae3c490624a` |

Recheck offline:

```powershell
node --import tsx scripts/ratings/verify-snapshot.ts exports/usa-20261109
```

For any future interrupted export, retain the original baseline and all complete pages. Read only missing pages in the recorded order, then verify every page against the original baseline. If verification differs, preserve that partial export and investigate; do not silently replace its baseline. A new source state needs a separately identified export. These files are inputs, not a calculated ratings payload. The historical `calculate-candidate.ts` deliberately assumes the older 67,736-row reviewed plan; do not bypass that guard or feed it this snapshot without a reviewed adaptation.

## Rankings investigation and applied query improvement

At 18:28:56 UTC, the live Rankings page showed server digest `4274830494`. Vercel reported `Current ranking classification unavailable`; Supabase recorded `canceling statement due to statement timeout` at the matching time. The app role `anon` has a three-second timeout. Administrator reads do not reproduce that access path's entire cost.

Migration source `20261109183704_bound_cohort_input_duplicates.sql` was applied through the authorized migration connector as **20261109184313**. The raw classification CTE uses UNION instead of UNION ALL, collapsing identical tuples before canonical joins. The existing canonical DISTINCT already collapses these same tuples; distinct teams, dates, event labels, source priorities, age values and weights remain distinct. No raw bout is deduplicated or deleted. The view retains `security_invoker=true`; permissions and RLS policies are unchanged. No stored cache, privileged query function, experimental formula or raised timeout was added.

The read-only full-source trial completed in 2.065 seconds, versus 2.340 seconds for the original measured filtered query. Subsequent applied-view measurements were 2.276 seconds and 2.173 seconds after ANALYZE. These are individual measurements, not a benchmark or a stability guarantee. Source statistics had not been refreshed after the 1,047-match import; matches, aliases, entries, observations and evidence were analyzed. **Two post-migration browser loads succeeded; one still failed at 18:44:16 UTC. The timeout remains open.** Keep this history when reviewing later error windows.

## Preservation checks

| Output | Rows | Unchanged full-row MD5 |
|---|---:|---|
| Current cohorts | 12,043 | `f5022a61199b1a209ade7b230a500d45` |
| Current standings | 1,132 | `64d2de6c084050d80fc15726ab13a834` |
| Active model ratings | 11,724 | `2f6dcc16a26368c4aa018884a2116cbe` |
| Active model history | 34,809 | `1893a665b47ad8965cdf42eba622d73c` |

Checksums use `md5(string_agg(to_jsonb(row)::text, chr(10) ORDER BY athlete_key COLLATE "C"))`; history uses full-row text ordering because each athlete has multiple periods. Source preservation uses the separately verified manifest above.

The sole active model remains **a29c4460-5e56-4d22-902d-ea39c65bfcac**, `name_key`, 67,736 source bouts. Candidate **cd6d932e-289d-42e2-a79c-a699d1dedcfa** remains person-based and stale. Its status was not changed. Security advisor before and after reports only the same eight informational RLS-without-policy notices for deliberately denied ledgers; no new warning/error was returned. Health advisor returned no notices.

## Validation and remaining release gates

Lint, type checking, all **187 tests**, and production build pass. Database fixtures compare every cohort and standing field with the previous views, check source-row preservation and denied unauthorized access. Four snapshot tests exercise a short final page, interrupted export, same-count corruption/reordering, stale extra pages and incomplete metadata.

The desktop pnpm launcher attempted dependency auto-install and failed on its external-store symlink. The installed pnpm entry point succeeded with `--config.manage-package-manager-versions=false --config.verify-deps-before-run=false` for all four required scripts. Dependencies and lockfile were not changed. Build used dummy environment values.

Live browser checks verified comparison loading, the exact 68,783-versus-67,736 freshness warning, expanded rankings on successful loads, and Nolan Manning's November 7 loss to Luke Palazzo: event `TOF-Folkstyle Spartan RTC #1`, **12U**, bracket `12U - 70-74`, `TF 16-1 (3:09)`. The profile correctly remains unrated in the older active model. Screenshot evidence is private at `exports/usa-20261109/imported-bout-verified.png`. HTTP HEAD returned 200 and retained `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` and `X-Robots-Tag: noindex, nofollow, noarchive`.

Outstanding: make the cohort classification reliably fit the actual app-role execution budget; then adapt the reviewed person-candidate exporter to this verified source/assignment snapshot, calculate with unchanged daily/decision-0.8 settings, independently validate complete records/SOS/history and exact persisted output, recheck live fingerprints, and obtain the separately required activation authorization. Full production stability and a refreshed active ratings model have **not** been achieved by this continuation. No broad deployment or automatic recalculation was introduced.
