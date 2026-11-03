/**
 * Head-to-head and common-opponent summaries between wrestlers in a comparison.
 * Pure functions over already-fetched bouts; names are compared as normalised identity keys.
 * Only contested outcomes count (the caller supplies bouts already classified).
 */
export type Bout = { date: string; winnerKey: string; loserKey: string; winnerName: string; loserName: string };

export type HeadToHead = { opponentKey: string; opponentName: string; wins: number; losses: number; lastDate: string };

export type CommonOpponent = {
  opponentKey: string;
  opponentName: string;
  /** Subject's record against the shared opponent, and the compared wrestler's. */
  mine: { wins: number; losses: number };
  theirs: { wins: number; losses: number };
};

export type CommonOpponentSummary = { otherKey: string; otherName: string; shared: CommonOpponent[] };

const record = (bouts: Bout[], subject: string, opponent: string) => {
  let wins = 0;
  let losses = 0;
  for (const bout of bouts) {
    if (bout.winnerKey === subject && bout.loserKey === opponent) wins += 1;
    else if (bout.loserKey === subject && bout.winnerKey === opponent) losses += 1;
  }
  return { wins, losses };
};

export function headToHead(bouts: Bout[], subjectKey: string, otherKeys: string[], names: Map<string, string>): HeadToHead[] {
  const out: HeadToHead[] = [];
  for (const otherKey of otherKeys) {
    if (otherKey === subjectKey) continue;
    const meetings = bouts.filter((b) => (b.winnerKey === subjectKey && b.loserKey === otherKey) || (b.loserKey === subjectKey && b.winnerKey === otherKey));
    if (!meetings.length) continue;
    const { wins, losses } = record(meetings, subjectKey, otherKey);
    out.push({ opponentKey: otherKey, opponentName: names.get(otherKey) ?? otherKey, wins, losses, lastDate: meetings.map((m) => m.date).sort().at(-1)! });
  }
  return out.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

export function commonOpponents(bouts: Bout[], subjectKey: string, otherKeys: string[], names: Map<string, string>, perPair = 3): CommonOpponentSummary[] {
  const opponentsOf = (key: string) => {
    const found = new Map<string, string>();
    for (const b of bouts) {
      if (b.winnerKey === key) found.set(b.loserKey, b.loserName);
      else if (b.loserKey === key) found.set(b.winnerKey, b.winnerName);
    }
    return found;
  };
  const mine = opponentsOf(subjectKey);
  const out: CommonOpponentSummary[] = [];
  for (const otherKey of otherKeys) {
    if (otherKey === subjectKey) continue;
    const theirs = opponentsOf(otherKey);
    const shared: CommonOpponent[] = [];
    for (const [opponentKey, opponentName] of mine) {
      // A direct meeting is head-to-head, not a common opponent; neither wrestler is their own opponent.
      if (opponentKey === otherKey || !theirs.has(opponentKey)) continue;
      shared.push({ opponentKey, opponentName, mine: record(bouts, subjectKey, opponentKey), theirs: record(bouts, otherKey, opponentKey) });
    }
    if (shared.length) {
      shared.sort((a, b) => b.mine.wins + b.mine.losses + b.theirs.wins + b.theirs.losses - (a.mine.wins + a.mine.losses + a.theirs.wins + a.theirs.losses));
      out.push({ otherKey, otherName: names.get(otherKey) ?? otherKey, shared: shared.slice(0, perPair) });
    }
  }
  return out;
}
