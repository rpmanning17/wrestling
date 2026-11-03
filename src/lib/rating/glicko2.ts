/**
 * Glicko-2 rating math.
 *
 * Source: Mark E. Glickman, "Example of the Glicko-2 system" (glicko.net/glicko/glicko2.pdf).
 * Step numbers in comments refer to that document. The implementation is validated in
 * tests/rating/glicko2.test.ts against the worked example in the paper
 * (1500 / RD 200 / σ 0.06, τ 0.5 -> 1464.06 / RD 151.52 / σ 0.05999).
 *
 * Deviations from the paper, all deliberate and documented in docs/RANKINGS.md:
 *  - Inactivity is applied lazily: n empty rating periods grow φ to sqrt(φ² + n·σ²), which is the
 *    paper's "no games in the period" rule applied n times. φ is capped at the unrated RD.
 *  - Game scores may be fractional (0..1). The paper allows 0, 0.5 and 1. Fractional scores are only
 *    used by the experimental dominance variant, which is disabled by default.
 */

/** 400 / ln(10): converts between the Glicko rating scale and the Glicko-2 internal scale. */
export const GLICKO_SCALE = 173.7178;
/** The rating that maps to μ = 0. Fixed by the specification. */
export const RATING_BASE = 1500;

export type Glicko2Params = {
  initialRating: number;
  initialRd: number;
  initialVolatility: number;
  /** System constant τ. The paper recommends 0.3–1.2 and says to test for predictive accuracy. */
  tau: number;
  /** Convergence tolerance for the volatility iteration (paper: 0.000001). */
  epsilon: number;
  /** Upper bound on RD, normally the unrated RD. */
  maxRd: number;
};

/** A player on the Glicko-2 internal scale. */
export type PlayerState = { mu: number; phi: number; sigma: number };

/** One game from the point of view of the player being updated. */
export type Game = { opponentMu: number; opponentPhi: number; score: number };

export const ratingToMu = (rating: number) => (rating - RATING_BASE) / GLICKO_SCALE;
export const rdToPhi = (rd: number) => rd / GLICKO_SCALE;
export const muToRating = (mu: number) => mu * GLICKO_SCALE + RATING_BASE;
export const phiToRd = (phi: number) => phi * GLICKO_SCALE;

export function initialState(params: Glicko2Params): PlayerState {
  return {
    mu: ratingToMu(params.initialRating),
    phi: rdToPhi(params.initialRd),
    sigma: params.initialVolatility,
  };
}

/** Step 3: g(φ) = 1 / sqrt(1 + 3φ²/π²). */
export function g(phi: number) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/** Step 3: E(μ, μj, φj) = 1 / (1 + exp(−g(φj)(μ − μj))). */
export function expectedScore(mu: number, opponentMu: number, opponentPhi: number) {
  return 1 / (1 + Math.exp(-g(opponentPhi) * (mu - opponentMu)));
}

/**
 * Probability that `a` beats `b` for forecasting, using the combined uncertainty of both players,
 * g(sqrt(φa² + φb²)). This is the match-prediction form from Glickman's original Glicko paper.
 * The Glicko-2 paper's E() only discounts by the opponent's φ because it is used for the update,
 * where the player's own φ is handled by the update itself.
 */
export function winProbability(a: PlayerState, b: PlayerState, predictor: "combined_rd" | "opponent_rd" = "combined_rd") {
  const phi = predictor === "combined_rd" ? Math.sqrt(a.phi * a.phi + b.phi * b.phi) : b.phi;
  return 1 / (1 + Math.exp(-g(phi) * (a.mu - b.mu)));
}

/** φ after `periods` empty rating periods (paper, "no games in the period": φ* = sqrt(φ² + σ²)). */
export function inflatePhi(phi: number, sigma: number, periods: number, maxPhi: number) {
  if (periods <= 0) return phi;
  return Math.min(maxPhi, Math.sqrt(phi * phi + periods * sigma * sigma));
}

/** Step 5: iterative volatility update (Illinois algorithm). */
export function newVolatility(phi: number, sigma: number, delta: number, v: number, tau: number, epsilon: number) {
  const a = Math.log(sigma * sigma);
  const phi2 = phi * phi;
  const delta2 = delta * delta;
  const f = (x: number) => {
    const ex = Math.exp(x);
    const denom = 2 * (phi2 + v + ex) ** 2;
    return (ex * (delta2 - phi2 - v - ex)) / denom - (x - a) / (tau * tau);
  };

  let A = a;
  let B: number;
  if (delta2 > phi2 + v) {
    B = Math.log(delta2 - phi2 - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) {
      k += 1;
      if (k > 1000) break;
    }
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);
  let iterations = 0;
  while (Math.abs(B - A) > epsilon && iterations < 200) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
    iterations += 1;
  }
  return Math.exp(A / 2);
}

/**
 * Steps 3–8 for one player over one rating period.
 *
 * `player` must already include any inactivity growth through the previous period. With no games only
 * step 6 applies: rating and volatility are unchanged and φ grows.
 */
export function updatePlayer(player: PlayerState, games: readonly Game[], params: Pick<Glicko2Params, "tau" | "epsilon" | "maxRd">): PlayerState {
  const maxPhi = rdToPhi(params.maxRd);
  if (!games.length) {
    return { mu: player.mu, phi: inflatePhi(player.phi, player.sigma, 1, maxPhi), sigma: player.sigma };
  }

  let vInverse = 0;
  let deltaSum = 0;
  for (const game of games) {
    const gj = g(game.opponentPhi);
    const e = expectedScore(player.mu, game.opponentMu, game.opponentPhi);
    vInverse += gj * gj * e * (1 - e);
    deltaSum += gj * (game.score - e);
  }
  const v = 1 / vInverse;
  const delta = v * deltaSum;

  const sigmaNew = newVolatility(player.phi, player.sigma, delta, v, params.tau, params.epsilon);
  const phiStar = Math.sqrt(player.phi * player.phi + sigmaNew * sigmaNew);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = player.mu + phiNew * phiNew * deltaSum;
  return { mu: muNew, phi: phiNew, sigma: sigmaNew };
}
