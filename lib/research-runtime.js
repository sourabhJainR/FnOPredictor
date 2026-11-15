import { buildResearchSignals, resolveResearchSignals, researchLeaderboard, calibrateProbability, detectMarketEvents } from "./research.js";
import { fetchNewsFeeds } from "./news.js";

const now=()=>new Date().toISOString();
const uniq=(rows,key)=>{const seen=new Set();return rows.filter(x=>{const k=key(x);if(seen.has(k))return false;seen.add(k);return true;});};

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
      const calibrated=generated.map(signal=>({...signal,...calibrateProbability(signal.strategy,signal.rawProbability,state.researchOutcomes||{})}));
      const resolution=resolveResearchSignals(state.researchSignals||[],history,state.researchOutcomes||[]);
      const events=detectMarketEvents(history).map(event=>({...event,id:`market-${event.type}-${event.timestamp}`}));
      await store.transact(s=>{
        s.researchHistory=history;
        s.researchSignals=[...(resolution.pending||[]),...calibrated].slice(-10000);
        s.researchOutcomes=resolution.resolved.slice(-10000);
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
    const s=store.snapshot(), report=researchLeaderboard(s.researchOutcomes||[],s.researchHistory||[]);
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
