import { buildResearchSignals, resolveResearchSignals, researchLeaderboard, calibrateProbability, detectMarketEvents } from "./research.js";
import { fetchNewsFeeds } from "./news.js";

const now=()=>new Date().toISOString();
const uniq=(rows,key)=>{const seen=new Set();return rows.filter(x=>{const k=key(x);if(seen.has(k))return false;seen.add(k);return true;});};

export function advanceShadowTrades(trades,market){
  return trades.map(trade=>{
    if(trade.status!=="open"||trade.entryTimestamp===market.timestamp)return trade;
    const next={...trade,observations:(trade.observations||0)+1};
    if(next.observations<next.horizon)return next;
    const long=market.options?.find(o=>o.type===trade.longType&&o.strike===trade.longStrike);
    const short=market.options?.find(o=>o.type===trade.shortType&&o.strike===trade.shortStrike);
    if(long&&short&&Number(long.bid)>0&&Number(short.ask)>0&&Number(long.bid)>=Number(short.ask)){
      const credit=Number(long.bid)-Number(short.ask),pnl=(credit-trade.entryDebit)*trade.lotSize*trade.quantity;
      return {...next,status:"closed",closedAt:market.timestamp,exitCredit:credit,realizedPnl:pnl,paperReturnPct:trade.maxRisk?pnl/trade.maxRisk*100:0,exitReason:"Five-snapshot shadow paper exit"};
    }
    if(next.observations>=20)return {...next,status:"unpriced",closedAt:market.timestamp,exitReason:"Exit quotes unavailable after 20 observations; excluded from P&L"};
    return next;
  });
}
export function openShadowTrades(signals,trades,market){
  const date=String(market.timestamp).slice(0,10), additions=[];
  for(const signal of signals){
    if(signal.direction==="flat"||trades.some(t=>t.strategy===signal.strategy&&String(t.openedAt).slice(0,10)===date)||additions.some(t=>t.strategy===signal.strategy))continue;
    const candidate=market.candidates?.[signal.direction==="up"?"call":"put"];
    if(!candidate||!candidate.long||!candidate.short||!(candidate.debit>0)||!(candidate.risk>0))continue;
    additions.push({id:"shadow-"+signal.strategy+"-"+signal.createdAt,strategy:signal.strategy,direction:signal.direction,
      openedAt:market.timestamp,entryTimestamp:market.timestamp,entrySpot:signal.entrySpot,expiry:candidate.expiry,
      longType:candidate.long.type,longStrike:candidate.long.strike,shortType:candidate.short.type,shortStrike:candidate.short.strike,
      entryDebit:candidate.debit,lotSize:candidate.lotSize,quantity:candidate.quantity,maxRisk:candidate.risk,
      horizon:5,observations:0,status:"open"});
  }
  return [...trades,...additions].slice(-3000);
}


