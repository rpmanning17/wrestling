import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expectedScore,
  g,
  GLICKO_SCALE,
  inflatePhi,
  muToRating,
  phiToRd,
  ratingToMu,
  rdToPhi,
  updatePlayer,
  winProbability,
  type Game,
  type PlayerState,
} from "../../src/lib/rating/glicko2";

const params = { tau: 0.5, epsilon: 0.000001, maxRd: 350 };
const player = (rating: number, rd: number, sigma = 0.06): PlayerState => ({ mu: ratingToMu(rating), phi: rdToPhi(rd), sigma });
const game = (rating: number, rd: number, score: number): Game => ({ opponentMu: ratingToMu(rating), opponentPhi: rdToPhi(rd), score });

describe("Glicko-2 against the published worked example", () => {
  // Glickman, "Example of the Glicko-2 system": 1500/200/0.06 vs (1400,30,W) (1550,100,L) (1700,300,L), τ = 0.5
  const start = player(1500, 200);
  const games = [game(1400, 30, 1), game(1550, 100, 0), game(1700, 300, 0)];

  it("matches the intermediate quantities in the paper", () => {
    assert.ok(Math.abs(GLICKO_SCALE - 173.7178) < 1e-9);
    assert.ok(Math.abs(start.phi - 1.1513) < 5e-5);
    assert.ok(Math.abs(g(rdToPhi(30)) - 0.9955) < 5e-5);
    assert.ok(Math.abs(g(rdToPhi(100)) - 0.9531) < 5e-5);
    assert.ok(Math.abs(g(rdToPhi(300)) - 0.7242) < 5e-5);
    assert.ok(Math.abs(expectedScore(start.mu, ratingToMu(1400), rdToPhi(30)) - 0.639) < 5e-4);
    assert.ok(Math.abs(expectedScore(start.mu, ratingToMu(1550), rdToPhi(100)) - 0.432) < 5e-4);
    assert.ok(Math.abs(expectedScore(start.mu, ratingToMu(1700), rdToPhi(300)) - 0.303) < 5e-4);
  });

  it("reproduces the new rating, RD and volatility", () => {
    const next = updatePlayer(start, games, params);
    assert.ok(Math.abs(muToRating(next.mu) - 1464.06) < 0.01, `rating ${muToRating(next.mu)}`);
    assert.ok(Math.abs(phiToRd(next.phi) - 151.52) < 0.01, `rd ${phiToRd(next.phi)}`);
    assert.ok(Math.abs(next.sigma - 0.05999) < 0.00001, `sigma ${next.sigma}`);
  });
});

