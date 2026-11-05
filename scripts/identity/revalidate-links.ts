import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { revalidateLinks, type ProposedLink } from "../../src/lib/identity/revalidate";
import { buildIdentityPlan } from "../../src/lib/identity/plan";
import { auditIdentities, validateIdentitySnapshot } from "../../src/lib/identity/audit";

const directory = process.argv[2];
if (!directory) throw new Error("Provide the private identity directory");
const read = (name: string) => JSON.parse(readFileSync(path.join(directory, name), "utf8"));
const snapshot = validateIdentitySnapshot(read("identity-source-snapshot.json"));
const confirmed = read("confirmed-identity-decisions.json");
const spelling = read("identity-policy-inferred-links.json");
const nicknames = read("identity-nickname-inferred-links.json");
const checksums = [confirmed.sourceChecksum, spelling.sourceChecksum, nicknames.sourceChecksum];
if (checksums.some(checksum => checksum !== snapshot.source_checksum)) throw new Error("Private source checksums disagree");

// The source snapshot predates the finite 27-alias production catch-up. Read the
// reviewed migration as data and require precisely its 27 planned alias rows.
const migration = readFileSync("supabase/migrations/20261105150000_club_alias_catchup.sql", "utf8");
const newClubs = [...migration.matchAll(/^\s*\('[^']+', '([^']+)', '([^']+)', '[^']+', '[^']+'\)[,;]$/gm)]
  .map(match => ({ alias_key: match[1], club_key: match[2] }));
if (newClubs.length !== 27) throw new Error(`Expected 27 current club aliases; found ${newClubs.length}`);
const old = new Map(snapshot.clubs.map(row => [row.alias_key, row.club_key]));
for (const row of newClubs) {
  if (old.has(row.alias_key) && old.get(row.alias_key) !== row.club_key) throw new Error(`Club alias changed: ${row.alias_key}`);
  old.set(row.alias_key, row.club_key);
}
snapshot.clubs = [...old].map(([alias_key, club_key]) => ({ alias_key, club_key }));
if (snapshot.clubs.length !== 417) throw new Error(`Expected 417 club aliases; found ${snapshot.clubs.length}`);
const currentCases = new Map(auditIdentities(snapshot).cases.map(c => [c.caseId, c]));
let changedEvidenceHashes = 0;

const proposals: ProposedLink[] = [];
for (const decision of confirmed.decisions) {
  if (decision.kind !== "confirmed_same_person") continue;
  if (!Array.isArray(decision.nameLabels) || decision.nameLabels.length < 2) continue;
  for (const label of decision.nameLabels.slice(1)) {
    proposals.push({ keys: [decision.nameLabels[0].toLowerCase(), label.toLowerCase()],
      authority: "owner_confirmed", caseId: decision.caseId, evidenceHash: decision.evidenceHash });
  }
}
for (const source of [spelling, nicknames]) for (const link of source.links) {
  const current = link.caseId ? currentCases.get(link.caseId) : undefined;
  if (link.caseId && (!current || current.keys.join("|") !== [...link.keys].sort().join("|")))
    throw new Error(`Reviewed spelling case missing or changed: ${link.caseId}`);
  const evidenceHash = current?.evidenceHash ?? createHash("sha256").update(JSON.stringify([
    "nickname-evidence-v1", [...link.keys].sort(), link.sourceMatchIds,
    link.sharedClubCount, link.sharedOpponentCount, snapshot.clubs,
  ])).digest("hex");
  if (link.evidenceHash && link.evidenceHash !== evidenceHash) changedEvidenceHashes++;
  proposals.push({ keys: link.keys, authority: "agent_inferred", caseId: link.caseId, evidenceHash });
}
const bermudez = confirmed.decisions.find((d: { kind: string }) => d.kind === "source_evidenced_distinct_people");
const separated = bermudez ? [bermudez.nameLabels] : [];
const result = revalidateLinks(snapshot, proposals, separated);
const report = {
  sourceChecksum: snapshot.source_checksum, sourceRows: snapshot.matches.length, clubAliases: snapshot.clubs.length,
  changedEvidenceHashes,
  checked: result.checked, groups: result.groups,
  summary: {
    ownerAccepted: result.checked.filter(c => c.authority === "owner_confirmed" && c.status === "accepted").length,
    ownerHeld: result.checked.filter(c => c.authority === "owner_confirmed" && c.status === "held").length,
    inferredAccepted: result.checked.filter(c => c.authority === "agent_inferred" && c.status === "accepted").length,
    inferredHeld: result.checked.filter(c => c.authority === "agent_inferred" && c.status === "held").length,
  },
};
const output = path.join(directory, "identity-417-whole-group-revalidation.json");
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
const plan = buildIdentityPlan(snapshot, result.checked, confirmed.decisions);
const planOutput = path.join(directory, "identity-417-assignment-plan.json");
writeFileSync(planOutput, JSON.stringify(plan) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ output, planOutput, changedEvidenceHashes, ...report.summary, ...plan.counts,
  sourceRows: report.sourceRows, clubAliases: report.clubAliases }));
