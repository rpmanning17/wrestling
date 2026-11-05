export type WrestlerRef = {
  name: string;
  personId?: string;
  team?: string;
  unknown?: boolean;
  identityUnresolved?: boolean;
  ageGroup?: string;
  weight?: number;
};

export type WrestlerSuggestion = WrestlerRef & {
  evidence: string;
  matchScore: number;
};

export type BoutSummary = {
  id: string;
  date: string;
  event: string;
  opponent: string;
  outcome: "W" | "L";
  result: string;
  weight: string;
};

export type PlacementSummary = {
  date: string;
  event: string;
  place: number | null;
  ageGroup: string | null;
  division: string;
  weight: number | null;
  weightLabel: string;
  confidence: string;
};

export type WrestlerNote = {
  id: number;
  wrestlerKey: string;
  body: string;
  clientId: string;
  createdAt: string;
};

export type RatingStatus = "provisional" | "developing" | "established";

/** Opponent-adjusted rating from the active versioned model (see docs/RANKINGS.md). */
export type PowerRating = {
  modelVersion: string;
  asOfDate: string;
  rating: number;
  rd: number;
  conservative: number;
  status: RatingStatus;
  matchCount: number;
  /** Opponents' CURRENT ratings: explanatory only, never an input to the rating. */
  avgOpponentRating: number | null;
  sosExpectedWinPct: number | null;
  qualityWins: number;
  qualityLosses: number;
  pinPct: number | null;
  bonusPct: number | null;
  winMethods: Record<string, number>;
  lossMethods: Record<string, number>;
  avgWinMargin: number | null;
  avgLossMargin: number | null;
  trend: number | null;
};

export type HeadToHeadSummary = { opponent: string; wins: number; losses: number; lastDate: string };

export type CommonOpponentLine = {
  other: string;
  opponent: string;
  mine: { wins: number; losses: number };
  theirs: { wins: number; losses: number };
};

export type WrestlerProfile = WrestlerRef & {
  key: string;
  wins: number;
  losses: number;
  /**
   * 0-1000 cohort display. "opponent_adjusted": min-max of the conservative score within the
   * wrestler's age group and 10 lb band. "legacy": the original heuristic view.
   */
  ratingSource: "opponent_adjusted" | "legacy";
  powerRating: PowerRating | null;
  headToHead: HeadToHeadSummary[];
  commonOpponents: CommonOpponentLine[];
  strength: number | null;
  strengthReason: string;
  likelihood: number;
  likelihoodReason: string;
  latestAgeGroup: string | null;
  latestWeight: number | null;
  birthYearStart: number | null;
  birthYearEnd: number | null;
  cohortRank: number | null;
  cohortSize: number | null;
  cohortTier: number | null;
  tierUnavailableReason: string | null;
  weightBand: string | null;
  evidenceConfidence: "confirmed" | "strong" | "moderate" | "limited";
  latestDate: string | null;
  bouts: BoutSummary[];
  placements: PlacementSummary[];
  notes: WrestlerNote[];
};

export const wrestlerKey = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
