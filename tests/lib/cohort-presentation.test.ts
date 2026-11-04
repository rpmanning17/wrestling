import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CohortStanding, CohortTierIndicator } from "../../src/components/cohort-standing";
import { GlickoMetrics } from "../../src/components/glicko-metrics";
import { toCohortStanding } from "../../src/lib/cohort-standing";

test("Tier 2 is the second segment from the right, with equivalent accessible text", () => {
  const html=renderToStaticMarkup(createElement(CohortTierIndicator,{tier:2}));
  assert.deepEqual([...html.matchAll(/data-tier="(\d+)"/g)].map(m=>Number(m[1])),[10,9,8,7,6,5,4,3,2,1]);
  assert.match(html,/data-tier="2" class="tier-segment selected"/);
  assert.match(html,/aria-label="Cohort Tier 2 of 10; Tier 1 strongest, Tier 10 weakest"/);
  assert.match(html,/Tier 10 · Weakest/);
  assert.match(html,/Tier 1 · Strongest/);
});

test("all three strength surfaces use the same database standing without reassigning tiers", () => {
  const standing=toCohortStanding({age_group:'12U',weight_band:'80–89 lb',strength_score:'524.34',cohort_rank:12,cohort_size:28,cohort_tier:5,tier_unavailable_reason:null});
  const html=renderToStaticMarkup(createElement(CohortStanding,{standing}));
  assert.match(html,/524.34/);
  assert.match(html,/#12 of 28/);
  assert.match(html,/Cohort Tier 5/);
  assert.match(html,/Cohort Strength \(0–1,000\)/);
  assert.match(html,/not an absolute ability rating or match prediction/);
  assert.equal(standing.cohortTier,5);
});

test("unknown cohort evidence gives explanatory unavailable states, not a tier", () => {
  const standing=toCohortStanding(null);
  const html=renderToStaticMarkup(createElement(CohortStanding,{standing}));
  assert.equal(standing.strength,null);
  assert.equal(standing.cohortTier,null);
  assert.match(html,/Cohort Tier unavailable/);
  assert.match(html,/sufficient age\/weight evidence/);
  assert.doesNotMatch(html,/tier-segment selected/);
});

test("uncapped Glicko, RD, conservative rating and Schedule Difficulty have distinct labels", () => {
  const html=renderToStaticMarkup(createElement(GlickoMetrics,{rating:2100,rd:122,conservative:1978,status:'provisional',schedule:0.31,opponent:2400}));
  for(const label of ['Glicko Rating','Rating Deviation (RD)','Conservative Glicko Rating','Average Opponent Glicko Rating','Schedule Difficulty','provisional','2100','2400','31%','no fixed upper limit','lower means harder opposition']) assert.ok(html.includes(label),label);
  assert.doesNotMatch(html,/Power|Cohort Strength|Matchup Likelihood/);
});
