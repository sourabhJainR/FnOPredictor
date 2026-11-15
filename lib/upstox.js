const BASE = "https://api.upstox.com/v2";

function istDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
}

async function getJson(path, token, fetchImpl) {
  const response = await fetchImpl(`${BASE}${path}`, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    signal: AbortSignal.timeout(10000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.errors?.[0]?.message || body?.message || `HTTP ${response.status}`;
    throw new Error(`Upstox market-data request failed: ${message}`);
  }
  if (body.status && body.status !== "success") {
    throw new Error(body.message || "Upstox returned an unsuccessful market-data response.");
  }
  return body;
}

export function normalizeUpstoxChain(rows, contracts, retrievedAt = new Date().toISOString()) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Upstox returned an empty SENSEX option chain.");
  if (!Array.isArray(contracts) || contracts.length === 0) throw new Error("Upstox returned no current-week SENSEX option contracts.");

  const weekly = contracts.filter(c =>
    c.weekly === true && c.exchange === "BSE" && c.segment === "BSE_FO" &&
    c.underlying_key === "BSE_INDEX|SENSEX" && c.expiry
  );
  const today = istDate(new Date(retrievedAt));
  const expiry = [...new Set(weekly.map(c => c.expiry))]
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today)
    .sort()[0];
  if (!expiry) throw new Error("Upstox did not identify an unexpired weekly BSE SENSEX option expiry.");

  const selectedContracts = weekly.filter(c => c.expiry === expiry);
  const lotSizes = [...new Set(selectedContracts.map(c => Number(c.lot_size)).filter(n => Number.isInteger(n) && n > 0))];
  if (lotSizes.length !== 1) throw new Error("Upstox weekly SENSEX contracts have missing or inconsistent lot sizes.");
  const chainRows = rows.filter(r => r.expiry === expiry);
  if (!chainRows.length) throw new Error(`Upstox option chain did not return the selected weekly expiry ${expiry}.`);

  const options = [];
  let spot = null;
  for (const row of chainRows) {
    const strike = Number(row.strike_price);
    const rowSpot = Number(row.underlying_spot_price);
    if (!Number.isFinite(strike) || strike <= 0) continue;
    if (Number.isFinite(rowSpot) && rowSpot > 0) {
      if (spot === null) spot = rowSpot;
      else if (Math.abs(spot - rowSpot) > 1) throw new Error("Upstox chain contains inconsistent SENSEX spot values.");
    }
    for (const [type, leg] of [["CE", row.call_options], ["PE", row.put_options]]) {
      const market = leg?.market_data || {};
      const greeks = leg?.option_greeks || {};
      options.push({
        strike, type,
        bid: Number(market.bid_price),
        ask: Number(market.ask_price),
        ltp: Number(market.ltp),
        oi: Number(market.oi || 0),
        volume: Number(market.volume || 0),
        iv: Number(greeks.iv || 0),
        bidQty: Number(market.bid_qty || 0),
        askQty: Number(market.ask_qty || 0),
        instrumentKey: leg?.instrument_key || null
      });
    }
  }
  if (!Number.isFinite(spot) || spot <= 0) throw new Error("Upstox chain did not contain a valid SENSEX spot value.");
  const validQuotes = options.filter(o => o.bid > 0 && o.ask >= o.bid && o.ask > 0);
  if (validQuotes.length < 4) throw new Error("Upstox returned fewer than four contracts with valid bid/ask quotes.");

  return {
    spot, timestamp: retrievedAt, timestampSource: "retrieved_at",
    source: "Upstox API · BSE SENSEX",
    expiry, expiryType: "weekly", weeklyExpiries: [expiry],
    lotSize: lotSizes[0], options
  };
}

export async function fetchUpstoxSensex({ accessToken, instrumentKey = "BSE_INDEX|SENSEX", fetchImpl = fetch, now = new Date() }) {
  if (!accessToken) throw new Error("Set UPSTOX_ACCESS_TOKEN in .env to enable the free Upstox market-data API.");
  if (instrumentKey !== "BSE_INDEX|SENSEX") throw new Error("This provider adapter is restricted to BSE_INDEX|SENSEX.");

  const key = encodeURIComponent(instrumentKey);
  const [contractBody, chainBody] = await Promise.all([
    getJson(`/option/contract?instrument_key=${key}&expiry_date=current_week`, accessToken, fetchImpl),
    getJson(`/option/chain?instrument_key=${key}&expiry_date=current_week`, accessToken, fetchImpl)
  ]);
  const retrievedAt = new Date(now).toISOString();
  const chain = normalizeUpstoxChain(chainBody.data, contractBody.data, retrievedAt);
  return {
    quote: { spot: chain.spot, timestamp: retrievedAt, source: chain.source, timestampSource: "retrieved_at" },
    chain
  };
}
