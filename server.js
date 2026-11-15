import express from "express";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./lib/store.js";
import { normalizeChain, nearestExpiry, buildSpreadCandidates, evaluateExit } from "./lib/strategy.js";
import { powerStatus, setPowerInhibit, releasePowerInhibit } from "./lib/power.js";

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const ttlMs = Math.max(5_000, Number(process.env.CACHE_TTL_MS || 15_000));
const pollDefault = Math.max(10, Number(process.env.POLL_SECONDS || 15));
const store = createStore(path.join(root, "data", "state.json"));
const sources = { quote: process.env.BSE_QUOTE_JSON_URL, chain: process.env.BSE_OPTION_CHAIN_JSON_URL };
const settings = {
  pollSeconds: pollDefault, capital: Number(process.env.CAPITAL_INR || 10000),
  riskLimit: Math.min(2000, Number(process.env.RISK_LIMIT_INR || 2000)),
  profitTargetPct: 25, lossLimitPct: 30, lotSize: Number(process.env.SENSEX_LOT_SIZE || 20)
};
let enabled = true, pollTimer = null, busy = false, providerStatus = "not-configured", lastError = "";
const cache = new Map();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(root, "public"), { maxAge: "1h" }));

function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year:"numeric", month:"2-digit", day:"2-digit", weekday:"short", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(date);
  return Object.fromEntries(parts.map(p => [p.type,p.value]));
}
function marketIsOpen(date = new Date()) {
  const p = localParts(date), day = p.weekday;
  const minute = Number(p.hour) * 60 + Number(p.minute);
  return !["Sat","Sun"].includes(day) && minute >= 555 && minute < 930;
}
function dateKey(date = new Date()) { const p=localParts(date); return `${p.year}-${p.month}-${p.day}`; }
function validIso(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
async function fetchJson(kind, params = {}) {
  const template = sources[kind];
  if (!template) return { status:"unconfigured", message:"No approved provider endpoint configured." };
  const url = new URL(template);
  if (url.protocol !== "https:") throw new Error("Provider endpoints must use HTTPS.");
  for (const [key,value] of Object.entries(params)) if (value !== undefined && value !== null) url.searchParams.set(key,String(value));
  const key=url.toString(), now=Date.now(), cached=cache.get(key);
  if(cached && now-cached.at<ttlMs) return {...cached.value,cacheAgeMs:now-cached.at};
  const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),8000);
  try {
    const response=await fetch(url,{headers:{accept:"application/json","user-agent":"FnOPredictor/0.2 (personal research tool)"},signal:controller.signal});
    if(!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
    const data=await response.json();
    const value={status:"ok",source:url.origin,retrievedAt:new Date().toISOString(),data};
    cache.set(key,{at:now,value}); return value;
  } catch(error) { return {status:"error",message:error.name==="AbortError"?"Provider timed out.":error.message}; }
  finally { clearTimeout(timeout); }
}
function learningStats(state) {
  const result={call:{count:0,wins:0},put:{count:0,wins:0}};
  for(const trade of state.trades.filter(t=>t.status==="closed")) {
    const s=result[trade.side]; if(!s) continue;
    s.count++; if(Number(trade.realizedPnl)>0)s.wins++;
  }
  return result;
}
function makeReportHtml(date,state) {
  const esc=(v)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const localDay=(value)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));
  const trades=state.trades.filter(t=>(t.openedAt&&localDay(t.openedAt)===date)||(t.closedAt&&localDay(t.closedAt)===date));
  const predictions=state.predictions.filter(p=>p.timestamp&&localDay(p.timestamp)===date);
  const pnl=trades.filter(t=>t.status==="closed").reduce((s,t)=>s+Number(t.realizedPnl||0),0);
  const rows=trades.map(t=>`<tr><td>${esc(t.side)}</td><td>${esc(t.longStrike)} / ${esc(t.shortStrike)}</td><td>${esc(t.status)}</td><td>₹${Number(t.realizedPnl||0).toFixed(2)}</td><td>${esc(t.exitReason||"Open / not exited")}</td></tr>`).join("");
  const signals=predictions.slice(-100).map(p=>`<tr><td>${esc(new Date(p.timestamp).toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata"}))}</td><td>${esc(p.expiry)}</td><td>${esc(p.call? p.call.long.strike+"/"+p.call.short.strike:"No call spread")}</td><td>${esc(p.put? p.put.long.strike+"/"+p.put.short.strike:"No put spread")}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>FnOPredictor report ${date}</title><style>body{font:15px/1.5 system-ui;max-width:1100px;margin:36px auto;padding:0 18px;color:#172033}h1{margin-bottom:4px}.muted{color:#667085}.metric{display:inline-block;padding:14px 20px;margin:12px 12px 12px 0;background:#f2f5fa;border-radius:8px}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{text-align:left;padding:9px;border-bottom:1px solid #ddd}small{color:#667085}</style><h1>FnOPredictor daily report</h1><p class="muted">BSE SENSEX · ${date} · Paper-trading results only</p><div class="metric"><small>Realized paper P&amp;L</small><h2>₹${pnl.toFixed(2)}</h2></div><div class="metric"><small>Closed paper trades</small><h2>${trades.filter(t=>t.status==="closed").length}</h2></div><div class="metric"><small>Recorded predictions</small><h2>${predictions.length}</h2></div><h2>Trade ledger</h2><table><thead><tr><th>Side</th><th>Spread</th><th>Status</th><th>Realized P&amp;L</th><th>Exit reason</th></tr></thead><tbody>${rows||"<tr><td colspan='5'>No paper trades today.</td></tr>"}</tbody></table><h2>Prediction observations</h2><table><thead><tr><th>Time IST</th><th>Expiry</th><th>Call pair</th><th>Put pair</th></tr></thead><tbody>${signals||"<tr><td colspan='4'>No fresh predictions recorded.</td></tr>"}</tbody></table><p class="muted"><small>Signals are model outputs, not guaranteed outcomes. Paper fills use quoted bid/ask and exclude brokerage, taxes, market impact and partial fills. This report is not a contract note.</small></p></html>`;
}
async function generateReport(date=dateKey()) {
  const state=store.snapshot(), dir=path.join(root,"reports");
  await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,`${date}.html`),makeReportHtml(date,state),"utf8");
  await store.transact(s=>{if(!s.reports.some(r=>r.date===date))s.reports.push({date,createdAt:new Date().toISOString()});s.reports=s.reports.slice(-90);});
  return date;
}
async function closeTrade(trade,result,chain) {
  const closedAt=new Date().toISOString();
  await store.transact(s=>{
    const current=s.trades.find(t=>t.id===trade.id);
    if(!current||current.status!=="open")return;
    current.status="closed";current.closedAt=closedAt;current.exitCredit=result.credit;
    current.realizedPnl=result.pnl;current.exitReason=result.reason;
    current.exitSpot=chain.spot;current.exitTimestamp=chain.timestamp;
  });
}
async function pollOnce() {
  if(!enabled||busy)return;
  busy=true;
  try {
    if(!marketIsOpen()) {
      providerStatus="outside-market-hours";
      const p=localParts();
      if(Number(p.hour)>15 || (Number(p.hour)===15&&Number(p.minute)>=35)) {
        const today=dateKey(); if(!store.snapshot().reports.some(r=>r.date===today)) await generateReport(today);
      }
      return;
    }
    const [quote,chainResult]=await Promise.all([
      fetchJson("quote",{symbol:"SENSEX"}),
      fetchJson("chain",{symbol:"SENSEX",expiry:"nearest-weekly"})
    ]);
    if(quote.status!=="ok"||chainResult.status!=="ok") {
      providerStatus=quote.status==="unconfigured"||chainResult.status==="unconfigured"?"not-configured":"error";
      lastError=[quote.message,chainResult.message].filter(Boolean).join(" ");
      return;
    }
    const chain=normalizeChain(chainResult.data,quote.data,"live");
    const weekly=Array.isArray(chainResult.data.weeklyExpiries)?chainResult.data.weeklyExpiries:[];
    const todayKey=dateKey();
    const selected=weekly.map(String).filter(validIso).sort().find(x=>x.slice(0,10)>=todayKey);
    if(!selected||String(chainResult.data.expiry||"")!==selected||String(chainResult.data.expiryType||"").toLowerCase()!=="weekly") {
      providerStatus="invalid-expiry";
      lastError="Provider must return the nearest weekly expiry, weeklyExpiries and expiryType=weekly. Recommendations suppressed.";
      return;
    }
    chain.expiry=selected;
    const lot=chain.lotSize||settings.lotSize;
    if(!lot||lot<=0)throw new Error("SENSEX lot size missing; configure it from current contract specifications.");
    const state=store.snapshot(), learning=learningStats(state);
    const effectiveRisk=Math.min(settings.riskLimit,settings.capital);
    const candidates=buildSpreadCandidates(chain,lot,effectiveRisk,learning);
    const timestamp=chain.timestamp;
    if(state.lastSnapshotTimestamp!==timestamp) {
      await store.transact(s=>{
        s.lastSnapshotTimestamp=timestamp;
        s.predictions.push({timestamp,expiry:selected,spot:chain.spot,pcr:candidates.pcr,call:candidates.call,put:candidates.put});
        s.predictions=s.predictions.slice(-5000);
      });
    }
    const fresh=Date.now()-Date.parse(timestamp)<=120000;
    if(!fresh)throw new Error("Provider snapshot is older than two minutes; no signal or trade update.");
    const active=store.snapshot().trades.find(t=>t.status==="open");
    if(active) {
      const outcome=evaluateExit(active,chain,new Date());
      if(outcome.action==="close") await closeTrade(active,outcome,chain);
    } else {
      const today=dateKey(), latest=store.snapshot();
      if(latest.lastTradeDate!==today) {
        const best=[candidates.call,candidates.put].filter(Boolean).sort((a,b)=>b.score-a.score)[0];
        if(best&&best.score>=60) {
          const trade={id:`paper-${Date.now()}`,side:best.side,longStrike:best.long.strike,shortStrike:best.short.strike,
            longType:best.long.type,shortType:best.short.type,entryDebit:best.debit,lotSize:lot,quantity:best.quantity,
            maxLoss:best.risk,openedAt:new Date().toISOString(),entrySpot:chain.spot,expiry:selected,
            profitTargetPct:settings.profitTargetPct,lossLimitPct:settings.lossLimitPct,status:"open"};
          await store.transact(s=>{s.trades.push(trade);s.lastTradeDate=today;s.trades=s.trades.slice(-2000);});
        }
      }
    }
    providerStatus="connected";lastError="";
    await store.transact(s=>{s.lastMarket={spot:chain.spot,timestamp,expiry:selected,source:chain.source};});
  } catch(error) { providerStatus="error";lastError=error.message; }
  finally { busy=false; }
}
function schedulePoll() { if(pollTimer)clearInterval(pollTimer);pollTimer=setInterval(pollOnce,settings.pollSeconds*1000); }
function stateResponse() {
  const state=store.snapshot(), last=state.lastMarket;
  const age=last?Date.now()-Date.parse(last.timestamp):Infinity;
  return {...state,learning:learningStats(state),monitor:{enabled,providerStatus,lastError,lastPoll:last?.timestamp||null,
    spot:last?.spot||null,expiry:last?.expiry||null,freshness:age<=30000?"Fresh":age<=120000?"Aging":last?"Stale":"No data",
    marketOpen:marketIsOpen(),capital:settings.capital,riskLimit:settings.riskLimit,profitTargetPct:settings.profitTargetPct,
    lossLimitPct:settings.lossLimitPct,power:powerStatus(),predictions:state.predictions.slice(-1)[0]||null}};
}

