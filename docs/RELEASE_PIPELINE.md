# Tournament release pipeline (agent-operated)

This is **the** procedure for importing a tournament and releasing refreshed ratings. It replaces hand-run connector batches. Agents run it; there is no in-app import UI. Code: `scripts/release/run.ts`, `src/lib/imports/results-adapters.ts`, `src/lib/release/identity-plan.ts`. Execution: `.github/workflows/tournament-release.yml`. Database support: migration `20261112160000_agent_release_pipeline.sql`.

## Why it is built this way

- **Bulk data never passes through an AI conversation.** The CI runner connects to Postgres directly. It streams the repeatable-read snapshot (~220k rows) and writes guarded rating batches (~47k rows). The agent's context only carries the raw tournament file once, plus counts, hashes and UUIDs.
- **Nothing private reaches the public repository.** This repo and its Actions logs are public. CI inputs are a run UUID only. Raw files, identity plans and reports live in RLS-locked `private.import_*` tables. The CLI prints only counts, hashes, UUIDs and error text that the code controls.
- **It reuses the established release code.** The pipeline calls these unchanged:
  - `validateNormalizedMatchCsv` and `guardedMatchImportSql`;
  - the USA function `private.import_usa_bracketing_verified`;
  - `readVerifiedSnapshot`;
  - `calculate-snapshot-candidate.ts` (unchanged daily Glicko-2 with decision score 0.8);
  - `validate-snapshot-candidate.ts` (independent replay and audit);
  - `snapshot-rollout-sql.ts` (guarded 250-row batches with typed read-back);
  - `private.activate_rating_model`.
- **Least privilege.**
  - CI uses the dedicated login role `matnotes_release`. It can insert sources, identities and models, flip model status, take the locks the release checks need, and read what the app reads.
  - It cannot update or delete matches. It cannot change existing identity assignments while a person model is active, and it cannot approve its own identity plan.

## One-time setup (owner, ~5 minutes)

The repository cannot hold credentials, and agents cannot create GitHub secrets. The owner does this once:

1. Supabase Dashboard → SQL Editor. Run this once with a long random password you generate locally:
   `alter role matnotes_release with password '<password>';`
2. Supabase Dashboard → **Connect** → **Session pooler**. Copy the URI, then:
   - replace the user `postgres.tprodwivvwvpmpzaedom` with `matnotes_release.tprodwivvwvpmpzaedom`;
   - put your password in;
   - keep port 5432 and append `?sslmode=require`.

   The session pooler is required. The transaction pooler (6543) does not support the snapshot cursor, and the direct host is IPv6-only, which GitHub runners lack.
3. GitHub → repository **Settings → Environments → New environment** `production-data`. Under **Deployment branches**, choose "Selected branches" and add `main`. Add the environment secret `MATNOTES_DATABASE_URL` with the URI from step 2.

Rotate the credential by repeating step 1 and updating the secret. Revoke it with `alter role matnotes_release nologin;`.

## Per tournament (agent)

### 1. Store the raw source (admin SQL connector)

Preserve the original bytes; never edit them. `provider` is one of:
- `flo` or `trackwrestling`: the results-table layout `Date,Weight,Round,Winning Wrestler,Winning Team,Result,Win Type,Losing Wrestler,Losing Team,City,State,Event`, with or without `="…"` wrappers;
- `normalized`: the Mat Notes normalized schema in `MATCH_IMPORT_READINESS.md`;
- `usa_bracketing`: a reviewed JSON bout package in the exact shape `private.import_usa_bracketing_verified` accepts.

Any other layout fails closed with the expected header. Add an adapter with tests rather than hand-converting.

```sql
insert into private.import_sources (provider, original_filename, sha256, content)
values ('flo', 'SomersetSundayFallBrawl.csv', '<sha256 of file>', decode('<base64 of file>', 'base64'))
returning id;
insert into private.import_runs (source_id, request) values ('<source id>', '{
  "source_file": "SomersetSundayFallBrawl.csv",
  "divisions": ["10U","12U","14U"],
  "expect": {"source_rows": 88, "imported": 26, "excluded": 62}
}'::jsonb) returning id;
```

A constraint rejects bytes that do not match the declared SHA-256. Optional request fields:
- `season`: the default is the August 1 boundary used by existing rows;
- `as_of_date`: the default is the day after the latest source bout;
- `identity_overrides`: `[{"source_row":13,"side":"winner","action":"hold"}]` or `{"action":"person","person_id":"…"}`; owner decisions only;
- `allow_cross_source_duplicates`: default false.

### 2. Plan (dry run)

```bash
gh workflow run tournament-release.yml -f run_id=<run id> -f phase=plan
```

The guarded import and the identity rule run inside a transaction that is always rolled back. The run row receives:
- `plan`: every bout side with its resolution, compatible history count and number of same-name people;
- `plan_sha256`;
- `report.adapted`: counts, exclusions by division, methods, rematch diagnostics;
- `report.dry_run`: imported count and cross-source duplicates;
- `report.predecessor`: the active model.

Watch with `gh run list --workflow tournament-release.yml` and `gh run view <id> --log`.

### 3. Review and approve (admin SQL connector)

