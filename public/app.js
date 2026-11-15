const $ = (id) => document.getElementById(id);
let snapshot = null;
let sourceMode = "none";
const fmt = (n, d=2) => Number.isFinite(Number(n)) ? Number(n).toLocaleString("en-IN",{minimumFractionDigits:d,maximumFractionDigits:d}) : "—";
const money = (n) => Number.isFinite(n) ? "₹"+fmt(n) : "—";
const validNum = (v) => Number.isFinite(Number(v)) && v !== null && v !== "";
function normalize(raw, mode="manual") {
  const options = Array.isArray(raw.options) ? raw.options : [];
  const clean = options.map(o => ({strike:Number(o.strike),type:String(o.type||"").toUpperCase(),bid:Number(o.bid),ask:Number(o.ask),ltp:Number(o.ltp),oi:Number(o.oi||0),volume:Number(o.volume||0),iv:Number(o.iv||0)}))
    .filter(o=>Number.isFinite(o.strike)&&["CE","PE"].includes(o.type)&&[o.bid,o.ask,o.ltp].some(v=>Number.isFinite(v)&&v>0));
  if (!validNum(raw.spot) || Number(raw.spot)<=0 || clean.length<4) throw new Error("Snapshot needs a positive spot price and at least four valid option contracts.");
  return {spot:Number(raw.spot),timestamp:raw.timestamp||new Date().toISOString(),source:raw.source||"Manual snapshot",expiry:raw.expiry||"",options:clean,mode};
}
function quote(o, side) {
  const v = side==="buy" ? o.ask : o.bid;
  if (Number.isFinite(v)&&v>0) return {price:v,indicative:false};
  if (Number.isFinite(o.ltp)&&o.ltp>0) return {price:o.ltp,indicative:true};
  return null;
}
function buildCandidates(data, lot, budget) {
  const calls=data.options.filter(o=>o.type==="CE"), puts=data.options.filter(o=>o.type==="PE");
  const strikes=[...new Set(data.options.map(o=>o.strike))].sort((a,b)=>a-b);
  const pcr= data.options.filter(o=>o.type==="PE").reduce((s,o)=>s+o.oi,0) / Math.max(1,data.options.filter(o=>o.type==="CE").reduce((s,o)=>s+o.oi,0));
  const liquidity=(a,b)=>Math.min(1,(a.volume+b.volume+Math.sqrt(a.oi*b.oi))/5000);
  const candidates=[];
  for (const [type,arr,bull] of [["CE",calls,true],["PE",puts,false]]) {
    for (const long of arr) for (const short of arr) {
      if (bull ? short.strike<=long.strike : short.strike>=long.strike) continue;
      const width=Math.abs(short.strike-long.strike);
      if (width<=0) continue;
      const buy=quote(long,"buy"), sell=quote(short,"sell");
      if (!buy||!sell) continue;
      const debit=buy.price-sell.price;
      if (debit<=0||debit>=width) continue;
      const maxProfit=(width-debit)*lot, maxLoss=debit*lot;
      if (maxLoss>budget) continue;
      const breakeven=bull?long.strike+debit:long.strike-debit;
      const directional = bull ? (data.spot>long.strike ? .8 : data.spot>short.strike ? .65 : .35) : (data.spot<long.strike ? .8 : data.spot<short.strike ? .65 : .35);
      const oiSignal = bull ? Math.min(1,Math.max(0.25,pcr/1.5)) : Math.min(1,Math.max(.25,1.5/Math.max(.1,pcr)));
      const liq=liquidity(long,short);
      const ivPenalty=Math.min(.25,Math.max(0,((long.iv+short.iv)/2-18)/100));
      const score=Math.round(Math.max(1,Math.min(95,100*(.42*directional+.28*oiSignal+.30*liq-ivPenalty))));
      const rr=maxProfit/maxLoss;
      candidates.push({name:bull?"Bull Call Spread":"Bear Put Spread",bias:bull?"Bullish":"Bearish",long,short,buy,sell,width,debit,maxProfit,maxLoss,breakeven,score,rr,indicative:buy.indicative||sell.indicative,lot,contracts:Math.floor(budget/maxLoss),reasons:[bull?"Call debit spread benefits from an upward move.":"Put debit spread benefits from a downward move.",`PCR ${fmt(pcr,2)}; liquidity score ${fmt(liq*100,0)}%.`,`Estimated max return on risk ${fmt(rr*100,1)}% before costs.`]});
    }
  }
  return {pcr,candidates:candidates.sort((a,b)=>b.score-a.score).slice(0,8)};
}
function render() {
  if (!snapshot) return;
  const lot=Math.max(1,Number($("lot").value)||1), budget=Math.max(1,Number($("budget").value)||1);
  const {pcr,candidates}=buildCandidates(snapshot,lot,budget);
  $("spot").textContent=money(snapshot.spot);
  $("pcr").textContent=fmt(pcr,2);
  $("quoteStamp").textContent=`Source: ${snapshot.source}`;
  $("chainStamp").textContent=new Date(snapshot.timestamp).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"});
  const age=Math.max(0,Date.now()-new Date(snapshot.timestamp).getTime());
  const stale=!Number.isFinite(age)||age>120000;
  $("freshness").textContent=stale?"Stale":age<30000?"Fresh":"Aging";
  $("bias").textContent=pcr>1.15?"Bullish":pcr<.85?"Bearish":"Neutral";
  $("biasDetail").textContent=`PCR-based context; not a standalone signal`;
  $("modelState").textContent=candidates.length?"Indicative model output":"No qualifying spreads";
  $("modelState").className="pill "+(candidates.length?"good":"muted");
  $("status").textContent=`${snapshot.mode==="live"?"Provider feed":"Manual/sample data"} · ${snapshot.source} · ${stale?"Snapshot older than 2 minutes":"Timestamp checked"} · ${snapshot.options.length} contracts`;
  $("status").className="notice";
  $("recommendations").innerHTML=candidates.length?candidates.map(c=>`<article class="panel strategy">
    <div class="strategy-top"><div><div class="direction">${c.bias} · ${c.name}</div><h3>${c.long.strike} / ${c.short.strike}</h3></div><div><div class="score">${c.score}%</div><div class="direction">Model score</div></div></div>
    <table class="legs"><thead><tr><th>Action</th><th>Contract</th><th>Reference price</th></tr></thead><tbody><tr><td>Buy ${c.long.type}</td><td>${c.long.strike}</td><td>${money(c.buy.price)}</td></tr><tr><td>Sell ${c.short.type}</td><td>${c.short.strike}</td><td>${money(c.sell.price)}</td></tr></tbody></table>
    <div class="stats"><div class="stat"><span>Max profit</span><strong>${money(c.maxProfit)}</strong></div><div class="stat"><span>Max loss</span><strong>${money(c.maxLoss)}</strong></div><div class="stat"><span>Breakeven</span><strong>${fmt(c.breakeven)}</strong></div><div class="stat"><span>Return / risk</span><strong>${fmt(c.rr*100,1)}%</strong></div><div class="stat"><span>Lot quantity</span><strong>${c.lot*c.contracts}</strong></div><div class="stat"><span>Entry debit</span><strong>${money(c.debit*c.lot)}</strong></div></div>
    <p class="explain">${c.reasons.join(" ")} ${c.indicative?"Indicative: one or more legs use LTP because bid/ask is missing.":""}</p>
  </article>`).join(""):`<div class="empty panel">No valid defined-risk debit spreads fit the selected risk budget and available quotes.</div>`;
}
async function refresh() {
  $("refresh").disabled=true;
  try {
    const symbol=$("symbol").value.trim().toUpperCase();
    const response=await fetch(`/api/market?symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent($("expiry").value)}`);
    const result=await response.json();
    if (result.quote.status==="ok"&&result.chain.status==="ok") {
      const q=result.quote.data, c=result.chain.data;
      const raw={...c,spot:q.spot??q.ltp??q.lastPrice,source:`${result.quote.source} + ${result.chain.source}`,timestamp:c.timestamp||q.timestamp||result.retrievedAt};
      snapshot=normalize(raw,"live"); sourceMode="live"; render(); $("connection").textContent="Provider connected"; $("connection").className="pill good"; return;
    }
    const why=[result.quote.message,result.chain.message].filter(Boolean).join(" ");
    $("status").textContent=`Live feed unavailable: ${why||"Provider not configured or returned an unsupported payload."} Load a snapshot or configure the JSON feed. No live recommendation is being generated.`;
    $("connection").textContent="No live feed"; $("connection").className="pill bad";
  } catch(e) {
    $("status").textContent=`Market refresh failed: ${e.message}`;
    $("connection").textContent="Feed error"; $("connection").className="pill bad";
  } finally { $("refresh").disabled=false; }
}
$("refresh").addEventListener("click",refresh);
$("lot").addEventListener("change",render); $("budget").addEventListener("change",render);
$("chainFile").addEventListener("change",async e=>{
  const file=e.target.files?.[0]; if(!file)return;
  try { snapshot=normalize(JSON.parse(await file.text()),"manual"); render(); $("connection").textContent="Manual snapshot"; $("connection").className="pill muted"; }
  catch(err){$("status").textContent=`Could not load snapshot: ${err.message}`;}
});
$("loadSample").addEventListener("click",()=>{
  const spot=80000, strikes=[79000,79500,80000,80500,81000], options=[];
  for(const k of strikes){const d=Math.abs(spot-k); options.push({strike:k,type:"CE",bid:Math.max(20,440-d*.38),ask:Math.max(25,450-d*.38),ltp:Math.max(22,445-d*.38),oi:9000+Math.round(Math.random()*8000),volume:1500,iv:16});options.push({strike:k,type:"PE",bid:Math.max(20,430-d*.38),ask:Math.max(25,440-d*.38),ltp:Math.max(22,435-d*.38),oi:9000+Math.round(Math.random()*8000),volume:1400,iv:17});}
  snapshot=normalize({spot,timestamp:new Date().toISOString(),source:"Synthetic sample (not market data)",options},"sample"); render(); $("connection").textContent="Sample data"; $("connection").className="pill muted"; $("status").textContent="Synthetic sample only. Do not use these values for trading.";
});
async function init(){
  try {const s=await (await fetch("/api/status")).json();const configured=s.providers.quote==="configured"&&s.providers.optionChain==="configured";$("connection").textContent=configured?"Feeds configured":"Feeds not configured";$("connection").className="pill "+(configured?"good":"muted");}
  catch{$("connection").textContent="Server unavailable";$("connection").className="pill bad";}
}
init();
