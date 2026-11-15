import test from "node:test";
import assert from "node:assert/strict";

function payoff({ longStrike, shortStrike, debit, lot, spot, kind }) {
  const width=Math.abs(shortStrike-longStrike);
  const intrinsic=kind==="CE"
    ? Math.max(0,spot-longStrike)-Math.max(0,spot-shortStrike)
    : Math.max(0,longStrike-spot)-Math.max(0,shortStrike-spot);
  return (intrinsic-debit)*lot;
}
test("bull call spread caps upside at strike width less debit",()=>{
  const p={longStrike:100,shortStrike:110,debit:4,lot:25,kind:"CE"};
  assert.equal(payoff({...p,spot:100}),-100);
  assert.equal(payoff({...p,spot:110}),150);
  assert.equal(payoff({...p,spot:120}),150);
});
test("bear put spread caps upside at strike width less debit",()=>{
  const p={longStrike:110,shortStrike:100,debit:3,lot:10,kind:"PE"};
  assert.equal(payoff({...p,spot:110}),-30);
  assert.equal(payoff({...p,spot:100}),70);
  assert.equal(payoff({...p,spot:90}),70);
});

import { normalizeChain, buildSpreadCandidates, markSpread, evaluateExit } from "../lib/strategy.js";
import { createStore } from "../lib/store.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sampleChain = () => normalizeChain({
  spot: 100, lotSize: 20, timestamp: "2026-11-16T09:30:00+05:30",
  expiry: "2026-11-17", expiryType: "weekly", weeklyExpiries: ["2026-11-17"],
  options: [
    {strike:100,type:"CE",bid:9,ask:10,ltp:9.5,oi:5000,volume:500,iv:15},
    {strike:110,type:"CE",bid:4,ask:5,ltp:4.5,oi:4000,volume:400,iv:15},
    {strike:90,type:"PE",bid:4,ask:5,ltp:4.5,oi:4500,volume:450,iv:16},
    {strike:100,type:"PE",bid:9,ask:10,ltp:9.5,oi:5500,volume:550,iv:16}
  ]
}, {spot:100,timestamp:"2026-11-16T09:30:00+05:30"});

test("production strategy ranks both defined-risk debit spread sides",()=>{
  const chain=sampleChain();
  const result=buildSpreadCandidates(chain,20,2000);
  assert.ok(result.call);
  assert.ok(result.put);
  assert.equal(result.call.side,"call");
  assert.equal(result.put.side,"put");
  assert.ok(result.call.risk<=2000);
  assert.ok(result.put.risk<=2000);
  assert.ok(result.call.debit>0);
  assert.ok(result.put.debit>0);
});

test("production spread mark uses long bid less short ask",()=>{
  const chain=sampleChain();
  const candidate=buildSpreadCandidates(chain,20,2000).call;
  assert.equal(markSpread(candidate,chain),candidate.long.bid-candidate.short.ask);
});

test("exit engine books profit at configured debit return",()=>{
  const chain=sampleChain();
  const trade={side:"call",longStrike:100,shortStrike:110,longType:"CE",shortType:"CE",
    entryDebit:5,lotSize:20,quantity:1,profitTargetPct:25,lossLimitPct:30};
  const outcome=evaluateExit(trade,chain,new Date("2026-11-16T09:40:00+05:30"));
  assert.equal(outcome.action,"hold");
  const profitable={...chain,options:chain.options.map(o=>o.type==="CE"&&o.strike===100?{...o,bid:8}:o.type==="CE"&&o.strike===110?{...o,ask:1}:o)};
  const closed=evaluateExit(trade,profitable,new Date("2026-11-16T09:40:00+05:30"));
  assert.equal(closed.action,"close");
  assert.equal(closed.reason,"25% debit profit target reached");
});

test("exit engine applies time exit at 15:20 IST",()=>{
  const chain=sampleChain();
  const trade={side:"call",longStrike:100,shortStrike:110,longType:"CE",shortType:"CE",entryDebit:5,lotSize:20,quantity:1};
  const outcome=evaluateExit(trade,chain,new Date("2026-11-16T09:50:00+05:30"));
  assert.equal(outcome.action,"close");
  assert.equal(outcome.reason,"15:20 IST time exit");
});

test("persistent store serializes transactions and reloads state",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"fno-store-"));
  try{
    const file=path.join(dir,"state.json"), first=createStore(file);
    await first.init();
    await Promise.all([first.transact(s=>s.predictions.push({id:1})),first.transact(s=>s.trades.push({id:2}))]);
    const second=createStore(file); const state=await second.init();
    assert.equal(state.predictions.length,1);
    assert.equal(state.trades.length,1);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
