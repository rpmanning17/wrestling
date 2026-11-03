type ScoreInput = {
  wins: number;
  losses: number;
  decisiveWins: number;
  latestDate: string | null;
  bestPlacement: number | null;
  latestAgeGroup: string | null;
  latestWeight: number | null;
  orlandoAppearances: number;
  recentAppearances: number;
  tournamentCount: number;
  confirmedEvidence: boolean;
};

const clamp = (value: number, min = 0, max = 1000) => Math.min(max, Math.max(min, value));

const daysAgo = (date: string | null) => {
  if (!date) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - new Date(`${date}T12:00:00Z`).getTime()) / 86_400_000);
};

export function strengthScore(input: ScoreInput) {
  const bouts = input.wins + input.losses;
  if (!bouts) return null;
  const winRate = input.wins / bouts;
  const placement = input.bestPlacement ? Math.max(0, 1 - (input.bestPlacement - 1) / 7) : 0;
  const decisive = input.wins ? input.decisiveWins / input.wins : 0;
  const recency = Math.max(0, 1 - daysAgo(input.latestDate) / 730);
  const reliability = Math.min(1, bouts / 20);
  return Number(clamp(winRate * 500 + placement * 200 + decisive * 100 + recency * 100 + reliability * 100).toFixed(2));
}

export function likelihoodScore(input: ScoreInput) {
  const ageFit = input.latestAgeGroup === "12U" ? 170 : input.latestAgeGroup === "10U" ? 85 : 35;
  const weight = input.latestWeight;
  const weightDistance = weight == null ? 10 : Math.min(Math.abs(weight - 70), Math.abs(weight - 75));
  const weightFit = Math.max(0, 130 - weightDistance * 20);
  const orlando = Math.min(250, input.orlandoAppearances * 55);
  const recency = Math.max(0, 175 * (1 - daysAgo(input.latestDate) / 730));
  const overlap = Math.min(125, input.recentAppearances * 32);
  const activity = Math.min(75, input.tournamentCount * 12);
  const confidence = input.confirmedEvidence ? 75 : input.latestAgeGroup || input.latestWeight ? 45 : 15;
  return Number(clamp(ageFit + weightFit + orlando + recency + overlap + activity + confidence).toFixed(2));
}

export function strengthExplanation(input: ScoreInput) {
  const bouts = input.wins + input.losses;
  if (!bouts) return "Unrated — no recorded bouts yet.";
  const parts = [`${input.wins}-${input.losses} in ${bouts} recorded bouts`];
  if (input.bestPlacement) parts.push(`best placement: ${input.bestPlacement}`);
  if (input.decisiveWins) parts.push(`${input.decisiveWins} decisive wins`);
  return parts.join(" · ");
}

export function likelihoodExplanation(input: ScoreInput) {
  const parts: string[] = [];
  if (input.latestAgeGroup) parts.push(input.latestAgeGroup);
  if (input.latestWeight) parts.push(`${input.latestWeight} lb evidence`);
  if (input.orlandoAppearances) parts.push(`${input.orlandoAppearances} Orlando-area appearance${input.orlandoAppearances === 1 ? "" : "s"}`);
  if (input.recentAppearances) parts.push(`${input.recentAppearances} recent appearance${input.recentAppearances === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "Limited age, weight, and local-event evidence.";
}

