# Decisions

Newest first within each area is not required; each entry has a date, the decision, the reasons, and what was rejected. Add an entry for every major decision. Do not rewrite history: supersede an entry by adding a new one that references it.

## Project and process

**D1. GitHub is the authoritative record (2026-11-03).** Humans, Claude and ChatGPT/Codex all work from the docs in this repository, not from chat history. `AGENTS.md` and `CLAUDE.md` direct each agent to read the shared docs first; every substantial PR updates docs and `STATUS.md`. *Rejected:* keeping context in per-agent memory or chat summaries (lost between sessions, diverges between agents).

**D2. No application accounts (existing).** Access is Vercel Authentication plus a server-only database key; RLS rejects requests without it; `noindex` and `no-store` headers. *Reason:* personal tool, minimum attack surface, fast mobile use. *Consequence:* writes from batch jobs use a service-role key that only exists in the owner's local environment.

**D3. Schema changes only through migrations; applied migrations are immutable (existing, restated 2026-11-03).**

## Data and identity

**D4. Identity is the normalized name; merging requires a reviewed alias (existing).** `lower(trim(name))` is the key. Aliases are rows with a reason and confidence, originals stay searchable. *Rejected:* fuzzy auto-merge (silent wrong merges would corrupt ratings and notes). *Cost:* same-name different people are not separable; audit query 5 measures it.

**D5. Placements are evidence, never wins (existing).** Tournament placements are stored and displayed; they never become match results and do not feed the rating.

**D6. Age group and weight come from division and bracket evidence only (existing).** No exact body weight from a bracket, no birth date from a division, no forced youth grouping for 2020 to 2022 birth years, girls' bands or high school.

## Rating model (2026-11-03, Claude session; unvalidated on production data)

**D7. Glicko-2 as the baseline.** It is a published, open specification, models uncertainty (RD) natively, grows uncertainty with inactivity without lowering ability, adjusts for opponent strength inside the update, and needs no arbitrary newcomer cap or minimum-match rule. *Rejected:* Elo (no uncertainty), Bradley-Terry/Massey batch fits (harder to explain, no natural recency), and extending the legacy heuristic (ignores opponents). Elo and a smoothed win-rate model are kept as backtest baselines.

**D8. Batch pipeline with immutable versioned models, not a SQL view.** The rating is a sequential filter over time with per-period state; a view cannot express that cleanly, and models need configuration, fingerprints and rollback. Raw matches and old models are never modified. Activation is a status change guarded by a unique partial index.

**D9. Conservative ranking score = rating − k × RD, k = 1.** Simulations with the default curves showed k = 1 lets a strong newcomer rank above a weaker established wrestler, while k = 2 hides most newcomers. Configurable and stored per model; to be revisited with the real backtest.

**D10. Contested outcomes only.** Decisions, major decisions, tech falls and falls are rated. Forfeits, medical forfeits, defaults, disqualifications, no contests and byes are excluded by default and reported; unknown methods are excluded and listed. *Assumption:* production `win_type` values were not inspected. A backtest policy variant measures including DQ/default; policy variants are never auto-adopted.

**D11. Strength of schedule is explanatory only.** It uses opponents' current ratings (hindsight). Feeding it back would double-count, because Glicko-2 already weights opponent strength inside each update.

**D12. Dominance/margin adjustments are experimental and off.** Adopt only if a held-out, paired-bootstrap backtest shows a gain of at least 0.002 log loss per match with the 95% interval below baseline and no meaningful calibration loss.

**D13. One global rating pool; cohort rankings are a view over it.** Cross-age and cross-weight bouts contribute. A bout's two wrestlers share a bracket, so there is nothing to discount per bout and no context-discount variant exists. Cohort rank uses latest evidence per (age group, 10 lb band).

**D14. Walk-forward leakage rule.** Predictions for an event come from the snapshot before the rating period containing the event's first bout; updates apply after the period. Tuning window and held-out confirmation window are separate. *Reason:* same-event and day-two leakage inflates every metric.

**D15. 7-day Monday-anchored rating periods; inactivity as RD growth; tau 0.5.** Standard Glicko-2 guidance (several games per period) and the paper's tau range; the backtest sweeps alternatives. Provisional/developing/established thresholds (RD 120/80) are provisional defaults.

