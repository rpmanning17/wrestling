/**
 * Classifies how a bout ended and extracts scoring information.
 *
 * ASSUMPTION (see docs/RANKINGS.md, "Outcome representation"): the production `matches.win_type` values could not be
 * inspected from the build environment. The method codes below come from the application's own
 * "Add a missing bout" form (F, DEC, TF, MD, FOR, DEF, M FOR, DQ, MFFL, NC) plus the conventional
 * Flo/TrackWrestling spellings. Anything unrecognised is classified "unknown", excluded from ratings,
 * and reported so it can be reviewed and added here.
 */
export type MethodKind =
  | "decision"
  | "major_decision"
  | "tech_fall"
  | "fall"
  | "forfeit"
  | "medical_forfeit"
  | "default"
  | "disqualification"
  | "no_contest"
  | "bye"
  | "unknown";

export const CONTESTED_BY_DEFAULT: MethodKind[] = ["decision", "major_decision", "tech_fall", "fall"];

const clean = (value: string) =>
  value
    .toUpperCase()
    .replace(/[().]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Ordered rules: the first match wins. Patterns are applied to the cleaned win_type text. */
const RULES: Array<[RegExp, MethodKind]> = [
  [/^(BYE|BYE.*)$/, "bye"],
  [/^(M FOR|MFFL|MFF|MED FOR|MEDICAL.*|MEDICAL FORFEIT|MFOR)$/, "medical_forfeit"],
  [/^(FOR|FFT|FF|FORFEIT|FORF|FOR.*)$/, "forfeit"],
  [/^(DEF|DEFAULT|INJ|INJURY.*|INJ DEF|INJURY DEFAULT)$/, "default"],
  [/^(DQ|DISQ|DISQUALIFICATION|DISQUALIFIED)$/, "disqualification"],
  [/^(NC|NO CONTEST|NO MATCH)$/, "no_contest"],
  [/^(F|FALL|PIN|PINFALL|FALL .*|PIN .*|F .*)$/, "fall"],
  [/^(TF|TECH|TECH FALL|TECHNICAL FALL|TECHNICAL SUPERIORITY|TF .*|TECH .*|TF-?\d.*)$/, "tech_fall"],
  [/^(MD|MAJ|MAJOR|MAJOR DEC|MAJOR DECISION|MD .*|MAJ .*)$/, "major_decision"],
  [/^(DEC|DECISION|DEC .*|SV|SV-?\d*|SV .*|SUDDEN VICTORY.*|TB|TB-?\d*|TB .*|UTB|UTB.*|TIEBREAKER.*|TIE BREAKER.*|OT|DEC OT|OVERTIME.*|DEC SV.*)$/, "decision"],
];

export function classifyMethod(winType: string | null | undefined, result?: string | null): MethodKind {
  const type = clean(String(winType ?? ""));
  if (type) {
    for (const [pattern, kind] of RULES) if (pattern.test(type)) return kind;
  }
  // Some exports leave win_type blank or generic and carry the method as the first token of `result`.
  const fromResult = clean(String(result ?? "")).split(" ")[0] ?? "";
  if (!type && fromResult) {
    for (const [pattern, kind] of RULES) if (pattern.test(fromResult)) return kind;
  }
  return "unknown";
}

/** First `W-L` style score in a result string, e.g. "Dec 7-3" or "SV-1 5-3". Ignores "SV-1", clocks and dates. */
const SCORE = /(?<![\w:./-])(\d{1,3})\s*-\s*(\d{1,3})(?![\d:./])/;

export function parseScore(result: string | null | undefined): { winner: number; loser: number } | null {
  const text = String(result ?? "");
  const match = SCORE.exec(text);
  if (!match) return null;
  const winner = Number(match[1]);
  const loser = Number(match[2]);
  // Wrestling points are non-negative; the winner cannot trail. Anything else is a parse artefact.
  if (!Number.isFinite(winner) || !Number.isFinite(loser) || winner <= loser) return null;
  return { winner, loser };
}

/** Winner's margin in points for scored bouts. Falls and non-scored results have no margin. */
export function scoringMargin(kind: MethodKind, result: string | null | undefined): number | null {
  if (kind !== "decision" && kind !== "major_decision" && kind !== "tech_fall") return null;
  const score = parseScore(result);
  return score ? score.winner - score.loser : null;
}

/** Numeric bracket weight: the last number in the label, matching the existing evidence-refresh rule. */
export function parseBracketWeight(weightClass: string | null | undefined): number | null {
  const found = /([0-9]+(?:\.[0-9]+)?)\D*$/.exec(String(weightClass ?? ""));
  if (!found) return null;
  const weight = Number(found[1]);
  return weight >= 30 && weight <= 400 ? weight : null;
}

/** Age group if the weight-class label carries one (e.g. "12U 70"). Often absent: do not guess. */
export function parseAgeGroup(...labels: Array<string | null | undefined>): string | null {
  for (const label of labels) {
    const found = /(?<![0-9])(6|8|10|12|14|16|18)\s?U(?![A-Za-z])/i.exec(String(label ?? ""));
    if (found) return `${found[1]}U`;
  }
  return null;
}

export const isPlaceholderName = (name: string) =>
  /^(bye|\(bye\)|tbd|t\.b\.d\.|unknown|unk|n\/?a|vacant|open|forfeit|no opponent|-+|\?+)$/i.test(name.trim());
