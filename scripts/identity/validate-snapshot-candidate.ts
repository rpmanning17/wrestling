/** Independent daily replay, source/outcome/identity/record/SOS/history audit and full engine payload replay. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveConfig } from "../../src/lib/rating/config";
import { calculateRatings } from "../../src/lib/rating/engine";
import { prepareMatches } from "../../src/lib/rating/prepare";
import { readVerifiedSnapshot } from "../ratings/snapshot";
import { sha256 } from "../ratings/common";
import { calculateSnapshotCandidate, personSnapshotInputs, VALIDATION_SOURCE_FILES, type SnapshotCandidate } from "./snapshot-candidate";

const directory = process.argv[2];
if (!directory) throw new Error("Verified private snapshot directory required");
const reportName=process.argv[3]??"person-candidate-validation.json";
if (!/^[a-zA-Z0-9._-]+\.json$/.test(reportName)) throw new Error("Private report basename required");
const snapshot = readVerifiedSnapshot(directory), inputs = personSnapshotInputs(snapshot);
const candidate = JSON.parse(readFileSync(path.join(directory,"person-rating-candidate.json"),"utf8")) as SnapshotCandidate;
const production = resolveConfig(JSON.parse(readFileSync("config/ratings.production.json","utf8")));
const replay = calculateSnapshotCandidate(snapshot,production,candidate.model.as_of_date,candidate.model.code_version);
assert.deepEqual(candidate,replay,"Complete serialized metadata/rating/history replay differs");
assert.equal(sha256(JSON.stringify(candidate.rows)),candidate.verification.ratingPayloadSha256);
assert.equal(sha256(JSON.stringify(candidate.history)),candidate.verification.historyPayloadSha256);
assert.equal(production.period.days,1);
assert.equal(production.dominance.winnerScore.decision,0.8);
assert.equal(production.dominance.margin?.enabled??false,false);

// This audit intentionally recognizes the reviewed source codes independently of prepareMatches.
const method = new Map([["F","fall"],["DEC","decision"],["MD","major_decision"],["TF","tech_fall"]]);
const administrative = new Set(["FOR","M FOR","DEF","DQ","NC","MFFL"]);
const assignments = new Map(inputs.allAssignments.map(a=>[a.source_kind+":"+a.source_id,a]));
type Bout = { id:string; date:string; day:number; winner:string; loser:string; decision:boolean; kind:string };
const bouts: Bout[] = [], excluded: Record<string,number> = {};
const exclude = (reason:string) => { excluded[reason]=(excluded[reason]??0)+1; };
const signatures = new Set<string>(), pairs = new Map<string,number>();
for (const row of inputs.raw) {
  const day = Date.parse(row.event_date)/86400000;
  if (!Number.isInteger(day)) { exclude("invalid_date"); continue; }
  const wn=row.winner_name.trim(), ln=row.loser_name.trim();
  if (!wn || !ln) { exclude("missing_name"); continue; }
  if ([wn,ln].some(name=>/^(bye|\(bye\)|tbd|t\.b\.d\.|unknown|unk|n\/?a|vacant|open|forfeit|no opponent|-+|\?+)$/i.test(name))) {
    exclude("placeholder_opponent"); continue;
  }
  const code=row.win_type.trim().toUpperCase();
  if (code==="OTHER1") { exclude("unrecognized_method"); continue; }
  if (administrative.has(code)) { exclude("non_contested_method"); continue; }
  const kind=method.get(code);
  if (!kind) throw new Error("Source method not independently reviewed: "+code);
  const winner=assignments.get("match_winner:"+row.id)!, loser=assignments.get("match_loser:"+row.id)!;
  if (!winner.person_id || !loser.person_id) { exclude("unresolved_identity"); continue; }
  if (winner.person_id===loser.person_id) { exclude("self_match"); continue; }
  const signature=[row.event_date,row.event_name.toLowerCase().replace(/[^a-z0-9]+/g," ").trim(),
    row.weight_class,row.round??"",wn.toLowerCase(),ln.toLowerCase(),row.result??"",code].join("|");
  if (signatures.has(signature)) { exclude("duplicate_row"); continue; }
  signatures.add(signature);
  bouts.push({id:row.id,date:row.event_date,day,winner:winner.person_id,loser:loser.person_id,decision:code==="DEC",kind});
  const pair=[winner.person_id,loser.person_id].sort().join("|");
  pairs.set(pair,(pairs.get(pair)??0)+1);
}
for (const [reason,n] of Object.entries(candidate.verification.byReason)) assert.equal(excluded[reason]??0,n,"Outcome audit: "+reason);
assert.equal(excluded.duplicate_row??0,0,"Exact-duplicate exclusions require separate source review");
assert.equal(bouts.length,candidate.model.matches_rated);
bouts.sort((a,b)=>a.day-b.day||a.id.localeCompare(b.id));

// Independent numerical implementation: bracketed bisection for volatility,
// separate daily state/grouping code. The engine above is only the reference
// for exact payload replay and unrounded numerical comparison, never the audit update.
const scale=173.7178, maxPhi=production.glicko.maxRd/scale;
// The canonical Illinois solver stops at config.epsilon; bisection is tighter.
// Compare unrounded states separately, then allow that same explicit numerical
// bound in addition to half a persisted rounding unit. Exact payload replay above
// remains mandatory; this tolerance cannot authorize altered stored fields.
const stateTolerance=scale*production.glicko.epsilon;
const sigmaTolerance=production.glicko.initialVolatility*production.glicko.epsilon;
const reference=calculateRatings(prepareMatches(inputs.raw,inputs.aliases,production,inputs.sides).matches,
  production,{asOfDate:candidate.model.as_of_date,recordHistory:true});
const referenceHistory=new Map(reference.history.map(p=>[p.key+":"+new Date(p.endDay*86400000).toISOString().slice(0,10),p]));
const referencePlayers=new Map(reference.players.map(p=>[p.key,p]));
type State={mu:number;phi:number;sigma:number;last:number;games:number;wins:number;losses:number;first:string;date:string};
const states=new Map<string,State>(), history=new Map(candidate.history.map(row=>[row.athlete_key+":"+row.period_end,row]));
assert.equal(history.size,candidate.history.length);
const numericMax=new Map<string,number>();
let numericFailures=0;
const close=(actual:number|null,expected:number,tolerance:number,label:string) => {
  if (actual==null || !Number.isFinite(actual) || !Number.isFinite(expected)) throw new Error("Invalid numeric state: "+label);
  const difference=Math.abs(actual-expected);
  numericMax.set(label,Math.max(numericMax.get(label)??0,difference));
  if (difference>tolerance) numericFailures++;
};
const preState=(key:string,day:number) => {
  const old=states.get(key);
  return old ? {...old,phi:Math.min(maxPhi,Math.sqrt(old.phi**2+Math.max(0,day-old.last-1)*old.sigma**2))}
    : {mu:(production.glicko.initialRating-1500)/scale,phi:production.glicko.initialRd/scale,
      sigma:production.glicko.initialVolatility,last:day-1,games:0,wins:0,losses:0,first:"",date:""};
};
let checkedHistory=0;
for (let from=0;from<bouts.length;) {
  let to=from+1; while(to<bouts.length&&bouts[to].day===bouts[from].day) to++;
  const day=bouts[from].day, date=bouts[from].date, pre=new Map<string,State>();
  const games=new Map<string,Array<{opponent:string;score:number;won:boolean}>>();
  for (const bout of bouts.slice(from,to)) {
    const score=bout.decision?0.8:1;
    for (const [key,opponent,s,won] of [[bout.winner,bout.loser,score,true],[bout.loser,bout.winner,1-score,false]] as const) {
      if (!pre.has(key)) pre.set(key,preState(key,day));
      const list=games.get(key)??[]; list.push({opponent,score:s,won}); games.set(key,list);
    }
  }
  for (const [key,list] of games) {
    const p=pre.get(key)!; let inverse=0,sum=0;
    for (const game of list) {
      const o=pre.get(game.opponent)!, g=1/Math.sqrt(1+3*o.phi**2/Math.PI**2);
      const e=1/(1+Math.exp(-g*(p.mu-o.mu)));
      inverse+=g*g*e*(1-e); sum+=g*(game.score-e);
    }
    const v=1/inverse, delta=v*sum, a=Math.log(p.sigma**2), tau=production.glicko.tau;
    const f=(x:number)=>Math.exp(x)*(delta**2-p.phi**2-v-Math.exp(x))/(2*(p.phi**2+v+Math.exp(x))**2)-(x-a)/(tau*tau);
    let lo=a-1,hi=a+1;
    for(let n=0;f(lo)<0&&n<100;n++)lo-=1;
    for(let n=0;f(hi)>0&&n<100;n++)hi+=1;
    assert.ok(f(lo)>=0&&f(hi)<=0,"Volatility root bracket");
    for(let n=0;n<80;n++){const mid=(lo+hi)/2;if(f(mid)>0)lo=mid;else hi=mid;}
    const sigma=Math.exp((lo+hi)/4),phi=1/Math.sqrt(1/(p.phi*p.phi+sigma*sigma)+inverse);
    const mu=p.mu+phi*phi*sum;
    const next={mu,phi,sigma,last:day,games:p.games+list.length,
      wins:p.wins+list.filter(g=>g.won).length,losses:p.losses+list.filter(g=>!g.won).length,
      first:p.first||date,date};
    states.set(key,next);
    const point=history.get(key+":"+date);
    assert.ok(point,"Missing history period"); assert.equal(point.person_id,key);
    assert.equal(point.match_count,next.games);
    const canonical=referenceHistory.get(key+":"+date)!;
    close(canonical.rating,1500+mu*scale,stateTolerance,"unrounded history rating");
    close(canonical.rd,phi*scale,stateTolerance,"unrounded history RD");
    close(canonical.sigma,sigma,sigmaTolerance,"unrounded history volatility");
    close(point.rating,1500+mu*scale,0.0005+stateTolerance,"history rating");
    close(point.rating_deviation,phi*scale,0.0005+stateTolerance,"history RD");
    close(point.volatility,sigma,0.0000005+sigmaTolerance,"history volatility");
    checkedHistory++;
  }
  from=to;
}
assert.equal(checkedHistory,candidate.history.length,"Extra history rows");
assert.equal(states.size,candidate.rows.length);
const asOf=Date.parse(candidate.model.as_of_date)/86400000;
const current=new Map([...states].map(([key,p])=>[key,{rating:1500+p.mu*scale,
  rd:scale*Math.min(maxPhi,Math.sqrt(p.phi*p.phi+Math.max(0,asOf-p.last-1)*p.sigma*p.sigma)),sigma:p.sigma}]));
const records=new Map<string,{opponents:string[];wins:number;losses:number}>();
for (const bout of bouts) for(const [key,opponent,won] of [[bout.winner,bout.loser,true],[bout.loser,bout.winner,false]] as const) {
  const entry=records.get(key)??{opponents:[],wins:0,losses:0};
  entry.opponents.push(opponent); if(won)entry.wins++;else entry.losses++; records.set(key,entry);
}
const seenPeople=new Set<string>();
for(const row of candidate.rows) {
  const key=row.athlete_key,p=states.get(key)!,state=current.get(key)!,record=records.get(key)!;
  assert.ok(p&&state&&record&&!seenPeople.has(key));seenPeople.add(key);
  assert.equal(row.person_id,key);assert.equal(row.athlete_name,inputs.people.get(key));
  assert.equal(row.wins,record.wins);assert.equal(row.losses,record.losses);assert.equal(row.match_count,p.games);
  assert.equal(row.first_match_date,p.first);assert.equal(row.last_match_date,p.date);
  const canonical=referencePlayers.get(key)!;
  close(canonical.rating,state.rating,stateTolerance,"unrounded current rating");
  close(canonical.rd,state.rd,stateTolerance,"unrounded current RD");
  close(canonical.volatility,state.sigma,sigmaTolerance,"unrounded current volatility");
  close(row.rating,state.rating,0.0005+stateTolerance,"current rating");
  close(row.rating_deviation,state.rd,0.0005+stateTolerance,"current RD");
  close(row.volatility,state.sigma,0.0000005+sigmaTolerance,"current volatility");
  close(row.conservative_score,state.rating-production.uncertainty.k*state.rd,
    0.0005+(1+production.uncertainty.k)*stateTolerance,"conservative rating");
  const opponentRatings=record.opponents.map(id=>current.get(id)!.rating);
  close(row.avg_opponent_rating,opponentRatings.reduce((a,b)=>a+b,0)/opponentRatings.length,0.00501,"SOS rating");
  close(row.sos_expected_win_pct,opponentRatings.reduce((a,b)=>a+1/(1+10**((b-production.metrics.sosReferenceRating)/400)),0)/opponentRatings.length,0.00000501,"SOS expectation");
}
const report={validated:true,sourceRows:inputs.raw.length,assignments:inputs.allAssignments.length,
  heldAppearances:inputs.allAssignments.filter(a=>a.person_id==null).length,ratedBouts:bouts.length,
  ratingsChecked:candidate.rows.length,historyChecked:checkedHistory,repeatedPairs:[...pairs.values()].filter(n=>n>1).length,
  exclusions:excluded,assignmentFingerprint:inputs.assignmentFingerprint,
  inputFingerprint:candidate.model.input_fingerprint,ratingPayloadSha256:candidate.verification.ratingPayloadSha256,
  historyPayloadSha256:candidate.verification.historyPayloadSha256,baseline:snapshot.baseline,
  numericMaximumDifferences:Object.fromEntries(numericMax),
  numericalBounds:{unroundedRatingAndRd:stateTolerance,unroundedVolatility:sigmaTolerance},
  validationSourceSha256:Object.fromEntries(VALIDATION_SOURCE_FILES.map(file=>[file,sha256(readFileSync(file,"utf8").replace(/\r\n/g,"\n"))]))};
if(numericFailures) throw new Error("Independent numeric audit failed: "+JSON.stringify({numericFailures,max:Object.fromEntries(numericMax)}));
writeFileSync(path.join(directory,reportName),JSON.stringify(report,null,2)+"\n",{mode:0o600,flag:"wx"});
console.log(JSON.stringify(report));