**D16. UI never mixes rating systems.** When a model is active every profile uses it; with none (or the views missing) every profile uses the legacy view. *Reason:* a comparison mixing the two 0 to 1000 scales would be misleading. The 0 to 1000 display is preserved; its meaning changes when a model is active and this is documented.

**D17. Migration 009 is verified in an in-process Postgres (PGlite) with stubbed roles.** No Supabase access from the build environment; the test applies all migrations in order and checks constraints, the single-active rule, RLS wiring and view output. It does not replace applying the migration to a real project and rerunning checks there.

**D16. Do not widen the outcome classifier before the audit runs (2026-11-03, Claude session).** A code review found plausible spellings that `classifyMethod` returns as `unknown`: hyphenated forms (`DEC-OT`, `Dec-SV`, `MD-12`, `Fall-1:23`), a score inside `win_type` after an overtime code (`SV-1 5-3`, `TB-1 3-2`), dotted abbreviations (`T.F.`, `M.D.`), `2OT`, `DQ (unsport)`, `DFLT`, `Med FFT`, `MedFor`, and generic `W`/`WIN` (for these the `result` fallback is not consulted, because it only runs when `win_type` is blank). `Medical Default` classifies as `medical_forfeit` rather than `default`; both are excluded, so ratings are unaffected. Unknowns are already excluded and counted, which is the safe failure. *Decision:* change `outcomes.ts` only for values the audit actually finds, each with a test, rather than guessing a broader grammar (`matches.win_type` is at most 20 characters, which limits the space). Candidate fix if hyphenated forms appear: normalize `-` to a space in `clean()` for the method token while leaving `TF-1.5`-style tokens matching. *Rejected:* pre-emptively adding every spelling (risk of misclassifying a forfeit or default as contested, which would rate a bout that was never wrestled).

**D17. Audit SQL is executed in tests (2026-11-03, Claude session).** `tests/db/match-audit.test.ts` runs `supabase/audits/match_outcome_audit.sql` against the migrated schema in PGlite and checks that it writes nothing and finds seeded duplicates, swapped winner/loser records, multi-club names and unparseable weights. *Reason:* the audit is the evidence for D10 and D16; a syntax error would only be discovered in the SQL editor.

**D18. Outcome classifier stays unchanged; supersedes the open question in D16 (2026-11-03).** The production audit found only F, DEC, TF, MD, FOR, DEF, M FOR, DQ, MFFL, NC and one OTHER1 (a 0-0 bout, correctly excluded as unknown). None of the variant spellings listed in D16 occur, so the hyphen-normalization fix is not applied. *Reason:* changing working code for spellings the data does not contain adds risk without benefit. Revisit if a future import introduces new codes; the calculation report lists every unknown method.

**D19. Do not automatically drop opposite-winner pairs from Flo imports (2026-11-03, verified against raw source rows).** The preliminary audit found 65 opposite-winner pairs under its matching rules. A separate read-only grouping identified 57 such groups, 54 of them with blank round labels. Inspection of source-file and row evidence showed that at least some are genuinely separate contested matches: for example, Bradenton Brawl #1 on 2026-04-11 records Jett Newell beating Noah McCathy by fall and Noah McCathy beating Jett Newell 11–10, in consecutive source CSV rows. Other reverse-direction groups pair a contested result with a forfeit or default, where only the contested result belongs in the rating model. **Do not treat a matching date, event, bracket and opponent pair as proof of a duplicate, and do not delete or suppress both records automatically.** Existing exact same-direction duplicate filtering remains; raw matches stay immutable. Future deduplication must use demonstrable source-level evidence and tests, and report ambiguity instead of quietly removing legitimate rematches. Two regression tests cover these cases. A new, conservative, deterministic dedupe rule can be proposed after inspecting specific duplicate groups, but is not adopted here.


## Not yet decided / not built

- Club identity normalization and club rankings (F13/F14): no design committed. When started, record the identity-resolution approach and the rating method here and in `RANKINGS.md`.
- Whether duals should be weighted differently from tournaments: no evidence yet.
