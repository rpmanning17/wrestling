import assert from "node:assert/strict";
import test from "node:test";
import { inferCurrentCohort, type CohortEvent } from "../../src/lib/current-cohort";

const row = (date: string, event: string, weight: number, ageGroup = "12U"): CohortEvent =>
  ({ date, event, bracketWeight: weight, ageGroup, source: "entry" });

test("three distinct events, newest weighted 50/30/20", () => {
  const result = inferCurrentCohort([
    row("2026-10-01", "Old", 75),
    row("2026-10-15", "Middle", 75),
    row("2026-10-24", "Latest", 80),
    row("2026-10-24", "Latest", 80),
  ]);
  assert.equal(result.eventsUsed, 3);
  assert.equal(result.bracketWeight, 80);
});

test("five bouts at one event do not outweigh distinct events", () => {
  const rows: CohortEvent[] = [
    ...Array.from({ length: 5 }, () => ({ ...row("2026-10-24", "Latest", 80), source: "match" as const })),
    row("2026-10-17", "Second", 75),
    row("2026-10-10", "Third", 75),
  ];
  assert.equal(inferCurrentCohort(rows).bracketWeight, 80);
});

test("older events outside the latest three cannot affect cohort", () => {
  const rows = [
    row("2026-10-24", "A", 75),
    row("2026-10-17", "B", 75),
    row("2026-10-10", "C", 75),
    row("2026-10-03", "D", 100),
  ];
  assert.equal(inferCurrentCohort(rows).bracketWeight, 75);
});

test("source preference is per event, age and weight inferred independently", () => {
  const rows: CohortEvent[] = [
    { ...row("2026-10-24", "A", 80, "12U"), source: "entry" },
    { ...row("2026-10-24", "A", 75, "10U"), source: "match" },
    { ...row("2026-10-17", "B", 75, "12U"), source: "entry" },
  ];
  assert.deepEqual([inferCurrentCohort(rows).ageGroup, inferCurrentCohort(rows).bracketWeight], ["12U", 80]);
});
