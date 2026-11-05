# 2025 Flo archive reconciliation — November 5, 2026

**Read-only verification. No import, migration, evidence refresh or rating activation performed.** This advances Phase 1 source acceptance; it does not complete the production import exercise.

## Finding

No clearly new 2025 bout was identified in the inspected original archive. The live database contains 35,861 calendar-2025 records. Twelve additional same-file source rows exactly repeat retained records and remain unresolved, rather than being declared proven duplicates or imported as new bouts. Three of these are contested outcomes; nine are forfeits. Missing/unnamed participants remain excluded from candidate imports, with original evidence retained privately.

The original `2025 Results.zip` contains 104 CSV members / 53,315 data records. Archive SHA-256: `b74440c9a8b7a6314ebc82c7f88e4176f5369f4f15bebdb4f6c3c44797e65ae0`.

| Source-row disposition | Records |
|---|---:|
| Present at original archive/member/row coordinates | 35,891 |
| Missing at least one named participant | 8,882 |
| Named results in four byte-identical duplicate export files | 7,311 |
| Same-file rows identical to retained records; unresolved | 12 |
| Early-2026 results present under the separate 2026 archive | 1,215 |
| Named-participant rows explicitly coded BYE | 4 |
| **Total original archive records** | **53,315** |

Of the 35,891 records imported under this archive, 35,861 are dated in 2025 and 30 in early 2026. The filename is not an authoritative year filter. Three other members dated January 4, 2026 are represented by 1,215 exact content matches under `20260101-20261027 Results.zip` (1,213 stored rows because two source records repeat retained content).

## Comparison method and evidence

Read original ZIP members without extraction, using the bounded reader, strict UTF-8 decoding and original CSV record indexes. Decode the observed spreadsheet wrappers and trim fields consistently with normalization. Compare all twelve source fields: normalized event date, bracket weight, round, winner/team, result/method, loser/team, city, state and event name. Season is not present in raw Flo exports and was not inferred or certified by this audit.

For each of the 97 represented members, live source-row positions were compared against the original records. Ordered per-row and per-file MD5 integrity fingerprints over PostgreSQL JSON-array serialization of the twelve fields matched for **all 97 members / 35,891 retained records**. No out-of-range stored source-row coordinates were found. MD5 here is a comparison checksum, not an authorization mechanism; original bytes retain SHA-256 hashes privately. The live database was queried directly; this is not a browser verification of every result page or filter, nor an independent ratings recalculation.

Four unrepresented members are byte-identical SHA-256 matches of represented members: Seahorse Open, Juggernaut Fall Championships, Poseidon and FAWA Folkstyle State Championships. Their named rows account for 7,311 additional source sightings. The other three unrepresented members are January 2026 Yulee, Mariner and Winter Springs results; all 1,215 named source rows match live content under the 2026 archive. No extra bout is proposed solely because packaging/source filenames differ.

Private original archives, source coordinates, full omitted-row records, matching record references and review manifests remain outside Git. The database comparison contains no scouting notes, credentials or source exports in the repository.

## Unresolved contested repetitions

| Original member | Omitted record | Retained record | Source outcome | Evidence limitation |
|---|---:|---:|---|---|
| `2025SunshineOpen.csv` | 100 | 99 | DEC, 15–8 | Blank round; identical source fields |
| `IXPRookieRoundUp.csv` | 90 | 64 | F, 0–0 | Blank round; identical source fields |
| `JuggernautFallChampionships (5).csv` | 789 | 689 | DEC, 7–3 | Blank round; identical source fields |

Nine further identical same-file source records are coded FOR. All twelve were absent at their original source positions before this work. They are not deleted or newly suppressed by this audit. Exact repetition may reflect an export duplicate or a genuine repeated contest; the available CSV has no bout identifier that resolves this. Preserve both original records and obtain bracket/bout evidence before proposing a change. Do not treat matching opponents/event/score as proof.

## Operational consequence

Do not reimport the 2025 ZIP merely to exercise the new importer. There is no demonstrated clean new subset here. Keep the three contested cases and nine administrative cases quarantined, and keep current ratings unchanged.

Next Phase 1 steps: validate the importer on genuinely new results with a complete frozen database baseline, review/apply the private audit migration through the authorized process, present the reconciled dry run for explicit owner approval, and verify the approved import/evidence refresh. Rating calculation and production activation retain the separate runbook gates. Real multi-session PostgreSQL contention and durable legacy-source resolution are still pending.

Final live read confirmed 67,736 total matches, 35,861 calendar-2025 matches, 35,891 records attributed to the 2025 archive, and unchanged active model `a29c4460-5e56-4d22-902d-ea39c65bfcac`. No production writes were issued.
