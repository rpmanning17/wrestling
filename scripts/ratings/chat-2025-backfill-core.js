/**
 * Pure, self-contained backfill calculator for connector-side orchestration.
 * Mirrors src/lib/rating/{prepare,glicko2,models,engine}.ts; no network or credentials.
 * Results MUST be validated against the existing active model before activation.
 * This branch utility is not used by the deployed site.
 *
 * Evaluate the file contents as a JS expression to obtain calculate(raw, aliases, config, asOf).
 */
((raw, aliases, config, asOfDate) => {
  const scale = 173.7178;
  const day = s => Math.floor(Date.UTC(+s.slice(0,4), +s.slice(5,7)-1, +s.slice(8,10))/86400000);
  const iso = d => new Date(d*86400000).toISOString().slice(0,10);
  const periodOf = d => Math.floor((d-4)/config.period.days);
  const round = (x,n) => x==null ? null : +x.toFixed(n);
  const clean = s => String(s??"").toUpperCase().replace(/[().]/g," ").replace(/\s+/g," ").trim();
  const rules = [
    [/^(BYE|BYE.*)$/,"bye"],
    [/^(M FOR|MFFL|MFF|MED FOR|MEDICAL.*|MEDICAL FORFEIT|MFOR)$/,"medical_forfeit"],
    [/^(FOR|FFT|FF|FORFEIT|FORF|FOR.*)$/,"forfeit"],
    [/^(DEF|DEFAULT|INJ|INJURY.*|INJ DEF|INJURY DEFAULT)$/,"default"],
    [/^(DQ|DISQ|DISQUALIFICATION|DISQUALIFIED)$/,"disqualification"],
    [/^(NC|NO CONTEST|NO MATCH)$/,"no_contest"],
    [/^(F|FALL|PIN|PINFALL|FALL .*|PIN .*|F .*)$/,"fall"],
    [/^(TF|TECH|TECH FALL|TECHNICAL FALL|TECHNICAL SUPERIORITY|TF .*|TECH .*|TF-?\d.*)$/,"tech_fall"],
    [/^(MD|MAJ|MAJOR|MAJOR DEC|MAJOR DECISION|MD .*|MAJ .*)$/,"major_decision"],
    [/^(DEC|DECISION|DEC .*|SV|SV-?\d*|SV .*|SUDDEN VICTORY.*|TB|TB-?\d*|TB .*|UTB|UTB.*|TIEBREAKER.*|TIE BREAKER.*|OT|DEC OT|OVERTIME.*|DEC SV.*)$/,"decision"]
  ];
  function classify(type, result) {
    let x=clean(type);
    for (const [re,kind] of rules) if(re.test(x)) return kind;
    if(!x) {
      x=clean(result).split(" ")[0];
      for (const [re,kind] of rules) if(re.test(x)) return kind;
    }
    return "unknown";
  }
  const direct = new Map(aliases.map(a=>[a.alias_key.trim().toLowerCase(), {key:a.canonical_key.trim().toLowerCase(),name:a.canonical_name}]));
  const resolve = s => {
    let v={key:s.trim().toLowerCase(),name:""};
    for(let i=0;i<5;i++) {
      const n=direct.get(v.key);
      if(!n || n.key===v.key)break;
      v=n;
    }
    return v;
  };
  const placeholder = /^(bye|\(bye\)|tbd|t\.b\.d\.|unknown|unk|n\/?a|vacant|open|forfeit|no opponent|-+|\?+)$/i;
  const byReason={invalid_date:0,missing_name:0,placeholder_opponent:0,self_match:0,non_contested_method:0,unrecognized_method:0,duplicate_row:0};
  const excludedMethods={},unrecognizedWinTypes={};
  const seen=new Set(),matches=[];
  let aliasesApplied=0,noBracketWeight=0,ageGroupParsed=0;
  for(const r of raw) {
    const ds=String(r.event_date??""),d=ds.slice(0,10),wn=String(r.winner_name??"").trim(),ln=String(r.loser_name??"").trim();
    if(!/^\d{4}-\d{2}-\d{2}/.test(ds)||Number.isNaN(Date.parse(d))) {byReason.invalid_date++;continue;}
    if(!wn||!ln){byReason.missing_name++;continue;}
    if(placeholder.test(wn)||placeholder.test(ln)){byReason.placeholder_opponent++;continue;}
    const method=classify(r.win_type,r.result),methodLabel=String(r.win_type??"").trim().toUpperCase()||"(blank)";
    if(method==="unknown"){unrecognizedWinTypes[methodLabel]=(unrecognizedWinTypes[methodLabel]??0)+1;byReason.unrecognized_method++;continue;}
    if(!config.outcomes.contested.includes(method)){excludedMethods[method]=(excludedMethods[method]??0)+1;byReason.non_contested_method++;continue;}
    const w=resolve(wn),l=resolve(ln);
    if(w.name) aliasesApplied++;
    if(l.name) aliasesApplied++;
    if(w.key===l.key){byReason.self_match++;continue;}
    const signature=[d,String(r.event_name??"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(),r.weight_class,r.round??"",w.key,l.key,r.result??"",methodLabel].join("|");
    if(config.matching.dedupeExactRows){if(seen.has(signature)){byReason.duplicate_row++;continue;}seen.add(signature);}
    let margin=null;
    if(method!=="fall"){
      const s=/(?<![\w:./-])(\d{1,3})\s*-\s*(\d{1,3})(?![\d:./])/.exec(String(r.result??""));
      if(s&&+s[1]>+s[2])margin=+s[1]-+s[2];
    }
    const bw=/([0-9]+(?:\.[0-9]+)?)\D*$/.exec(String(r.weight_class??""));
    if(!bw||+bw[1]<30||+bw[1]>400)noBracketWeight++;
    if(/(?<![0-9])(6|8|10|12|14|16|18)\s?U(?![A-Za-z])/i.test(r.weight_class)||/(?<![0-9])(6|8|10|12|14|16|18)\s?U(?![A-Za-z])/i.test(r.event_name))ageGroupParsed++;
    matches.push({id:r.id,day:day(d),date:d,w:w.key,l:l.key,wn:w.name||wn,ln:l.name||ln,wt:String(r.winner_team??"").trim(),lt:String(r.loser_team??"").trim(),method,margin});
  }
  matches.sort((a,b)=>a.day-b.day||a.id.localeCompare(b.id));
  const report={total:raw.length,rated:matches.length,excluded:raw.length-matches.length,byReason,excludedMethods,unrecognizedWinTypes,aliasesApplied,noBracketWeight,ageGroupParsed};
  const cfg=config.glicko,maxPhi=cfg.maxRd/scale;
  const g=phi=>1/Math.sqrt(1+3*phi*phi/(Math.PI*Math.PI));
  function newVolatility(phi,sigma,delta,v) {
    const a=Math.log(sigma*sigma),p2=phi*phi,d2=delta*delta;
    const f=x=>{const ex=Math.exp(x);return ex*(d2-p2-v-ex)/(2*(p2+v+ex)**2)-(x-a)/(cfg.tau*cfg.tau);};
    let A=a,B;
    if(d2>p2+v)B=Math.log(d2-p2-v);
    else{let k=1;while(f(a-k*cfg.tau)<0){k++;if(k>1000)break;}B=a-k*cfg.tau;}
    let fA=f(A),fB=f(B),iterations=0;
    while(Math.abs(B-A)>cfg.epsilon&&iterations<200){
      const C=A+(A-B)*fA/(fB-fA),fC=f(C);
      if(fC*fB<=0){A=B;fA=fB;} else fA/=2;
      B=C;fB=fC;iterations++;
    }
    return Math.exp(A/2);
  }
  function update(s,games) {
    let vi=0,ds=0;
    for(const h of games){
      const gj=g(h.phi),e=1/(1+Math.exp(-gj*(s.mu-h.mu)));
      vi+=gj*gj*e*(1-e);
      ds+=gj*(h.score-e);
    }
    const v=1/vi,delta=v*ds,sigma=newVolatility(s.phi,s.sigma,delta,v);
    const star=Math.sqrt(s.phi*s.phi+sigma*sigma),phi=1/Math.sqrt(1/(star*star)+1/v);
    return {mu:s.mu+phi*phi*ds,phi,sigma};
  }
  const periods=new Map();
  for(const m of matches) {
    const p=periodOf(m.day);
    if(!periods.has(p))periods.set(p,[]);
    periods.get(p).push(m);
  }
  const players=new Map(),history=[];
  const stateAt=(key,p)=>{
    const old=players.get(key);
    if(!old)return {mu:(cfg.initialRating-1500)/scale,phi:cfg.initialRd/scale,sigma:cfg.initialVolatility};
    const empty=p-1-old.period;
    if(empty<=0)return old.state;
    return {...old.state,phi:Math.min(maxPhi,Math.sqrt(old.state.phi**2+empty*old.state.sigma**2))};
  };
  for(const p of [...periods.keys()].sort((a,b)=>a-b)){
    const pre=new Map(),games=new Map(),stats=new Map();
    const state=k=>{if(!pre.has(k))pre.set(k,stateAt(k,p));return pre.get(k);};
    for(const m of periods.get(p)){
      const w=state(m.w),l=state(m.l);
      const s=config.dominance.enabled?config.dominance.winnerScore[m.method]:1;
      for(const [k,x] of [[m.w,{mu:l.mu,phi:l.phi,score:s}],[m.l,{mu:w.mu,phi:w.phi,score:1-s}]]){
        if(!games.has(k))games.set(k,[]);
        games.get(k).push(x);
      }
      for(const [k,won] of [[m.w,true],[m.l,false]]){
        const z=stats.get(k)??{wins:0,losses:0,firstDay:m.day,lastDay:m.day};
        z.wins+=won?1:0;z.losses+=won?0:1;
        z.firstDay=Math.min(z.firstDay,m.day);z.lastDay=Math.max(z.lastDay,m.day);
        stats.set(k,z);
      }
    }
    for(const [k,gs] of games){
      const newState=update(state(k),gs),old=players.get(k),z=stats.get(k);
      const result={state:newState,period:p,games:(old?.games??0)+gs.length,wins:(old?.wins??0)+z.wins,losses:(old?.losses??0)+z.losses,firstDay:old?Math.min(old.firstDay,z.firstDay):z.firstDay,lastDay:old?Math.max(old.lastDay,z.lastDay):z.lastDay};
      players.set(k,result);
      history.push({athlete_key:k,period_end:iso((p+1)*config.period.days+4-1),rating:round(newState.mu*scale+1500,3),rating_deviation:round(newState.phi*scale,3),volatility:round(newState.sigma,6),match_count:result.games});
    }
  }
  const asOf=day(asOfDate),endPeriod=periodOf(asOf),current=new Map();
  for(const k of players.keys()){
    const state=stateAt(k,endPeriod);
    current.set(k,{rating:state.mu*scale+1500,rd:state.phi*scale,volatility:state.sigma});
  }
  let pool=[...current.values()].filter(p=>p.rd<config.uncertainty.provisionalRd).map(p=>p.rating).sort((a,b)=>a-b);
  if(pool.length<20)pool=[...current.values()].map(p=>p.rating).sort((a,b)=>a-b);
  const pos=(pool.length-1)*config.metrics.qualityPercentile;
  const threshold=pool[Math.floor(pos)]+(pool[Math.ceil(pos)]-pool[Math.floor(pos)])*(pos-Math.floor(pos));
  const empty=()=>({decision:0,major_decision:0,tech_fall:0,fall:0});
  const acc=new Map();
  const get=k=>{if(!acc.has(k))acc.set(k,{wm:empty(),lm:empty(),wMargins:[],lMargins:[],oppRatings:[],sosExpected:[],qw:0,ql:0});return acc.get(k);};
  const names=new Map();
  for(const m of matches){
    const w=names.get(m.w),l=names.get(m.l);
    names.set(m.w,{name:m.wn,team:m.wt||w?.team||""});
    names.set(m.l,{name:m.ln,team:m.lt||l?.team||""});
  }
  for(const m of matches){
    const w=get(m.w),l=get(m.l);
    w.wm[m.method]++;l.lm[m.method]++;
    if(m.margin!=null){w.wMargins.push(m.margin);l.lMargins.push(m.margin);}
    const wr=current.get(m.w).rating,lr=current.get(m.l).rating;
    w.oppRatings.push(lr);l.oppRatings.push(wr);
    w.sosExpected.push(1/(1+10**((lr-config.metrics.sosReferenceRating)/400)));
    l.sosExpected.push(1/(1+10**((wr-config.metrics.sosReferenceRating)/400)));
    if(lr>=threshold)w.qw++;
    if(wr>=threshold)l.ql++;
  }
  const trend=new Map();
  for(const h of history)if(day(h.period_end)<=asOf-config.metrics.trendDays)trend.set(h.athlete_key,h.rating);
  const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  const ratings=[];
  for(const [k,p] of players){
    const v=current.get(k),a=acc.get(k),name=names.get(k),fall=a.wm.fall,bonus=fall+a.wm.tech_fall+a.wm.major_decision,base=trend.get(k);
    const status=v.rd>=config.uncertainty.provisionalRd?"provisional":v.rd>=config.uncertainty.establishedRd?"developing":"established";
    ratings.push({
      athlete_key:k,athlete_name:name.name,team:name.team,
      rating:round(v.rating,3),rating_deviation:round(v.rd,3),volatility:round(v.volatility,6),
      conservative_score:round(v.rating-config.uncertainty.k*v.rd,3),rating_status:status,
      match_count:p.games,wins:p.wins,losses:p.losses,first_match_date:iso(p.firstDay),last_match_date:iso(p.lastDay),
      pin_pct:p.wins?round(fall/p.wins,5):null,bonus_pct:p.wins?round(bonus/p.wins,5):null,
      win_methods:a.wm,loss_methods:a.lm,avg_win_margin:round(mean(a.wMargins),2),avg_loss_margin:round(mean(a.lMargins),2),
      margin_samples:a.wMargins.length+a.lMargins.length,avg_opponent_rating:round(mean(a.oppRatings),2),
      sos_expected_win_pct:round(mean(a.sosExpected),5),quality_wins:a.qw,quality_losses:a.ql,
      rating_trend:base==null?null:round(v.rating-base,2)
    });
  }
  ratings.sort((a,b)=>b.conservative_score-a.conservative_score||a.athlete_key.localeCompare(b.athlete_key));
  return {ratings,history,report,qualityThreshold:round(threshold,2),firstMatchDate:matches[0]?.date??null,lastMatchDate:matches.at(-1)?.date??null};
})
