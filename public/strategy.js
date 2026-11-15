export function buildCandidates(data, lot, budget) {
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
