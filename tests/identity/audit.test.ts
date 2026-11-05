import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { auditIdentities,validateIdentitySnapshot,type IdentitySnapshot,type AuditMatch,type AuditDecision } from "../../src/lib/identity/audit";

const match=(id:string,winner="Example One",loser="Other Person",patch:Record<number,string|number|null>={}):AuditMatch=>Object.assign([id,"2026-10-01","Example Open","Town","FL","75","Round 1",winner,"Club A",loser,"Club B","4-2","DEC","invented.csv",2],patch) as AuditMatch;
const snapshot=(matches:AuditMatch[]):IdentitySnapshot=>({matches,aliases:[],clubs:[],entries:[],observations:[]});

describe("identity candidate audit",()=>{
  it("automatically handles casing, existing aliases and reviewed club variants without changing source data",()=>{
    const s=snapshot([match("1","Example One"),match("2","EXAMPLE ONE"),match("3","Example On")]);
    s.aliases=[{alias_key:"example on",canonical_key:"example one",canonical_name:"Example One"}];
    s.clubs=[{alias_key:"club a",club_key:"club-a"},{alias_key:"club alpha",club_key:"club-a"}];
    s.matches[1][8]="Club Alpha";
    const before=JSON.stringify(s);const r=auditIdentities(s);
    assert.equal(r.summary.existingAliasAppearancesHandled,1);assert.equal(r.cases.length,0);assert.equal(JSON.stringify(s),before);
  });
  it("does not flag club switching, weight changes or double brackets alone",()=>{
    const r=auditIdentities(snapshot([match("1"),match("2","Example One","Third Person",{5:"100",8:"Different Club"}),match("3","Example One","Fourth Person",{1:"2026-10-08",5:"120",8:"New Club"})]));
    assert.equal(r.cases.length,0);
  });
  it("finds same-name incompatible same-day context, retaining source labels rather than measured weights",()=>{
    const r=auditIdentities(snapshot([match("1"),match("2","Example One","Third Person",{2:"Other Open",3:"Other Town",5:"175",8:"Different Club"})]));
    const c=r.cases.find(c=>c.kind==="same_name_context_conflict")!;
    assert.ok(c);assert.equal(c.sourceRecords.length,2);assert.match(c.signals.join(),/bracket labels/);
  });
  it("excludes administrative self-results from identity alarms while retaining contested self-results",()=>{
    const s=snapshot([match("1","Example One","Example One",{12:"NC"}),match("2","Another Person","Another Person")]);
    const r=auditIdentities(s);assert.equal(r.summary.administrativeSelfMatchesAlreadyExcluded,1);
    assert.equal(r.cases.length,1);assert.deepEqual(r.cases[0].keys,["another person"]);
  });
  it("proposes spelling variants only with context and warns when labels directly meet",()=>{
    const s=snapshot([match("1","Example One","Example On")]);
    s.matches.push(match("2","Example On","Other Person"));
    const r=auditIdentities(s);const c=r.cases.find(c=>c.kind==="name_variant_review")!;
    assert.ok(c);assert.match(c.signals.join(),/occur as opponents/);assert.equal(r.writesPerformed,false);
  });
  it("does not inflate shared event evidence by repeated bouts and is independent of source order",()=>{
    const rows=[match("1"),match("2","Example On","Third Person"),match("3","Example On","Fourth Person")];
    const a=auditIdentities(snapshot(rows));const b=auditIdentities(snapshot([...rows].reverse()));
    assert.deepEqual(a,b);assert.match(a.cases[0].signals.join(),/1 distinct event/);
  });
  it("keeps source observation evidence and never treats multiple age brackets as a split by itself",()=>{
    const s=snapshot([match("1")]);
    s.observations=[{id:1,athlete_name:"Example One",team:"Club A",event_date:"2026-10-01",event_name:"Example Open",age_group:"10U"},
      {id:2,athlete_name:"Example One",team:"Club A",event_date:"2026-10-01",event_name:"Example Open",age_group:"12U"}];
    assert.equal(auditIdentities(s).cases.length,0);
    s.matches.push(match("2","Example On"));
    assert.equal(auditIdentities(s).cases[0].contextRecords.length,2);
  });
  it("suppresses reviewed cases until relevant evidence changes; unrelated imports do not reopen them",()=>{
    const s=snapshot([match("1"),match("2","Example On")]);const c=auditIdentities(s).cases[0];
    const decisions:AuditDecision[]=[{caseId:c.caseId,evidenceHash:c.evidenceHash,disposition:"unresolved",reason:"No additional source evidence"}];
    assert.equal(auditIdentities(s,decisions).cases.length,0);
    s.matches.push(match("3","Separate Person","Unrelated Opponent"));
    assert.equal(auditIdentities(s,decisions).cases.length,0);
    s.matches[0][11]="6-2";
    assert.equal(auditIdentities(s,decisions).cases.length,1);
    assert.throws(()=>auditIdentities(s,[{...decisions[0],disposition:"merge"} as unknown as AuditDecision]),/Invalid/);
  });
  it("rejects duplicate/incomplete source rows rather than silently undercounting",()=>{
    assert.throws(()=>validateIdentitySnapshot(snapshot([match("1"),match("1")])),/duplicate/);
    assert.throws(()=>validateIdentitySnapshot({matches:[]}),/Incomplete/);
  });
  it("CLI writes exclusive private reports with source evidence and prints counts only",()=>{
    const dir=mkdtempSync(join(tmpdir(),"mat-notes-identity-"));
    try{
      const input=join(dir,"snapshot.json"),output=join(dir,"report.json"),review=join(dir,"review.md");
      writeFileSync(input,JSON.stringify(snapshot([match("1"),match("2","Example On")])));
      const args=["--import","tsx","scripts/identity/audit.ts","--input",input,"--report",output,"--review",review];
      const run=()=>spawnSync(process.execPath,args,{encoding:"utf8",timeout:30000});
      const first=run();assert.equal(first.status,0,first.stderr);assert.doesNotMatch(first.stdout,/Example One/);
      assert.match(readFileSync(review,"utf8"),/invented.csv/);
      assert.equal(JSON.parse(readFileSync(output,"utf8")).cases.length,1);
      assert.equal(run().status,1);
      args[args.indexOf(output)]=join(process.cwd(),"forbidden-identity.json");
      assert.match(run().stderr,/outside the repository/);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
});
