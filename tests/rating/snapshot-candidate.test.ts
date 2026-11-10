import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readVerifiedSnapshot,SNAPSHOT_KINDS } from "../../scripts/ratings/snapshot";
import { calculateSnapshotCandidate,personSnapshotInputs,type VerifiedSnapshot } from "../../scripts/identity/snapshot-candidate";
import { resolveConfig } from "../../src/lib/rating/config";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const fixture=():VerifiedSnapshot=>{
  const matches=Array.from({length:4},(_,n)=>({id:id(n+1),event_date:n===0?"2025-01-01":"2026-11-07",
    event_name:"Repeated Open",city:null,weight_class:"12U 75",round:String(n),
    winner_name:n===2?"B":"A",winner_team:"Club",loser_name:n===2?"A":"B",loser_team:"Club",
    result:n===1?"DEC 4-2":n===2?"TF 16-1":"F 1:00",win_type:["F","DEC","TF","MD"][n]}));
  const assignments=matches.flatMap((m,n)=>[
    {source_kind:"match_winner",source_id:m.id,person_id:m.winner_name==="A"?id(101):id(102),recorded_name:m.winner_name,revision:1},
    {source_kind:"match_loser",source_id:m.id,person_id:n===3?null:m.loser_name==="A"?id(101):id(102),recorded_name:m.loser_name,revision:1},
  ]);
  return {rows:{matches,assignments,people:[{id:id(101),display_name:"A"},{id:id(102),display_name:"B"}],aliases:[]},
    baseline:SNAPSHOT_KINDS.map(kind=>({kind,n:kind==="matches"?4:kind==="assignments"?8:kind==="people"?2:0,fingerprint:"0".repeat(64)}))};
};
const production=()=>resolveConfig(JSON.parse(readFileSync("config/ratings.production.json","utf8")));

it("uses current verified assignments, preserves reverse-result rematches and held appearances with unchanged formula",()=>{
  const source=fixture(), original=JSON.stringify(source);
  const candidate=calculateSnapshotCandidate(source,production(),"2026-11-09","fixture");
  assert.equal(candidate.model.matches_total,4);assert.equal(candidate.model.matches_rated,3);
  assert.equal(candidate.verification.byReason.unresolved_identity,1);
  assert.equal(candidate.verification.byReason.duplicate_row,0);
  assert.equal(candidate.rows.length,2);assert.equal(candidate.history.length,4);
  assert.equal(candidate.rows.reduce((n,r)=>n+r.wins,0),3);
  assert.equal(JSON.stringify(source),original);
  assert.throws(()=>calculateSnapshotCandidate(source,production(),"2026-11-06","fixture"),/precedes/);
});
it("rejects missing sides, changed recorded names, unknown people and duplicate assignments",()=>{
  const numeric=fixture();
  numeric.rows.assignments.push({source_kind:"tournament_entry",source_id:"125",person_id:id(101),recorded_name:"A",revision:1});
  assert.equal(personSnapshotInputs(numeric).allAssignments.length,9);
  const missing=fixture();missing.rows.assignments.pop();assert.throws(()=>personSnapshotInputs(missing),/Incomplete/);
  const changed=fixture();changed.rows.assignments[0].recorded_name="Changed";assert.throws(()=>personSnapshotInputs(changed),/original source/);
  const orphan=fixture();orphan.rows.assignments[0].person_id=id(999);assert.throws(()=>personSnapshotInputs(orphan),/orphan/);
  const duplicate=fixture();duplicate.rows.assignments.push(duplicate.rows.assignments[0]);assert.throws(()=>personSnapshotInputs(duplicate),/Duplicate/);
});
it("independent daily bisection replay validates all history, current state, records and SOS and rejects payload tampering",()=>{
  const directory=mkdtempSync(path.join(tmpdir(),"mat-notes-candidate-"));
  try {
    const source=fixture();
    const baseline=SNAPSHOT_KINDS.map(kind=>{
      const texts=source.rows[kind].map(row=>JSON.stringify(row));
      if(texts.length)writeFileSync(path.join(directory,kind+"-000.json"),JSON.stringify(texts));
      return {kind,n:texts.length,fingerprint:createHash("sha256").update(texts.map(t=>createHash("md5").update(t).digest("hex")).join("")).digest("hex")};
    });
    writeFileSync(path.join(directory,"baseline.json"),JSON.stringify(baseline));
    const candidate=calculateSnapshotCandidate(readVerifiedSnapshot(directory),production(),"2026-11-09","fixture");
    const file=path.join(directory,"person-rating-candidate.json");
    writeFileSync(file,JSON.stringify(candidate));
    execFileSync(process.execPath,["--import","tsx","scripts/identity/validate-snapshot-candidate.ts",directory],{stdio:"pipe"});
    const report=JSON.parse(readFileSync(path.join(directory,"person-candidate-validation.json"),"utf8"));
    assert.equal(report.historyChecked,4);assert.equal(report.ratingsChecked,2);assert.equal(report.repeatedPairs,1);
    writeFileSync(path.join(directory,"person-candidate-validation-release.json"),JSON.stringify(report));
    const stageArgs=["--import","tsx","scripts/identity/snapshot-rollout-sql.ts",directory,"stage",id(999)];
    execFileSync(process.execPath,stageArgs,{stdio:"pipe"});
    execFileSync(process.execPath,stageArgs,{stdio:"pipe"});
    const staged=path.join(directory,"rollout-"+id(999));
    const manifest=JSON.parse(readFileSync(path.join(staged,"manifest.json"),"utf8"));
    assert.equal(manifest.files.length,4);
    writeFileSync(path.join(staged,manifest.files[0].file),"changed request");
    assert.throws(()=>execFileSync(process.execPath,stageArgs,{stdio:"pipe"}));
    candidate.history[0].rating!+=1;writeFileSync(file,JSON.stringify(candidate));
    assert.throws(()=>execFileSync(process.execPath,["--import","tsx","scripts/identity/validate-snapshot-candidate.ts",directory],{stdio:"pipe"}));
  } finally {
    const resolved=path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep));
    rmSync(resolved,{recursive:true,force:true});
  }
});
