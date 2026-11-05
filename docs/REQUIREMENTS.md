# Requirements

Club normalization expansion (2026-11-04): finite owner-approved aliases are applied and production-verified at 952 identities. F13/F14 retain event-specific labels and records. See CLUB_NORMALIZATION.md for actual counts and reconstruction differences from the earlier projection.


Status column: **Implemented** means code exists in this repo and is covered as described in `STATUS.md`. **Partial** and **Planned** are labelled honestly. Anything marked *unverified* has not been checked against production data.

## Product

Mat Notes is a personal, mobile-first scouting tool for Florida youth wrestling. It must be fast to use at a tournament, on a phone, with one hand. It is generalized: it works for any wrestler, not only the owner's son.

Owner context used for the "likely opponents" feature (kept as configuration in `src/lib/scoring.ts`, not as data): Nolan is not in the imported results; club Alpha; DOB October 31, 2015; 5th grade; open division; about 69 lb now (maybe 71 later); likely 12U at 70/75 lb; Orlando area is the focus.

## Functional requirements

| # | Requirement | Status |
|---|---|---|
| F1 | Search wrestlers by name with fuzzy matching and show evidence for each suggestion | Implemented (`findWrestlers`) |
| F2 | Compare a list of wrestlers (a bracket): record, age group, weight, cohort rank, likelihood and strength, recent bouts, placements, notes | Implemented |
| F3 | Saved comparisons, results browser, "add a missing bout" form | Implemented (see `src/app/actions.ts`, `compare-actions.ts`, `results/`) |
| F4 | Private scouting notes per wrestler, queued offline-tolerant sync | Implemented (`wrestler_notes`) |
| F5 | **Wrestler identity resolution:** one canonical identity per real person; spelling aliases are reviewed and the original label stays searchable; uncertain identities are never merged | Implemented for reviewed aliases (`wrestler_aliases`). Automatic merging is not done on purpose. Same-name different people cannot be distinguished: known limitation |
| F6 | **Flo imports:** tournament placers and weight-class tables captured from Flo event pages become `tournament_observations` with provenance (file names, ZIP hash) | Partial. Only the PowerShell builder `supabase/importers/build_tournament_observations.ps1` is in the repo. The match CSV importer is outside the repo |
| F7 | **Age and weight inference** from division birth-year bands and bracket classes, with a confidence label; no exact body weight from a bracket; no birth date from a division | Implemented in SQL (`private.refresh_wrestler_evidence`), see `DATA_MODEL.md` |
| F8 | **Tournament placements** are stored and shown as placements; never converted into wins or losses | Implemented |
| F9 | **Opponent-adjusted wrestler ratings** (Glicko-2): rating, uncertainty (RD), conservative ranking score, provisional status, SOS and quality-win explanations, method and margin breakdowns, head-to-head and common opponents | Implemented and tested offline. **Calculated, active and live-verified 2026-11-03** |
| F10 | Chronological backtesting without future leakage, comparing the baseline against alternatives | Implemented (`pnpm ratings:backtest`). **Real-data confirmation completed; see BACKTEST_REPORT.md** |
| F11 | Versioned, recalculable rating models that never destroy raw matches or earlier models | Implemented (migration 009 already applied to production, active model calculated 2026-11-03) |
| F12 | Keep two views: the career opponent network (all matches, all ages) and current age/weight cohort rankings | Live; cohort view reads `wrestler_strength_current` from the active model |
| F13 | **Club identity normalization**: confirmed aliases, historic team attribution, unverified program relationships kept separate | Implemented on main via migration 010; **deployed and verified 2026-11-03** |
| F14 | **Club rankings & comparisons**: roster depth, active roster rating distributions, quality of opponents, season filters, club profiles and side-by-side comparisons | Implemented on main; **deployed; power/SOS populated and live-verified 2026-11-03** |

| F15 | **Athlete autocomplete**: show matches while typing; display age division, bracket weight, club beneath the name without inventing exact age or bodyweight | Implemented on main; **deployed and verified 2026-11-03** |

## Non-functional and safety requirements

- No logins or accounts. Access is the Vercel Authentication gate plus a server-only database key. Keep `noindex` and `no-store` headers.
- Raw matches and evidence are preserved; derived tables can be rebuilt.
- Never use future results to score a past prediction. Dominance or margin adjustments stay experimental unless a backtest shows a meaningful, well-calibrated improvement.
- "Likely for Nolan" (matchup likelihood: age/weight fit, activity, Orlando proximity) is a separate quantity from strength and must stay separate in the UI.
- The 0 to 1000 cohort strength display stays; when a model is active it is the min-max of the conservative score within the (age group, 10 lb band) cohort.
- Secrets never enter the repository or chat.
- Mobile first: no horizontal scroll, large tap targets, details collapsed by default.


## Cohort tiers and rating clarity (2026-11-04)
F16: population decile tiers (1 strongest to 10 weakest), minimum 20 rated cohort members, ties kept together and no tier for missing/tied cohort support. Implemented in SQL and shared UI; production verification is recorded in STATUS. Strength, tier, uncertainty and Matchup Likelihood remain separate. Existing club views use precise raw-Glicko labels and current wrestler cohort metadata without new browsing capabilities.


## Next-step ingestion reliability (2026-11-04, unmerged feature)

F17 (Partial): Provide a normalized Mat Notes match-CSV staging tool with strict original source provenance, dry-run validation, a reviewable batch output, and no automatic merges. The current implementation covers the normalized schema and conflict-checked SQL only. Raw Flo/Trackwrestling header-to-normalized import remains external and unverified.

F18 (Partial): Warn when the active rating model's stored raw-source match count differs from current database count. Equality is not source-fingerprint verification. This flag cannot catch edits or alias changes without a count change; supervised full fingerprint checks remain required for activation.
