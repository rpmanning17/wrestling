/** Read-only offline identity audit. Input/output contain participant data: keep outside Git. */
import { readFileSync, writeFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { auditIdentities, validateIdentitySnapshot, type AuditDecision } from "../../src/lib/identity/audit";

function main() {
  const opts=new Map<string,string>(),args=process.argv.slice(2);
  for(let i=0;i<args.length;i+=2){
    if(!["--input","--report","--review","--decisions","--batch-size"].includes(args[i]) || !args[i+1] || args[i+1].startsWith("--") || opts.has(args[i])) throw new Error("Use --input <private-snapshot.json> --report <private-report.json> [--review <private.md>] [--decisions <private.json>] [--batch-size 1..30]");
    opts.set(args[i],args[i+1]);
  }
  if(!opts.has("--input")||!opts.has("--report"))throw new Error("Explicit private snapshot and report required");
  const root=realpathSync(resolve(__dirname,"../.."));
  const out=(p:string)=>{
    const dest=resolve(realpathSync(dirname(resolve(p))),basename(p)),rel=relative(root,dest);
    if(!rel||(!rel.startsWith("..")&&!isAbsolute(rel)))throw new Error("Write participant reports outside the repository, including symlinks");
    return dest;
  };
  const reportPath=out(opts.get("--report")!);
  const reviewPath=opts.has("--review")?out(opts.get("--review")!):undefined;
  if(reviewPath?.toLowerCase()===reportPath.toLowerCase())throw new Error("Report paths must differ");
  const size=Number(opts.get("--batch-size")??25);
  if(!Number.isInteger(size)||size<1||size>30)throw new Error("Review batch size must be 1..30");
  const read=(p:string)=>{
    if(statSync(p).size>128*1024*1024)throw new Error("Private JSON exceeds input limit");
    return JSON.parse(readFileSync(p,"utf8"));
  };
  const snapshot=validateIdentitySnapshot(read(opts.get("--input")!));
  const decisions:unknown=opts.has("--decisions")?read(opts.get("--decisions")!):[];
  if(!Array.isArray(decisions))throw new Error("Decisions must be a JSON array");
  const report=auditIdentities(snapshot,decisions as AuditDecision[]);
  writeFileSync(reportPath,JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
  if(reviewPath){
    const safe=(s:unknown)=>String(s??"").replaceAll("\\","\\\\").replace(/[|<>`\r\n]/g," ");
    const lines=["# Private identity review", "",report.warning,"",`Showing ${Math.min(size,report.cases.length)} of ${report.cases.length} queued cases. Priority is triage, not a probability of identity.`,""];
    for(const c of report.cases.slice(0,size)){
      lines.push(`## ${c.labels.map(x=>x.map(safe).join(" / ")).join(" ↔ ")}`,"",`Case: ${c.caseId}`,`Evidence: ${c.evidenceHash}`,"",...c.signals.map(s=>"- "+safe(s)),"",`${c.affectedSourceBouts} source bouts; ${c.opponentKeys} connected opponent labels.`,"",
        "| Date | Event | Bracket | Winner / team | Loser / team | Outcome | Original source / record |","|---|---|---|---|---|---|---|");
      for(const r of c.sourceRecords)lines.push(`| ${safe(r[1])} | ${safe(r[2])} | ${safe(r[5])} | ${safe(r[7])} / ${safe(r[8])} | ${safe(r[9])} / ${safe(r[10])} | ${safe(r[12])} ${safe(r[11])} | ${safe(r[13])} / ${safe(r[14])} |`);
      lines.push("","Entry/observation evidence is preserved in the JSON report. Source rows are not merged, split or deleted.","");
    }
    writeFileSync(reviewPath,lines.join("\n")+"\n",{flag:"wx",mode:0o600});
  }
  console.log(JSON.stringify({version:report.version,...report.summary,writesPerformed:false},null,2));
}
try{main();}catch(e){console.error(e instanceof Error?e.message:e);process.exitCode=1;}
