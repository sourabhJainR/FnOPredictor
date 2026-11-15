import test from "node:test";
import assert from "node:assert/strict";
import {advanceShadowTrades,openShadowTrades} from "../lib/research-runtime.js";

const signal={strategy:"rsi_14",direction:"up",createdAt:"2026-11-16T04:30:00.000Z",entrySpot:81000};
const candidate={expiry:"2026-11-17",long:{type:"CE",strike:81000},short:{type:"CE",strike:81100},debit:10,lotSize:10,quantity:1,risk:100};
test("shadow simulator opens one defined-risk option spread per strategy per day",()=>{
 const trades=openShadowTrades([signal],[],{timestamp:signal.createdAt,candidates:{call:candidate}});
 assert.equal(trades.length,1);assert.equal(trades[0].strategy,"rsi_14");assert.equal(trades[0].maxRisk,100);
 assert.equal(openShadowTrades([signal],trades,{timestamp:signal.createdAt,candidates:{call:candidate}}).length,1);
});
test("shadow simulator closes after five later snapshots using executable exit quotes",()=>{
 let trades=openShadowTrades([signal],[],{timestamp:signal.createdAt,candidates:{call:candidate}});
 for(let i=1;i<=5;i++)trades=advanceShadowTrades(trades,{timestamp:new Date(Date.parse(signal.createdAt)+i*15000).toISOString(),options:[{type:"CE",strike:81000,bid:13,ask:14},{type:"CE",strike:81100,bid:1,ask:1.5}]});
 assert.equal(trades[0].status,"closed");assert.equal(trades[0].realizedPnl,15);assert.equal(trades[0].paperReturnPct,15);
});
test("shadow simulator never fabricates P&L when exit quotes are unavailable",()=>{
 let trades=openShadowTrades([signal],[],{timestamp:signal.createdAt,candidates:{call:candidate}});
 for(let i=1;i<=20;i++)trades=advanceShadowTrades(trades,{timestamp:new Date(Date.parse(signal.createdAt)+i*15000).toISOString(),options:[]});
 assert.equal(trades[0].status,"unpriced");assert.equal(trades[0].realizedPnl,undefined);
});
