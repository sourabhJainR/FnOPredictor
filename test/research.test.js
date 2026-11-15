import test from "node:test";
import assert from "node:assert/strict";
import {snapshotFeatures,buildResearchSignals,resolveResearchSignals,researchLeaderboard,calibrateProbability,detectMarketEvents,scoreNewsItem} from "../lib/research.js";

function history(n=40){return Array.from({length:n},(_,i)=>({timestamp:new Date(Date.UTC(2026,0,1,0,i)).toISOString(),spot:80000+i*10,pcr:1+(i%4)*0.1,avgIv:14,callOi:1000,putOi:1100,callVolume:200,putVolume:250}));}
test("research strategies emit independent, explainable forecasts after warmup",()=>{const h=history();const signals=buildResearchSignals(h);assert.equal(signals.length,8);assert.ok(signals.every(x=>x.reason&&x.entrySpot>0&&x.horizon===5));});
test("walk-forward resolver waits for five future observations",()=>{const h=history(35),signals=buildResearchSignals(h);const first=signals[0];const result=resolveResearchSignals([first],h,[]);assert.equal(result.pending.length,1);const extended=[...h,...history(6).map((x,i)=>({...x,timestamp:new Date(Date.now()+i*60000).toISOString(),spot:80500+i*20}))];const done=resolveResearchSignals([first],extended,[]);assert.equal(done.resolved.length,1);});
test("leaderboard does not promote a strategy on a small sample",()=>{const result=researchLeaderboard([]);assert.equal(result.champion,"buy_hold");});
test("probability calibration requires a meaningful sample",()=>{assert.equal(calibrateProbability("momentum",.7,[]).calibrated,false);});
test("event detector flags large moves and positioning extremes",()=>{const h=history(2);h[1].spot=h[0].spot*1.01;h[1].pcr=1.7;assert.ok(detectMarketEvents(h).length>=2);});
test("news classification records topics and sentiment without asserting causality",()=>{const item=scoreNewsItem({title:"RBI rate cut lifts Sensex",summary:"India market gains",source:"test"});assert.ok(item.topics.includes("rbi"));assert.equal(item.sentiment,"positive");});
test("snapshot features derive PCR and volatility from option data",()=>{const f=snapshotFeatures({spot:100,options:[{type:"CE",oi:100,volume:10,iv:12},{type:"PE",oi:150,volume:20,iv:14}]});assert.equal(f.pcr,1.5);assert.equal(f.avgIv,13);});