Read `plan` and `report` from `private.import_runs`. The identity rule is the owner-authorized USA release rule:
- **Link:** exactly one historical person with the exact full name, plus at least two of that name's bouts within 730 days, 15 lb and two age groups.
- **New person:** an unseen name, grouped by name plus known club alias, with bounded age and weight.
- **Hold:** everything else, including both sides of one bout resolving to the same person.

Identical names alone never link. Look specifically at:
- held sides;
- new people whose names resemble existing people;
- wrestlers appearing in several brackets on one day.

If a decision needs the owner, put it in `identity_overrides` and re-run `plan`. Approval is recorded by the administrator connection, not by CI:

```sql
update private.import_runs set approved_plan_sha256 = plan_sha256, status = 'approved', updated_at = now() where id = '<run id>';
```

### 4. Release

```bash
gh workflow run tournament-release.yml -f run_id=<run id> -f phase=release
```

The steps run in order. Each is resumable: re-running `release` continues from database state and never replays a conflicting write.

1. **Import and assign (one transaction).**
   - Guarded inserts. An existing source key must match every field.
   - Cross-source duplicate check.
   - The plan is recomputed and must equal the approved hash.
   - First identity assignments are written for every new bout side; held sides get a null person.
   - Allowed while a person model is active only because every row is revision 0 for a source the active model never rated.
2. **Snapshot.** One repeatable-read read-only transaction captures the atomic four-table manifest and streams 1,000-row pages in the existing format. `readVerifiedSnapshot` re-verifies every root.
3. **Calculate and validate.** Uses the existing scripts, with the commit as `code_version`. The production formula is asserted, and the full payload is replayed and independently audited.
4. **Persist.**
   - The model row is reused only if all metadata matches.
   - For each 250-row batch: a typed read-back first, then a write only when needed, then a read-back requiring 0 mismatches.
   - Output roots are computed with the release-audit encoding.
5. **Promote.** Locked transaction: metadata, exact counts, stored roots equal to the payload, and source manifest equal to the snapshot. Then building → candidate.
6. **Activate.** Locked transaction:
   - the expected predecessor is still the sole active model;
   - candidate metadata and roots are unchanged;
   - the source manifest is unchanged;
   - the predecessor is complete (its roots are recorded as rollback evidence);
   - `private.activate_rating_model` is called;
   - post-check: one active model, predecessor archived. The person-model trigger re-checks the source count, assignment coverage and fingerprint.
7. **Verify.** This is also its own phase (`-f phase=verify`). It checks, through the reads the app uses:
   - the active model, and `person_rating_current` count equal to `wrestlers_rated`;
   - imported rows and full side coverage;
   - assignments equal to the approved plan;
   - every person with a rated bout in this source shows the new `last_match_date`;
   - cohort-projection age coverage;
   - `person_cohorts_by_ids` and `person_match_history` for those people;
   - non-empty `current_person_strength` Rankings for each age group with assigned sides;
   - five fresh live loads of `/`, `/rankings` and `/clubs`, each needing at least 4 of 5 HTTP 200s plus `no-store` and `noindex`.

   Isolated Free-plan timeouts are recorded rather than hidden.

Progress and evidence are kept in `private.import_run_events` (append-only) and `private.import_runs.report`.

### 5. Rollback

```bash
gh workflow run tournament-release.yml -f run_id=<run id> -f phase=rollback
```

The default target is the run's recorded predecessor; pass `-f rollback_target=<uuid>` for another archived model. `private.rollback_rating_model(target, expected_current)`:
- locks `rating_models`;
- requires the expected current model to be the sole active one;
- requires the target to be archived with complete output;
- then activates it.

A person-keyed predecessor whose source coverage is now older can be restored. That is expected for rollback and is allowed only through this function. Ordinary activation still refuses stale person models. Source rows and identity history are never deleted.

### 6. Record

Update `docs/STATUS.md` with:
- run id, model UUID, predecessor;
- counts (imported, excluded, linked/new/held, rated bouts);
- input fingerprint, output roots;
- verification results.

Do not commit plan contents or names.

## Tested

- `tests/imports/results-adapters.test.ts`: layouts, line-number provenance, exclusions, fail-closed cases.
- `tests/db/release-pipeline.test.ts`, run on every migration in PGlite:
  - the plan rule (link, new, multi-person hold, self-match hold, weight-incompatible hold);
  - first assignments under an active person model, and refusal of changes;
  - guarded rollback to a stale person model, while ordinary activation of it is refused;
  - role privileges, including no self-approval;
  - raw-source hash integrity.
- On 2026-11-12 the full CLI ran end to end against a local PostgreSQL 16 cluster with synthetic data:
  - plan, approve, release and verify for a tournament with a name-key predecessor;
  - a second tournament under an active person model;
  - idempotent re-run (0 writes, all read-backs matched);
  - rollback to the stale person predecessor.
- Production is PostgreSQL 17. Locally, `GRANT MAINTAIN` was substituted with an equivalent lock-capable grant; PGlite runs the migration as written.

## Limits

- Placements and tournament observations are not imported by this pipeline (D-rules: placements are not wins). Use the existing observation pipelines.
- The Flo/Trackwrestling adapter supports the results-table export used by every archived production import. Other export layouts need a reviewed adapter.
- Free-plan CPU starvation can still cause isolated `/rankings` timeouts (`Person cohort classification unavailable`). Verification reports them per load.
