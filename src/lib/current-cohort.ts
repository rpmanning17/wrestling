/**
 * Current cohort estimate from the three newest distinct events, not three bouts.
 * Bracket weight is evidence of an entry class, never a measured bodyweight.
 * Age division is entered division, not proof of birth year.
 */
export type CohortEvent = {
  date: string;
  event: string;
  ageGroup?: string | null;
  bracketWeight?: number | null;
  source: "entry" | "observation" | "evidence" | "match";
};

const sourceRank = { entry: 4, observation: 3, evidence: 2, match: 1 };
const weights = [0.5, 0.3, 0.2];

export function inferCurrentCohort(rows: CohortEvent[]) {
  const byEvent = new Map<string, CohortEvent[]>();
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !row.event.trim()) continue;
    const key = row.date + "|" + row.event.trim().toLowerCase().replace(/\s+/g, " ");
    byEvent.set(key, [...(byEvent.get(key) ?? []), row]);
  }
  const events = [...byEvent.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 3)
    .map(([, items]) => items.sort((a, b) => sourceRank[b.source] - sourceRank[a.source]));

  const vote = <T extends string | number>(pick: (item: CohortEvent) => T | null | undefined) => {
    const scores = new Map<T, number>();
    events.forEach((items, index) => {
      const value = items.map(pick).find((v) => v != null && v !== "");
      if (value != null && value !== "") scores.set(value, (scores.get(value) ?? 0) + weights[index]);
    });
    return [...scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const ageGroup = vote((row) => row.ageGroup?.trim() || null);
  const bracketWeight = vote((row) => row.bracketWeight != null && Number.isFinite(row.bracketWeight) && row.bracketWeight >= 30 && row.bracketWeight <= 400 ? row.bracketWeight : null);
  return { ageGroup, bracketWeight, eventsUsed: events.length, latestEventDate: events[0]?.[0]?.date ?? null };
}
