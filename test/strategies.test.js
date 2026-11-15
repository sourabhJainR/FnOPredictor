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
