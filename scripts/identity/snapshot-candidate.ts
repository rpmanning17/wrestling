/** Verified-current-assignment input path. Historical 67,736-row plan remains unchanged. */
import { calculateRatings } from "../../src/lib/rating/engine";
import { resolveConfig, periodPolicyLabel, type RatingConfig } from "../../src/lib/rating/config";
import { serializeRatingRows, serializeHistoryRows, roundPersisted } from "../../src/lib/rating/persistence";
import { assertSameFormula } from "../../src/lib/rating/recovery";
import { prepareMatches, type RawMatch, type AliasRow, type MatchIdentityAssignment } from "../../src/lib/rating/prepare";
import { configHash, inputFingerprint, sha256 } from "../ratings/common";
import { SNAPSHOT_KINDS, type readVerifiedSnapshot } from "../ratings/snapshot";

export type VerifiedSnapshot = ReturnType<typeof readVerifiedSnapshot>;
export type Assignment = { source_kind: string; source_id: string; recorded_name: string; person_id: string | null; revision: number };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const text = (row: Record<string, unknown>, field: string) => {
  if (typeof row[field] !== "string") throw new Error("Invalid snapshot field: " + field);
  return row[field] as string;
};
const nullableText = (row: Record<string, unknown>, field: string) => row[field] == null ? null : text(row, field);
const uuid = (value: string) => { if (!UUID.test(value)) throw new Error("Invalid snapshot UUID"); return value; };

export function personSnapshotInputs(snapshot: VerifiedSnapshot) {
  const { rows } = snapshot;
  const people = new Map<string, string>();
  for (const row of rows.people) {
    const id = uuid(text(row, "id")), name = text(row, "display_name");
    if (people.has(id) || !name.trim()) throw new Error("Duplicate or unnamed person");
    people.set(id, name);
  }
  const raw: RawMatch[] = rows.matches.map(row => ({
    id: uuid(text(row,"id")), event_date: text(row,"event_date"), event_name: text(row,"event_name"),
    city: nullableText(row,"city"), weight_class: text(row,"weight_class"), round: nullableText(row,"round"),
    winner_name: text(row,"winner_name"), winner_team: nullableText(row,"winner_team"),
    loser_name: text(row,"loser_name"), loser_team: nullableText(row,"loser_team"),
    result: nullableText(row,"result"), win_type: text(row,"win_type"),
  }));
  const matchById = new Map(raw.map(row => [row.id,row]));
  if (matchById.size !== raw.length) throw new Error("Duplicate source match ID");
  const allAssignments: Assignment[] = [];
  const sides: MatchIdentityAssignment[] = [];
  const seen = new Set<string>();
  for (const row of rows.assignments) {
    const kind = text(row,"source_kind"), id = uuid(text(row,"source_id"));
    if (!["match_winner","match_loser","tournament_entry","tournament_observation"].includes(kind))
      throw new Error("Unexpected source appearance kind");
    const key = kind+":"+id, personId = row.person_id == null ? null : uuid(text(row,"person_id"));
    if (seen.has(key) || (personId && !people.has(personId))) throw new Error("Duplicate or orphan source assignment");
    if (!Number.isSafeInteger(row.revision) || Number(row.revision)<1) throw new Error("Invalid assignment revision");
    seen.add(key);
    const assignment = { source_kind:kind, source_id:id, recorded_name:text(row,"recorded_name"),
      person_id:personId, revision:Number(row.revision) };
    allAssignments.push(assignment);
    if (kind.startsWith("match_")) {
      const match = matchById.get(id), side = kind === "match_winner" ? "winner" : "loser";
      if (!match || match[side === "winner" ? "winner_name" : "loser_name"] !== assignment.recorded_name)
        throw new Error("Assignment does not match original source side");
      sides.push({ matchId:id, side, personId });
    }
  }
  if (sides.length !== raw.length*2) throw new Error("Incomplete source match-side coverage");
  const aliases: AliasRow[] = rows.aliases.map(row => ({alias_key:text(row,"alias_key"),
    canonical_key:text(row,"canonical_key"),canonical_name:text(row,"canonical_name")}));
  if (new Set(aliases.map(row=>row.alias_key)).size !== aliases.length) throw new Error("Duplicate alias key");
  const ordered = [...allAssignments].sort((a,b)=>a.source_kind<b.source_kind?-1:a.source_kind>b.source_kind?1:
    a.source_id<b.source_id?-1:a.source_id>b.source_id?1:0);
  const assignmentFingerprint = sha256(ordered.map(a => [a.source_kind,a.source_id,
    Buffer.from(a.recorded_name,"utf8").toString("hex"),a.person_id??""].join("\u001f")).join("\n"));
  const sourceRatingInputFingerprint = inputFingerprint({matches:raw,aliases,source:"verified-snapshot"});
  const inputHash = sha256(JSON.stringify(["person-rating-input-v2",sourceRatingInputFingerprint,
    assignmentFingerprint,SNAPSHOT_KINDS.map(kind=>snapshot.baseline.find(row=>row.kind===kind))]));
  return {raw,aliases,people,sides,allAssignments,assignmentFingerprint,sourceRatingInputFingerprint,inputHash};
}

