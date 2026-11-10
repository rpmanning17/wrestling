/** Emit one validated, bounded administrator request. Never connects or activates. */
import assert from "node:assert/strict";
import { readFileSync,writeFileSync,existsSync,mkdirSync } from "node:fs";
import path from "node:path";
import { guardedBatchSql,sqlLiteral } from "../../src/lib/rating/recovery";
import { sha256 } from "../ratings/common";
import { readVerifiedSnapshot } from "../ratings/snapshot";
import { personSnapshotInputs,VALIDATION_SOURCE_FILES,type SnapshotCandidate } from "./snapshot-candidate";

const [directory,phase,modelId,rawIndex] = process.argv.slice(2);
if(!directory||!["model","stage","ratings","history","verify-ratings","verify-history"].includes(phase))
  throw new Error("Use private directory model|ratings|history|verify-ratings|verify-history [model UUID] [batch index]");
const candidate=JSON.parse(readFileSync(path.join(directory,"person-rating-candidate.json"),"utf8")) as SnapshotCandidate;
const audit=JSON.parse(readFileSync(path.join(directory,"person-candidate-validation-release.json"),"utf8"));
assert.equal(audit.validated,true);
assert.equal(audit.ratingPayloadSha256,sha256(JSON.stringify(candidate.rows)));
assert.equal(audit.historyPayloadSha256,sha256(JSON.stringify(candidate.history)));
assert.equal(audit.inputFingerprint,candidate.model.input_fingerprint);
assert.deepEqual(audit.validationSourceSha256,Object.fromEntries(VALIDATION_SOURCE_FILES.map(file=>[file,sha256(readFileSync(file,"utf8").replace(/\r\n/g,"\n"))])));
const snapshot=readVerifiedSnapshot(directory);
assert.deepEqual(audit.baseline,snapshot.baseline);
assert.equal(personSnapshotInputs(snapshot).assignmentFingerprint,candidate.model.assignment_fingerprint);
const less=(a:string,b:string)=>a<b?-1:a>b?1:0;
const orderedRows=[...candidate.rows].sort((a,b)=>less(a.athlete_key,b.athlete_key));
const orderedHistory=[...candidate.history].sort((a,b)=>less(a.athlete_key,b.athlete_key)||less(a.period_end,b.period_end));
function sqlFor(table:"wrestler_model_ratings"|"wrestler_rating_history",batch:Array<Record<string,unknown>>,verify:boolean) {
  if(!verify)return guardedBatchSql({...candidate.model,id:modelId},table,batch);
  const keys=table==="wrestler_model_ratings"?["model_id","athlete_key"]:["model_id","athlete_key","period_end"];
  const order=table==="wrestler_model_ratings"?'e.athlete_key collate "C"':'e.athlete_key collate "C",e.period_end';
  return `with expected as(
    select * from jsonb_populate_recordset(null::public.${table},${sqlLiteral(JSON.stringify(batch))}::jsonb)
  ) select count(*) checked,count(*) filter(where s.model_id is null or to_jsonb(s) is distinct from to_jsonb(e)) mismatches,
    encode(sha256(convert_to(string_agg(md5(to_jsonb(e)::text),'' order by ${order}),'UTF8')),'hex') expected_chunk_hash
    from expected e left join public.${table} s on ${keys.map(k=>"s."+k+"=e."+k).join(" and ")};`;
}
if(phase==="model") {
  const columns=Object.keys(candidate.model);
  process.stdout.write(`insert into public.rating_models (${columns.join(",")})
   select ${columns.map(k=>"m."+k).join(",")} from jsonb_populate_record(null::public.rating_models,
   ${sqlLiteral(JSON.stringify(candidate.model))}::jsonb) m returning id;`);
} else if(phase==="stage") {
  if(!modelId||!/^[a-f0-9-]{36}$/.test(modelId))throw new Error("Explicit model UUID required");
  const staged=path.join(directory,"rollout-"+modelId);mkdirSync(staged,{recursive:true});
  const files:Array<{file:string;sha256:string;rows:number}>=[];
  const save=(file:string,sql:string,n:number)=>{
    const target=path.join(staged,file);
    if(existsSync(target))assert.equal(readFileSync(target,"utf8"),sql,"Conflicting staged request");
    else writeFileSync(target,sql,{mode:0o600,flag:"wx"});
    files.push({file,sha256:sha256(sql),rows:n});
  };
  for(const [name,table,rows] of [["ratings","wrestler_model_ratings",orderedRows],
    ["history","wrestler_rating_history",orderedHistory]] as const) {
    for(let from=0;from<rows.length;from+=250) {
      const batch=rows.slice(from,from+250).map(row=>({...row,model_id:modelId}));
      const index=String(from/250).padStart(3,"0");
      save(name+"-"+index+".sql",sqlFor(table,batch,false),batch.length);
      save("verify-"+name+"-"+index+".sql",sqlFor(table,batch,true),batch.length);
    }
  }
  const manifest=JSON.stringify({modelId,inputFingerprint:candidate.model.input_fingerprint,
    validationSourceSha256:audit.validationSourceSha256,files},null,2)+"\n";
  const manifestFile=path.join(staged,"manifest.json");
  if(existsSync(manifestFile))assert.equal(readFileSync(manifestFile,"utf8"),manifest);
  else writeFileSync(manifestFile,manifest,{mode:0o600,flag:"wx"});
  console.log(JSON.stringify({staged,files:files.length,ratings:orderedRows.length,history:orderedHistory.length}));
} else {
  if(!modelId||!/^[a-f0-9-]{36}$/.test(modelId))throw new Error("Explicit model UUID required");
  const index=Number(rawIndex??0);
  if(!Number.isInteger(index)||index<0)throw new Error("Nonnegative batch index required");
  const isRating=phase.endsWith("ratings"),table=isRating?"wrestler_model_ratings":"wrestler_rating_history";
  const all=isRating?orderedRows:orderedHistory;
  const batch=all.slice(index*250,(index+1)*250).map(row=>({...row,model_id:modelId}));
  if(!batch.length)throw new Error("Batch outside payload");
  process.stdout.write(sqlFor(table,batch,phase.startsWith("verify-")));
}
