const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const stdev=a=>{const m=mean(a);return Math.sqrt(mean(a.map(x=>(x-m)**2)));};
const pct=(a,b)=>b?((a-b)/b)*100:0;

export function snapshotFeatures(chain, timestamp=chain.timestamp) {
  const calls=chain.options.filter(o=>o.type==="CE"), puts=chain.options.filter(o=>o.type==="PE");
  const sum=a=>a.reduce((s,o)=>s+Number(o.oi||0),0);
  const callOi=sum(calls), putOi=sum(puts), callVolume=calls.reduce((s,o)=>s+Number(o.volume||0),0), putVolume=puts.reduce((s,o)=>s+Number(o.volume||0),0);
  const ivs=chain.options.map(o=>Number(o.iv)).filter(Number.isFinite).filter(x=>x>0);
  return {timestamp,spot:Number(chain.spot),pcr:putOi/Math.max(1,callOi),callOi,putOi,callVolume,putVolume,avgIv:mean(ivs),expiry:chain.expiry||null};
}

function scoreDirection(direction,strength,reason) {
  const confidence=clamp(0.5+Math.abs(strength)*0.08,0.5,0.9);
  return {direction:Math.abs(strength)<0.12?"flat":direction,rawProbability:confidence, strength,reason};
}

export function buildResearchSignals(history) {
  if(history.length<21)return [];
  const p=history.map(x=>x.spot), last=p.at(-1), r5=pct(last,p.at(-6)), r20=pct(last,p.at(-21));
  const recent=p.slice(-20), z=(last-mean(recent))/Math.max(stdev(recent),1);
  const f=history.at(-1), prior=history.at(-6), pcrDelta=f.pcr-prior.pcr;
  const ivChange=f.avgIv-(history.at(-6)?.avgIv||f.avgIv);
  const models=[
    ["momentum",scoreDirection(r5>=0?"up":"down",Math.abs(r5)/Math.max(0.1,Math.abs(r20)+0.2),`5-snapshot return ${r5.toFixed(3)}%; 20-snapshot return ${r20.toFixed(3)}%`)],
    ["mean_reversion",scoreDirection(z>=0?"down":"up",Math.abs(z)/2,`20-snapshot price z-score ${z.toFixed(2)}`)],
    ["pcr_flow",scoreDirection(f.pcr>=1?"up":"down",Math.abs(f.pcr-1)+Math.abs(pcrDelta),`PCR ${f.pcr.toFixed(2)}; change ${pcrDelta.toFixed(2)}`)],
    ["volatility_breakout",scoreDirection(r5>=0?"up":"down",Math.abs(r5)*(1+Math.max(0,ivChange)/10),`Return ${r5.toFixed(3)}%; IV change ${ivChange.toFixed(2)}`)]
  ];
  return models.map(([strategy,s])=>({strategy,...s,entrySpot:last,createdAt:f.timestamp,horizon:5}));
}

export function resolveResearchSignals(signals, history, outcomes=[]) {
  const resolved=[...outcomes], pending=[];
  for(const signal of signals){
    const index=history.findIndex(x=>x.timestamp===signal.createdAt);
    if(index<0||index+signal.horizon>=history.length){pending.push(signal);continue;}
    const future=history[index+signal.horizon], move=pct(future.spot,signal.entrySpot);
    const actual=move>0.03?"up":move< -0.03?"down":"flat";
    const probability=signal.rawProbability;
    const success=signal.direction===actual||(signal.direction==="flat"&&actual==="flat");
    resolved.push({strategy:signal.strategy,createdAt:signal.createdAt,resolvedAt:future.timestamp,entrySpot:signal.entrySpot,exitSpot:future.spot,returnPct:move,direction:signal.direction,actual,probability,success,brier:(probability-(success?1:0))**2});
  }
  return {pending,resolved:resolved.slice(-10000)};
}