export function calculateSnapshotCandidate(snapshot: VerifiedSnapshot, production: RatingConfig, asOfDate: string, codeVersion: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate) || new Date(asOfDate).toISOString().slice(0,10)!==asOfDate)
    throw new Error("Explicit valid as-of date required");
  const inputs = personSnapshotInputs(snapshot);
  if (inputs.raw.some(row=>row.event_date>asOfDate)) throw new Error("As-of date precedes source bouts");
  const config = resolveConfig({...production,modelVersion:"glicko2-daily-dec08-person-identity-v1"});
  assertSameFormula(production,config);
  const prepared = prepareMatches(inputs.raw,inputs.aliases,config,inputs.sides);
  const result = calculateRatings(prepared.matches,config,{asOfDate,recordHistory:true});
  for (const player of result.players) player.name = inputs.people.get(player.key)!;
  const rows = serializeRatingRows(result,"PENDING").map(row=>({...row,person_id:row.athlete_key}));
  const history = serializeHistoryRows(result,"PENDING").map(row=>({...row,person_id:row.athlete_key}));
  const model = {
    model_version:config.modelVersion,status:"building",identity_scheme:"person_uuid",
    assignment_fingerprint:inputs.assignmentFingerprint,config,config_hash:configHash(config),
    input_fingerprint:inputs.inputHash,code_version:codeVersion,as_of_date:asOfDate,
    match_cutoff:result.matchCutoff,first_match_date:result.firstMatchDate,
    rating_period_policy:periodPolicyLabel(config),rating_period_days:config.period.days,
    uncertainty_k:config.uncertainty.k,provisional_rd:config.uncertainty.provisionalRd,
    established_rd:config.uncertainty.establishedRd,recency_policy:config.recency.policy,
    dominance_enabled:config.dominance.enabled,matches_total:prepared.report.total,matches_rated:prepared.report.rated,
    matches_excluded:{byReason:prepared.report.byReason,excludedMethods:prepared.report.excludedMethods,
      unrecognizedWinTypes:prepared.report.unrecognizedWinTypes},
    wrestlers_rated:rows.length,quality_threshold:roundPersisted(result.qualityThreshold,2),
    label:"Verified source snapshot — unchanged person-keyed daily decision-0.8 Glicko-2",
    notes:"Current assignments including held appearances. Full private snapshot and output validation required before supervised promotion.",
  };
  const verification = { baseline:snapshot.baseline,sourceRatingInputFingerprint:inputs.sourceRatingInputFingerprint,
    assignmentFingerprint:inputs.assignmentFingerprint,sourceMatches:inputs.raw.length,
    ratingPayloadSha256:sha256(JSON.stringify(rows)),historyPayloadSha256:sha256(JSON.stringify(history)),
    ...prepared.report,ratedPeople:rows.length,historyPoints:history.length,
    wins:rows.reduce((sum,row)=>sum+row.wins,0),losses:rows.reduce((sum,row)=>sum+row.losses,0) };
  if (verification.wins!==prepared.report.rated || verification.losses!==prepared.report.rated)
    throw new Error("Unbalanced rated bout totals");
  return {model,rows,history,verification};
}
export type SnapshotCandidate = ReturnType<typeof calculateSnapshotCandidate>;
