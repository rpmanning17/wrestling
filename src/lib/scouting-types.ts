export type WrestlerRef = {
  name: string;
  team?: string;
  unknown?: boolean;
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
  ageGroup: string;
  division: string;
  weight: number;
  confidence: string;
};

export type WrestlerNote = {
  id: number;
  wrestlerKey: string;
  body: string;
  clientId: string;
  createdAt: string;
};

export type WrestlerProfile = WrestlerRef & {
  key: string;
  wins: number;
  losses: number;
  strength: number | null;
  strengthReason: string;
  likelihood: number;
  likelihoodReason: string;
  latestAgeGroup: string | null;
  latestWeight: number | null;
  evidenceConfidence: "confirmed" | "derived" | "limited";
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