export function researchLeaderboard(outcomes, history=[]) {
  const names=["momentum","mean_reversion","pcr_flow","volatility_breakout"];
  const baseline=outcomes.filter(x=>x.strategy==="momentum");
  const metrics=(name)=>{
    const rows=outcomes.filter(x=>x.strategy===name);
    return {strategy:name,samples:rows.length,winRate:rows.length?rows.filter(x=>x.success).length/rows.length:null,
      averageReturnPct:rows.length?mean(rows.map(x=>x.returnPct)):null,brier:rows.length?mean(rows.map(x=>x.brier)):null,
      sessions:new Set(rows.map(x=>String(x.createdAt).slice(0,10))).size};
  };
  const base=metrics("momentum");
  const board=names.map(metrics);
  const eligible=board.filter(x=>x.strategy!=="momentum"&&x.samples>=50&&x.sessions>=15&&x.brier<base.brier&&x.averageReturnPct>base.averageReturnPct);
  eligible.sort((a,b)=>b.averageReturnPct-a.averageReturnPct||a.brier-b.brier);
  const champion=eligible[0]?.strategy||"momentum";
  return {leaderboard:board,champion,championStatus:champion==="momentum"?"No challenger has passed the promotion gate; momentum remains the research baseline.":"Research champion only; live paper strategy remains unchanged pending a separate validation period.",historyPoints:history.length};
}

export function calibrateProbability(strategy,rawProbability,outcomes) {
  const rows=outcomes.filter(x=>x.strategy===strategy&&x.probability!=null);
  if(rows.length<30)return {probability:rawProbability,calibrated:false,sampleSize:rows.length};
  const bucket=rows.filter(x=>Math.abs(x.probability-rawProbability)<=0.1);
  if(bucket.length<10)return {probability:rawProbability,calibrated:false,sampleSize:bucket.length};
  return {probability:clamp((bucket.filter(x=>x.success).length+2)/(bucket.length+4),0.05,0.95),calibrated:true,sampleSize:bucket.length};
}

export function detectMarketEvents(history) {
  if(history.length<2)return [];
  const current=history.at(-1), previous=history.at(-2), move=pct(current.spot,previous.spot);
  const events=[];
  if(Math.abs(move)>=0.5)events.push({type:"large_intraday_move",severity:Math.abs(move)>=1?"high":"medium",title:`SENSEX moved ${move.toFixed(2)}% between observations`,timestamp:current.timestamp,source:"market-data-derived",details:{movePct:move}});
  if(current.pcr>=1.5||current.pcr<=0.65)events.push({type:"options_positioning_extreme",severity:"medium",title:`Options PCR reached ${current.pcr.toFixed(2)}`,timestamp:current.timestamp,source:"market-data-derived",details:{pcr:current.pcr}});
  if(current.avgIv>=previous.avgIv*1.25&&current.avgIv-previous.avgIv>=2)events.push({type:"implied_volatility_surge",severity:"medium",title:`Average implied volatility rose to ${current.avgIv.toFixed(2)}`,timestamp:current.timestamp,source:"market-data-derived",details:{avgIv:current.avgIv}});
  return events;
}

export function scoreNewsItem(item) {
  const text=`${item.title||""} ${item.summary||""}`.toLowerCase();
  const topics={rbi:/\b(rbi|repo rate|monetary policy|reserve bank)\b/.test(text),inflation:/\b(inflation|cpi|wpi)\b/.test(text),rates:/\b(fed|federal reserve|rate hike|rate cut|bond yield)\b/.test(text),geopolitics:/\b(war|attack|sanction|geopolitical|conflict)\b/.test(text),earnings:/\b(earnings|results|profit|revenue|guidance)\b/.test(text),bse:/\b(sensex|bse|nifty|sebi|india market)\b/.test(text)};
  const positive=(text.match(/\b(gain|rise|surge|beat|growth|cut rates|record high|upgrade)\b/g)||[]).length;
  const negative=(text.match(/\b(fall|drop|crash|miss|loss|war|inflation|downgrade|selloff)\b/g)||[]).length;
  return {...item,topics:Object.keys(topics).filter(k=>topics[k]),sentiment:positive>negative?"positive":negative>positive?"negative":"mixed",relevance:Object.values(topics).some(Boolean)?"market-related":"general"};
}