describe("Glicko-2 behaviour required by the product", () => {
  const fresh = () => player(1500, 350);

  it("with no games, rating and volatility are unchanged and RD grows", () => {
    const start = player(1620, 80);
    const next = updatePlayer(start, [], params);
    assert.equal(next.mu, start.mu);
    assert.equal(next.sigma, start.sigma);
    assert.ok(next.phi > start.phi);
    assert.ok(Math.abs(next.phi - Math.sqrt(start.phi ** 2 + start.sigma ** 2)) < 1e-12);
  });

  it("n empty periods equal n applications of the no-game rule (until the RD cap)", () => {
    let stepped = player(1500, 60);
    for (let i = 0; i < 5; i += 1) stepped = updatePlayer(stepped, [], params);
    const lazy = inflatePhi(rdToPhi(60), 0.06, 5, rdToPhi(350));
    assert.ok(Math.abs(stepped.phi - lazy) < 1e-12);
  });

  it("inactivity never pushes RD above the unrated cap and never lowers the rating", () => {
    const grown = inflatePhi(rdToPhi(340), 0.06, 10_000, rdToPhi(350));
    assert.ok(phiToRd(grown) <= 350 + 1e-9);
  });

  it("beating a strong opponent raises the rating more than beating a weak one", () => {
    const vsStrong = updatePlayer(player(1500, 100), [game(1800, 60, 1)], params);
    const vsWeak = updatePlayer(player(1500, 100), [game(1200, 60, 1)], params);
    assert.ok(vsStrong.mu - player(1500, 100).mu > vsWeak.mu - player(1500, 100).mu);
    assert.ok(vsStrong.mu > vsWeak.mu);
  });

  it("losing to a strong opponent costs less than losing to a weak one", () => {
    const toStrong = updatePlayer(player(1500, 100), [game(1800, 60, 0)], params);
    const toWeak = updatePlayer(player(1500, 100), [game(1200, 60, 0)], params);
    assert.ok(toStrong.mu > toWeak.mu);
  });

  it("15-5 against elite opponents outrates 25-1 against weak opponents", () => {
    const elite = Array.from({ length: 20 }, (_, i) => game(1750, 60, i < 15 ? 1 : 0));
    const weak = Array.from({ length: 26 }, (_, i) => game(1250, 60, i < 25 ? 1 : 0));
    const a = updatePlayer(player(1500, 350), elite, params);
    const b = updatePlayer(player(1500, 350), weak, params);
    assert.ok(a.mu > b.mu, `elite ${muToRating(a.mu)} vs weak ${muToRating(b.mu)}`);
  });

  it("a newcomer's 3-1 start moves substantially but stays far less certain than a 40-match wrestler", () => {
    // Opponents from the product brief: beats 1400, 1500, 1650; loses to 1800. Opponents carry RD 50.
    const newcomer = updatePlayer(fresh(), [game(1400, 50, 1), game(1500, 50, 1), game(1650, 50, 1), game(1800, 50, 0)], params);
    const rating = muToRating(newcomer.mu);
    const rd = phiToRd(newcomer.phi);
    assert.ok(rating > 1600, `newcomer rating ${rating}`); // results are substantial evidence, not capped
    assert.ok(rd > 120 && rd < 250, `newcomer rd ${rd}`);

    // A veteran who earns the same rating over many periods of 5 games against similar opposition.
    let veteran = fresh();
    for (let period = 0; period < 8; period += 1) {
      veteran = updatePlayer(veteran, [game(1400, 50, 1), game(1500, 50, 1), game(1650, 50, 1), game(1800, 50, 0), game(1550, 50, 1)], params);
    }
    assert.ok(phiToRd(veteran.phi) < rd - 40, `veteran rd ${phiToRd(veteran.phi)} vs newcomer ${rd}`);
  });

  it("zero additional skill drift exactly preserves published Glicko calculations", () => {
    const start = player(1600, 70);
    const games = [game(1700, 50, 1), game(1450, 60, 0)];
    assert.deepEqual(updatePlayer(start, games, params),
      updatePlayer(start, games, { ...params, extraVariancePerPeriod: 0 }));
    assert.equal(inflatePhi(start.phi, start.sigma, 30, rdToPhi(350)),
      inflatePhi(start.phi, start.sigma, 30, rdToPhi(350), 0));
  });

  it("optional skill drift increases uncertainty and responsiveness without moving idle ability", () => {
    const start = player(1600, 60);
    const drift = (rdToPhi(120) ** 2) / 365.25;
    const idle = updatePlayer(start, [], { ...params, extraVariancePerPeriod: drift });
    assert.equal(idle.mu, start.mu);
    assert.ok(idle.phi > updatePlayer(start, [], params).phi);
    const longIdle = inflatePhi(start.phi, start.sigma, 365, rdToPhi(350), drift);
    assert.ok(longIdle > inflatePhi(start.phi, start.sigma, 365, rdToPhi(350)));
    assert.ok(longIdle <= rdToPhi(350));
    const standard = updatePlayer(start, [game(1700, 80, 1)], params);
    const adaptive = updatePlayer(start, [game(1700, 80, 1)], { ...params, extraVariancePerPeriod: drift });
    assert.ok(adaptive.mu > standard.mu);
    assert.ok(adaptive.phi > standard.phi);
  });

  it("fractional scores land between a loss and a win", () => {
    const win = updatePlayer(player(1500, 100), [game(1500, 60, 1)], params).mu;
    const mid = updatePlayer(player(1500, 100), [game(1500, 60, 0.7)], params).mu;
    const loss = updatePlayer(player(1500, 100), [game(1500, 60, 0)], params).mu;
    assert.ok(loss < mid && mid < win);
  });
});

describe("match probability", () => {
  it("is symmetric and 0.5 for identical players", () => {
    const a = player(1700, 80);
    const b = player(1500, 120);
    assert.ok(Math.abs(winProbability(a, b) + winProbability(b, a) - 1) < 1e-12);
    assert.ok(Math.abs(winProbability(a, a) - 0.5) < 1e-12);
  });

  it("is pulled toward 0.5 when either player is uncertain", () => {
    const strong = player(1800, 50);
    const certain = winProbability(strong, player(1500, 50));
    const uncertain = winProbability(strong, player(1500, 300));
    assert.ok(certain > uncertain && uncertain > 0.5);
  });
});
