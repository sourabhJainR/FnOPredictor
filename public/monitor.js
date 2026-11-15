const $ = (id) => document.getElementById(id);
const money = (n) => n!==null&&n!==undefined&&n!==""&&Number.isFinite(Number(n)) ? "₹" + Number(n).toLocaleString("en-IN",{maximumFractionDigits:2}) : "—";
const number = (n,d=2) => n!==null&&n!==undefined&&n!==""&&Number.isFinite(Number(n)) ? Number(n).toLocaleString("en-IN",{maximumFractionDigits:d}) : "—";
let timer = null;
function pill(id, text, state="muted"){const el=$(id);el.textContent=text;el.className="pill "+state;}
function renderCandidate(id, c, label) {
  const root=$(id);
  if(!c){root.innerHTML='<div class="empty">No qualifying spread. Wait for fresh, liquid quotes.</div>';return;}
  root.innerHTML=`<div class="recommend-top"><div><span class="eyebrow">${label} · ${c.bias}</span><h3>Buy ${c.long.strike} / Sell ${c.short.strike} ${c.long.type}</h3></div><div class="score">${c.score}/100</div></div>
  <div class="legs-grid"><div><small>Buy at ask</small><strong>${money(c.buy)}</strong></div><div><small>Sell at bid</small><strong>${money(c.sell)}</strong></div><div><small>Net debit</small><strong>${money(c.debit)}</strong></div><div><small>Breakeven</small><strong>${number(c.breakeven)}</strong></div><div><small>Max risk</small><strong>${money(c.risk)}</strong></div><div><small>Max reward</small><strong>${money(c.reward)}</strong></div><div><small>Qty (lots)</small><strong>${c.quantity}</strong></div><div><small>Return / risk</small><strong>${number(c.rr*100,1)}%</strong></div></div>
  <p class="muted-copy">Expiry ${c.expiry||"not supplied"} · PCR ${number(c.pcr)} · ${c.calibratedWinRate===null?"Learning sample insufficient":`Observed win rate ${number(c.calibratedWinRate*100,1)}% (${c.side} sample)`}. Score is a ranking score, not a probability.</p>`;
}
function localDay(value){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));}
function renderState(s) {
  const m=s.monitor||{};
  pill("monitorState",m.enabled?"Monitoring on":"Monitoring stopped",m.enabled?"good":"muted");
  pill("providerState",m.providerStatus||"Waiting for provider",m.providerStatus==="connected"?"good":"bad");
  $("providerMessage").textContent=m.lastError||"";
  pill("powerState",m.power?.active?"Sleep prevention active":"Sleep prevention inactive",m.power?.active?"good":"muted");
  $("spot").textContent=money(m.spot);
  $("expiry").textContent=m.expiry||"Awaiting chain";
  $("lastUpdate").textContent=m.lastPoll?new Date(m.lastPoll).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"}):"Not started";
  $("sourceInfo").textContent=m.source?`Source: ${m.source} | Timestamp: ${m.timestampSource==="retrieved_at"?"local retrieval time":m.timestampSource==="exchange"?"exchange timestamp":"provider timestamp"}`:"Provider not connected";
  $("freshness").textContent=m.freshness||"No data";
  $("marketState").textContent=m.marketOpen?"Market session":"Outside market hours";
  renderCandidate("callCard",m.predictions?.call,"CALL BUY / SELL");
  renderCandidate("putCard",m.predictions?.put,"PUT BUY / SELL");
  $("capital").textContent=money(m.capital??10000);
  $("riskLimit").textContent=money(m.riskLimit??2000);
  $("targetRule").textContent="+"+(m.profitTargetPct??25)+"%";
  $("stopRule").textContent="-"+(m.lossLimitPct??30)+"%";
  const t=s.trades||[];
  const active=t.find(x=>x.status==="open");
  $("activeTrade").innerHTML=active?`<strong>${active.side.toUpperCase()} spread · ${active.longStrike}/${active.shortStrike}</strong><span>Entry debit ${money(active.entryDebit)} · Opened ${new Date(active.openedAt).toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata"})} IST · Unrealized P&amp;L ${money(active.unrealizedPnl)}</span>`:"No active paper position";
  const today=localDay(new Date());
  const closedToday=t.filter(x=>x.status==="closed"&&localDay(x.closedAt)===today);
  const pnl=closedToday.reduce((a,x)=>a+(x.realizedPnl||0),0);
  $("dailyPnl").textContent=money(pnl);
  $("tradeCount").textContent=String(closedToday.length);
  $("tradeRows").innerHTML=t.slice(-20).reverse().map(x=>`<tr><td>${new Date(x.openedAt).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})}</td><td>${x.side.toUpperCase()}</td><td>${x.longStrike}/${x.shortStrike}</td><td>${x.status}</td><td>${money(x.status==="open"?x.unrealizedPnl:x.realizedPnl)}</td><td>${x.exitReason||"—"}</td></tr>`).join("")||'<tr><td colspan="6">No paper trades recorded.</td></tr>';
  $("modelStats").textContent=`Predictions ${s.predictions?.length||0} · Call outcomes ${s.learning?.call?.count||0} · Put outcomes ${s.learning?.put?.count||0}`;
  $("reportLinks").innerHTML=(s.reports||[]).slice(-10).reverse().map(r=>`<a href="/reports/${encodeURIComponent(r.date)}.html" target="_blank">${r.date} report</a>`).join(" · ")||"Reports are created after the market close.";
}
async function refresh(){try{const r=await fetch("/api/monitor/state");if(!r.ok)throw new Error(await r.text());renderState(await r.json());}catch(e){pill("providerState","Server error","bad");}}
async function action(url){await fetch(url,{method:"POST"});await refresh();}
$("start").addEventListener("click",()=>action("/api/monitor/start"));
$("stop").addEventListener("click",()=>action("/api/monitor/stop"));
$("powerToggle").addEventListener("click",()=>action("/api/power/toggle"));
$("refreshNow").addEventListener("click",()=>action("/api/monitor/poll"));
$("reportNow").addEventListener("click",()=>action("/api/reports/generate"));
$("settings").addEventListener("submit",async e=>{e.preventDefault();await fetch("/api/monitor/settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({pollSeconds:Number($("pollSeconds").value),capital:Number($("capitalInput").value),riskLimit:Number($("riskInput").value),profitTargetPct:Number($("targetInput").value),lossLimitPct:Number($("stopInput").value),lotSize:Number($("lotSize").value)})});await refresh();});
refresh();timer=setInterval(refresh,5000);
window.addEventListener("beforeunload",()=>clearInterval(timer));
