export function normalizeChain(raw, quote, mode = "live") {
  const sourceOptions = Array.isArray(raw?.options) ? raw.options : [];
  const options = sourceOptions.map((o) => ({
    strike: Number(o.strike), type: String(o.type || "").toUpperCase(),
    bid: Number(o.bid), ask: Number(o.ask), ltp: Number(o.ltp),
    oi: Number(o.oi || 0), volume: Number(o.volume || 0), iv: Number(o.iv || 0)
  })).filter((o) => Number.isFinite(o.strike) && ["CE", "PE"].includes(o.type)
    && Number.isFinite(o.bid) && o.bid > 0 && Number.isFinite(o.ask) && o.ask >= o.bid);
  const spot = Number(quote?.spot ?? quote?.ltp ?? quote?.lastPrice ?? raw?.spot);
  if (!Number.isFinite(spot) || spot <= 0 || options.length < 4) throw new Error("Provider chain requires a valid spot and at least four contracts with bid/ask quotes.");
  const timestamp = raw.timestamp || quote?.timestamp || new Date().toISOString();
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error("Provider timestamp is invalid.");
  const expiries = [...new Set([
    ...(Array.isArray(raw.expiries) ? raw.expiries : []),
    ...(raw.expiry ? [raw.expiry] : []),
    ...sourceOptions.map((o) => o.expiry).filter(Boolean)
  ])].map(String).filter((x) => Number.isFinite(Date.parse(x))).sort();
  return { spot, expiry: raw.expiry || "", expiryType: String(raw.expiryType || "").toLowerCase(), lotSize: Number(raw.lotSize) > 0 ? Number(raw.lotSize) : null,
    timestamp, source: raw.source || "Configured BSE data provider", expiries, options, mode };
}

export function nearestExpiry(chain, today = new Date()) {
  const day = new Date(today); day.setHours(0, 0, 0, 0);
  return chain.expiries.find((value) => new Date(value).setHours(0,0,0,0) >= day) || null;
}

function executable(o, side) {
  const price = side === "buy" ? o.ask : o.bid;
  return Number.isFinite(price) && price > 0 ? price : null;
}

function rawScore({ bull, spot, long, short, pcr }) {
  const directional = bull
    ? (spot > long.strike ? 0.82 : spot > short.strike ? 0.62 : 0.38)
    : (spot < long.strike ? 0.82 : spot < short.strike ? 0.62 : 0.38);
  const oi = bull ? Math.min(1, Math.max(0.2, pcr / 1.5))
    : Math.min(1, Math.max(0.2, 1.5 / Math.max(0.1, pcr)));
  const liquidity = Math.min(1, (long.volume + short.volume + Math.sqrt(long.oi * short.oi)) / 5000);
  const ivPenalty = Math.min(0.2, Math.max(0, ((long.iv + short.iv) / 2 - 18) / 100));
  return Math.round(Math.max(0, Math.min(100, 100 * (0.42 * directional + 0.28 * oi + 0.30 * liquidity - ivPenalty))));
}

export function buildSpreadCandidates(chain, lotSize, riskBudget, learning = {}) {
  const calls = chain.options.filter((o) => o.type === "CE");
  const puts = chain.options.filter((o) => o.type === "PE");
  const putOi = puts.reduce((sum, o) => sum + o.oi, 0);
  const callOi = calls.reduce((sum, o) => sum + o.oi, 0);
  const pcr = putOi / Math.max(1, callOi);
  const results = [];
  for (const [type, contracts, bull] of [["CE", calls, true], ["PE", puts, false]]) {
    for (const long of contracts) for (const short of contracts) {
      if (bull ? short.strike <= long.strike : short.strike >= long.strike) continue;
      const buy = executable(long, "buy"), sell = executable(short, "sell");
      const width = Math.abs(short.strike - long.strike), debit = buy - sell;
      if (!buy || !sell || width <= 0 || debit <= 0 || debit >= width) continue;
      const perUnitRisk = debit * lotSize;
      if (perUnitRisk > riskBudget) continue;
      const quantity = Math.floor(riskBudget / perUnitRisk);
      if (quantity < 1) continue;
      const risk = perUnitRisk * quantity;
      const reward = (width - debit) * lotSize * quantity;
      const baseScore = rawScore({ bull, spot: chain.spot, long, short, pcr });
      const key = bull ? "call" : "put";
      const stats = learning?.[key];
      const calibratedWinRate = stats?.count >= 20 ? (stats.wins + 2) / (stats.count + 4) : null;
      const calibrationAdjustment = calibratedWinRate === null ? 0 : Math.round((calibratedWinRate - 0.5) * 20);
      results.push({
        side: key, name: bull ? "Bull Call Debit Spread" : "Bear Put Debit Spread",
        bias: bull ? "Bullish" : "Bearish", long, short, buy, sell, debit, width,
        lotSize, quantity, risk, reward, breakeven: bull ? long.strike + debit : long.strike - debit,
        baseScore, score: Math.max(0, Math.min(100, baseScore + calibrationAdjustment)),
        calibratedWinRate, pcr, rr: reward / risk,
        entryCredit: sell - buy, expiry: chain.expiry
      });
    }
  }
  return {
    pcr,
    call: results.filter((x) => x.side === "call").sort((a,b) => b.score-a.score || b.rr-a.rr)[0] || null,
    put: results.filter((x) => x.side === "put").sort((a,b) => b.score-a.score || b.rr-a.rr)[0] || null
  };
}

export function markSpread(candidate, chain) {
  const longType = candidate.long?.type || candidate.longType;
  const shortType = candidate.short?.type || candidate.shortType;
  const longStrike = candidate.long?.strike ?? candidate.longStrike;
  const shortStrike = candidate.short?.strike ?? candidate.shortStrike;
  const long = chain.options.find((o) => o.type === longType && o.strike === longStrike);
  const short = chain.options.find((o) => o.type === shortType && o.strike === shortStrike);
  if (!long || !short || !(long.bid > 0) || !(short.ask > 0)) return null;
  return long.bid - short.ask;
}

export function evaluateExit(trade, chain, now = new Date()) {
  const credit = markSpread(trade, chain);
  if (!Number.isFinite(credit)) return { action: "hold", reason: "Exit quotes unavailable" };
  const pnl = (credit - trade.entryDebit) * trade.lotSize * trade.quantity;
  const target = trade.entryDebit * (1 + Number(trade.profitTargetPct ?? 25) / 100);
  const stop = trade.entryDebit * (1 - Number(trade.lossLimitPct ?? 30) / 100);
  const local = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const timeExit = local.getHours() > 15 || (local.getHours() === 15 && local.getMinutes() >= 20);
  if (credit >= target) return { action: "close", reason: `${Number(trade.profitTargetPct ?? 25)}% debit profit target reached`, credit, pnl };
  if (credit <= stop) return { action: "close", reason: `${Number(trade.lossLimitPct ?? 30)}% debit loss limit reached`, credit, pnl };
  if (timeExit) return { action: "close", reason: "15:20 IST time exit", credit, pnl };
  return { action: "hold", credit, pnl, target, stop };
}