app.get("/api/monitor/state",(_req,res)=>res.json(stateResponse()));
app.post("/api/monitor/start",(_req,res)=>{enabled=true;schedulePoll();pollOnce();res.json({enabled});});
app.post("/api/monitor/stop",(_req,res)=>{enabled=false;if(pollTimer)clearInterval(pollTimer);res.json({enabled});});
app.post("/api/monitor/poll",async(_req,res)=>{await pollOnce();res.json(stateResponse());});
app.post("/api/monitor/settings", (req,res)=>{
  const b=req.body||{};
  settings.pollSeconds=Math.max(10,Math.min(60,Number(b.pollSeconds)||15));
  settings.capital=Math.max(1000,Math.min(100000,Number(b.capital)||10000));
  settings.riskLimit=Math.max(100,Math.min(2000,settings.capital,Number(b.riskLimit)||2000));
  settings.profitTargetPct=Math.max(5,Math.min(100,Number(b.profitTargetPct)||25));
  settings.lossLimitPct=Math.max(5,Math.min(60,Number(b.lossLimitPct)||30));
  settings.lotSize=Math.max(1,Math.min(1000,Number(b.lotSize)||20));
  schedulePoll();res.json({settings});
});
app.post("/api/power/toggle",(_req,res)=>res.json(setPowerInhibit(!powerStatus().active)));
app.post("/api/reports/generate",async(_req,res)=>{const date=await generateReport();res.json({date,url:`/reports/${date}.html`});});
app.get("/reports/:date.html",async(req,res)=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date))return res.status(400).send("Invalid report date.");
  try{res.type("html").send(await readFile(path.join(root,"reports",`${req.params.date}.html`),"utf8"));}
  catch{return res.status(404).send("Report not generated yet.");}
});
app.get("/api/status",(_req,res)=>res.json({app:"FnOPredictor",providers:{quote:sources.quote?"configured":"not-configured",optionChain:sources.chain?"configured":"not-configured"},monitoring:enabled,pollSeconds:settings.pollSeconds,power:powerStatus(),timezone:"Asia/Kolkata"}));
app.use(async(_req,res)=>{try{res.type("html").send(await readFile(path.join(root,"public","index.html")));}catch{res.status(404).send("Application assets not found.");}});

await store.init();
setPowerInhibit(true);
schedulePoll();
pollOnce();
const server=app.listen(port,()=>console.log(`FnOPredictor monitoring at http://localhost:${port}`));
function shutdown(){if(pollTimer)clearInterval(pollTimer);releasePowerInhibit();server.close(()=>process.exit(0));}
process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);