export function startResearchRuntime({app,store,env=process.env}){
  let stopped=false, busy=false;
  const feeds=String(env.NEWS_FEED_URLS||"").split(",").map(x=>x.trim()).filter(Boolean).slice(0,10);
  const processSnapshot=async()=>{
    if(stopped||busy)return;busy=true;
    try{
      const state=store.snapshot(), market=state.lastMarket, feature=market?.features;
      if(!feature||!feature.timestamp||state.researchHistory?.some(x=>x.timestamp===feature.timestamp))return;
      const history=[...(state.researchHistory||[]),feature].slice(-5000);
      const generated=buildResearchSignals(history);
      const contextTags=[...(state.newsItems||[]).filter(item=>Date.now()-Date.parse(item.ingestedAt||item.published||0)<24*60*60*1000).flatMap(item=>item.topics||[]),
        ...(state.marketEvents||[]).filter(event=>Date.now()-Date.parse(event.timestamp||0)<24*60*60*1000).map(event=>event.type)];
      const calibrated=generated.map(signal=>({...signal,contextTags:[...new Set(contextTags)],...calibrateProbability(signal.strategy,signal.rawProbability,state.researchOutcomes||[])}));
      const resolution=resolveResearchSignals(state.researchSignals||[],history,state.researchOutcomes||[]);
      const shadowAdvanced=advanceShadowTrades(state.shadowTrades||[],market);
      const shadowTrades=openShadowTrades(generated,shadowAdvanced,market);
      const events=detectMarketEvents(history).map(event=>({...event,id:`market-${event.type}-${String(event.timestamp).slice(0,10)}`}));
      await store.transact(s=>{
        s.researchHistory=history;
        s.researchSignals=[...(resolution.pending||[]),...calibrated].slice(-10000);
        s.researchOutcomes=resolution.resolved.slice(-10000);
        s.shadowTrades=shadowTrades;
        s.marketEvents=uniq([...(s.marketEvents||[]),...events],x=>x.id||`${x.type}-${x.timestamp}`).slice(-2000);
        s.researchUpdatedAt=now();
      });
    }catch(error){await store.transact(s=>{s.researchError=error.message;});}
    finally{busy=false;}
  };
  const pollNews=async()=>{
    if(stopped||!feeds.length)return;
    try{
      const items=await fetchNewsFeeds(feeds);
      if(!items.length)return;
      await store.transact(s=>{
        const known=new Set((s.newsItems||[]).map(x=>x.link||x.title));
        const fresh=items.filter(x=>!known.has(x.link||x.title)).map((x,i)=>({...x,id:`news-${Date.now()}-${i}`,ingestedAt:now()}));
        s.newsItems=[...(s.newsItems||[]),...fresh].slice(-2000);
        s.marketEvents=uniq([...(s.marketEvents||[]),...fresh.filter(x=>x.relevance==="market-related").map(x=>({id:x.id,type:"news",severity:x.topics?.some(t=>["rbi","rates","inflation","geopolitics"].includes(t))?"high":"medium",title:x.title,summary:x.summary,source:x.source,link:x.link,published:x.published,timestamp:x.ingestedAt,sentiment:x.sentiment,topics:x.topics}))],x=>x.id).slice(-2000);
      });
    }catch(error){await store.transact(s=>{s.newsError=error.message;});}
  };
  app.get("/api/research/state",(_req,res)=>{
    const s=store.snapshot(), report=researchLeaderboard(s.researchOutcomes||[],s.researchHistory||[],s.shadowTrades||[]);
    const recent=(s.researchSignals||[]).slice(-4).map(signal=>({...signal,...calibrateProbability(signal.strategy,signal.rawProbability,s.researchOutcomes||[])}));
    res.json({updatedAt:s.researchUpdatedAt||null,error:s.researchError||null,historyPoints:s.researchHistory?.length||0,
      pendingSignals:s.researchSignals?.length||0,resolvedOutcomes:s.researchOutcomes?.length||0,
      leaderboard:report.leaderboard,champion:report.champion,championStatus:report.championStatus,recentSignals:recent,
      events:(s.marketEvents||[]).slice(-30).reverse(),news:(s.newsItems||[]).slice(-30).reverse(),
      newsConfigured:feeds.length>0,newsError:s.newsError||null});
  });
  app.post("/api/research/events",(req,res)=>{
    const body=req.body||{},title=String(body.title||"").trim();
    if(!title||title.length>240)return res.status(400).json({error:"Event title is required and must be under 240 characters."});
    const event={id:`manual-${Date.now()}`,type:"manual",severity:["low","medium","high"].includes(body.severity)?body.severity:"medium",
      title,summary:String(body.summary||"").slice(0,2000),timestamp:body.timestamp&&Number.isFinite(Date.parse(body.timestamp))?new Date(body.timestamp).toISOString():now(),
      source:"user-entered",createdAt:now()};
    store.transact(s=>{s.marketEvents=[...(s.marketEvents||[]),event].slice(-2000);}).then(()=>res.status(201).json(event)).catch(()=>res.status(500).json({error:"Could not save event."}));
  });
  const snapshotTimer=setInterval(processSnapshot,3000);
  const newsTimer=setInterval(pollNews,5*60*1000);
  processSnapshot();pollNews();
  return {stop(){stopped=true;clearInterval(snapshotTimer);clearInterval(newsTimer);}};
}
