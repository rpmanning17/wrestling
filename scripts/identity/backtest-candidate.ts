/** Fixed-formula, leakage-free comparison of source-name and person-keyed history. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runBacktest, standardModels } from "../../src/lib/rating/backtest";
import { resolveConfig } from "../../src/lib/rating/config";
import { prepareMatches, type MatchIdentityAssignment, type RawMatch } from "../../src/lib/rating/prepare";
import type { IdentitySnapshot } from "../../src/lib/identity/audit";
import type { PlannedAssignment } from "../../src/lib/identity/plan";

const directory = process.argv[2];
if (!directory) throw new Error("Private identity directory required");
const read = (name: string) => JSON.parse(readFileSync(path.join(directory, name), "utf8"));
const source = read("identity-source-snapshot.json") as IdentitySnapshot;
const plan = read("identity-417-assignment-plan.json") as { sourceChecksum: string; assignments: PlannedAssignment[] };
if (source.source_checksum !== plan.sourceChecksum) throw new Error("Source checksum changed");
const raw: RawMatch[] = source.matches.map(row => ({ id: row[0], event_date: row[1], event_name: row[2],
  city: row[3], weight_class: row[5], round: row[6], winner_name: row[7], winner_team: row[8],
  loser_name: row[9], loser_team: row[10], result: row[11], win_type: row[12] }));
const assignments: MatchIdentityAssignment[] = plan.assignments
  .filter(a => a.sourceKind === "match_winner" || a.sourceKind === "match_loser")
  .map(a => ({ matchId: a.sourceId, side: a.sourceKind === "match_winner" ? "winner" : "loser",
    personId: a.personId }));
const config = resolveConfig(JSON.parse(readFileSync("config/ratings.production.json", "utf8")));
const old = prepareMatches(raw, source.aliases, config);
const person = prepareMatches(raw, source.aliases, config, assignments);
const options = { periodDays: config.period.days, evaluateFrom: "2025-01-01" };
const oldBacktest = runBacktest(old.matches, standardModels(config), options);
const personBacktest = runBacktest(person.matches, standardModels(config), options);
const compact = (report: typeof oldBacktest) => ({
  matches: report.matches, scored: report.scored, eventsScored: report.eventsScored,
  models: report.models.map(model => ({ name: model.name, overall: {
    n: model.overall.n, accuracy: model.overall.accuracy,
    logLoss: model.overall.logLoss, brier: model.overall.brier, ece: model.overall.ece },
    informative: { n: model.informative.n, accuracy: model.informative.accuracy,
      logLoss: model.informative.logLoss, brier: model.informative.brier } })),
});
const result = { sourceChecksum: source.source_checksum, config, options,
  old: compact(oldBacktest), person: compact(personBacktest) };
const output = path.join(directory, "identity-417-backtest.json");
writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ output, old: result.old.models[0], person: result.person.models[0],
  oldMatches: result.old.matches, personMatches: result.person.matches }));
