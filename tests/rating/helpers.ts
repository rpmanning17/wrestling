import { resolveConfig, type RatingConfigOverrides } from "../../src/lib/rating/config";
import { prepareMatches, type AliasRow, type RawMatch, type RatedMatch } from "../../src/lib/rating/prepare";

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let counter = 0;
export function raw(overrides: Partial<RawMatch> & Pick<RawMatch, "winner_name" | "loser_name">): RawMatch {
  counter += 1;
  return {
    id: `m${String(counter).padStart(6, "0")}`,
    event_date: "2026-01-10",
    event_name: "Test Open",
    weight_class: "12U 70",
    round: "Round 1",
    winner_team: "",
    loser_team: "",
    result: "Dec 5-2",
    win_type: "DEC",
    city: "Orlando",
    ...overrides,
  };
}

export function prepared(rows: RawMatch[], overrides: RatingConfigOverrides = {}, aliases: AliasRow[] = []) {
  const config = resolveConfig(overrides);
  const { matches, report } = prepareMatches(rows, aliases, config);
  return { config, matches, report };
}

export const isoDay = (base: string, offset: number) => new Date(Date.parse(`${base}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

/**
 * Synthetic league with known skills. Wrestlers have a latent skill s ~ N(0,1) (logit scale: P(a beats b)
 * = 1 / (1 + exp(-(sa - sb) * 1.4))). Every `spacingDays` a tournament runs with a random subset in
 * a random round-robin-ish pairing, optionally split over two days.
 */
export function syntheticLeague(options: { wrestlers?: number; events?: number; seed?: number; startDate?: string; spacingDays?: number; skillScale?: number } = {}) {
  const { wrestlers = 60, events = 40, seed = 7, startDate = "2024-10-05", spacingDays = 14, skillScale = 1.4 } = options;
  const random = mulberry32(seed);
  const normal = () => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
  const skill = new Map<string, number>();
  const names = Array.from({ length: wrestlers }, (_, i) => `Wrestler ${String(i + 1).padStart(3, "0")}`);
  for (const name of names) skill.set(name, normal());

  const rows: RawMatch[] = [];
  for (let event = 0; event < events; event += 1) {
    const date = isoDay(startDate, event * spacingDays);
    const size = 10 + Math.floor(random() * 8);
    const field = [...names].sort(() => random() - 0.5).slice(0, size);
    for (let round = 0; round < 3; round += 1) {
      const order = [...field].sort(() => random() - 0.5);
      for (let i = 0; i + 1 < order.length; i += 2) {
        const [a, b] = [order[i], order[i + 1]];
        const pA = 1 / (1 + Math.exp(-(skill.get(a)! - skill.get(b)!) * skillScale));
        const aWins = random() < pA;
        rows.push(raw({
          event_name: `League Event ${event + 1}`,
          event_date: isoDay(date, round === 2 ? 1 : 0),
          weight_class: "12U 70",
          round: `R${round + 1}`,
          winner_name: aWins ? a : b,
          loser_name: aWins ? b : a,
          win_type: random() < 0.15 ? "F" : random() < 0.25 ? "MD" : "DEC",
          result: "Dec 6-3",
        }));
      }
    }
  }
  return { rows, skill };
}

/**
 * League where the win METHOD carries skill information: favourites who win tend to win by fall or major
 * decision more often when the skill gap is large. Used as a positive control for dominance detection.
 */
export function signalLeague(options: { wrestlers?: number; events?: number; seed?: number } = {}) {
  const { wrestlers = 90, events = 200, seed = 5 } = options;
  const random = mulberry32(seed);
  const normal = () => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
  const names = Array.from({ length: wrestlers }, (_, i) => `W${String(i).padStart(3, "0")}`);
  const skill = new Map(names.map((n) => [n, normal()]));
  const rows: RawMatch[] = [];
  for (let e = 0; e < events; e += 1) {
    const field = [...names].sort(() => random() - 0.5).slice(0, 14);
    for (let r = 0; r < 3; r += 1) {
      const order = [...field].sort(() => random() - 0.5);
      for (let i = 0; i + 1 < order.length; i += 2) {
        const [a, b] = [order[i], order[i + 1]];
        const d = skill.get(a)! - skill.get(b)!;
        const aWins = random() < 1 / (1 + Math.exp(-d * 1.4));
        const favouriteWon = (aWins ? d : -d) > 0;
        const u = random();
        const pFall = Math.min(0.7, 0.05 + 0.25 * Math.abs(d));
        const pBonus = Math.min(0.5, 0.1 + 0.15 * Math.abs(d));
        const method = favouriteWon && u < pFall ? "F" : favouriteWon && u < pFall + pBonus ? "MD" : "DEC";
        rows.push(raw({
          event_name: `E${e}`,
          event_date: isoDay("2024-10-05", e * 10 + (r === 2 ? 1 : 0)),
          round: `R${r}${i}`,
          winner_name: aWins ? a : b,
          loser_name: aWins ? b : a,
          win_type: method,
          result: method === "DEC" ? "Dec 4-3" : method === "MD" ? "MD 12-3" : "Fall 1:00",
        }));
      }
    }
  }
  return rows;
}

export const swapOutcome = (row: RawMatch): RawMatch => ({
  ...row,
  winner_name: row.loser_name,
  loser_name: row.winner_name,
  winner_team: row.loser_team,
  loser_team: row.winner_team,
});

export type { RatedMatch };
