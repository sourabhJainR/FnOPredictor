import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBseSnapshot, fetchBseSensex } from "../lib/bse.js";

const timestamp = "2026-11-16T10:05:00+05:30";
const payload = {
  spot: 81500.25, timestamp, source: "BSE Self Data Feed",
  lotSize: 20, expiry: "2026-11-17", expiryType: "weekly",
  weeklyExpiries: ["2026-11-17", "2026-11-24"],
  options: [
    { strike: 81500, type: "CE", bid: 180, ask: 182, ltp: 181, oi: 12000, volume: 800, iv: 15.2, bidQty: 20, askQty: 25 },
    { strike: 81500, type: "PE", bid: 175, ask: 177, ltp: 176, oi: 13000, volume: 900, iv: 15.5, bidQty: 30, askQty: 35 },
    { strike: 81600, type: "CE", bid: 130, ask: 132, ltp: 131, oi: 10000, volume: 700, iv: 15.1, bidQty: 18, askQty: 22 },
    { strike: 81600, type: "PE", bid: 225, ask: 227, ltp: 226, oi: 14000, volume: 950, iv: 15.8, bidQty: 28, askQty: 32 }
  ]
};

test("BSE adapter normalizes a weekly SENSEX chain and exchange timestamp", () => {
  const result = normalizeBseSnapshot(payload, "2026-11-16T04:35:01.000Z");
  assert.equal(result.spot, 81500.25);
  assert.equal(result.timestamp, timestamp);
  assert.equal(result.timestampSource, "exchange");
  assert.equal(result.expiry, "2026-11-17");
  assert.equal(result.expiryType, "weekly");
  assert.equal(result.lotSize, 20);
  assert.equal(result.options.length, 4);
  assert.equal(result.options[0].bid, 180);
  assert.equal(result.options[0].ask, 182);
});

test("BSE adapter accepts common exchange field aliases", () => {
  const alias = {
    underlyingSpot: 81500, exchangeTimestamp: timestamp, lotSize: 20,
    expiry: "2026-11-17", expiryType: "weekly", weeklyExpiries: ["2026-11-17"],
    options: payload.options.map(o => ({
      strikePrice: o.strike, optionType: o.type, bestBidPrice: o.bid,
      bestAskPrice: o.ask, lastTradedPrice: o.ltp, openInterest: o.oi,
      tradedVolume: o.volume, impliedVolatility: o.iv,
      bestBidQuantity: o.bidQty, bestAskQuantity: o.askQty
    }))
  };
  assert.equal(normalizeBseSnapshot(alias).options.length, 4);
});

test("BSE adapter rejects missing or stale-format exchange timestamps", () => {
  assert.throws(() => normalizeBseSnapshot({ ...payload, timestamp: undefined }), /exchange timestamp/);
  assert.throws(() => normalizeBseSnapshot({ ...payload, timestamp: "2026-11-16" }), /exchange timestamp/);
});

test("BSE adapter rejects non-weekly or unlisted expiry", () => {
  assert.throws(() => normalizeBseSnapshot({ ...payload, expiryType: "monthly" }), /weekly/);
  assert.throws(() => normalizeBseSnapshot({ ...payload, weeklyExpiries: [] }), /weekly/);
});

test("BSE adapter rejects invalid spot, lot size and crossed quotes", () => {
  assert.throws(() => normalizeBseSnapshot({ ...payload, spot: 0 }), /spot/);
  assert.throws(() => normalizeBseSnapshot({ ...payload, lotSize: 0 }), /lot size/);
  const crossed = { ...payload, options: payload.options.map((o, i) => i ? o : { ...o, bid: 190, ask: 180 }) };
  assert.throws(() => normalizeBseSnapshot(crossed), /crossed/);
});

test("BSE adapter requires executable top-of-book quantities", () => {
  const noDepth = { ...payload, options: payload.options.map(o => ({ ...o, bidQty: 0, askQty: 0 })) };
  assert.throws(() => normalizeBseSnapshot(noDepth), /positive bid and ask quantities/);
});

test("BSE fetcher sends bearer auth to the configured HTTPS endpoint", async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url: String(url), init };
    return { ok: true, status: 200, json: async () => payload };
  };
  const result = await fetchBseSensex({
    endpoint: "https://feed.example.test/sensex/options",
    accessToken: "test-token", fetchImpl,
    now: new Date("2026-11-16T04:35:01.000Z")
  });
  assert.equal(result.quote.spot, 81500.25);
  assert.equal(result.chain.source, "BSE Self Data Feed");
  assert.equal(request.init.headers.Authorization, "Bearer test-token");
  assert.equal(request.init.method, "GET");
});

test("BSE fetcher rejects missing credentials and non-HTTPS endpoints", async () => {
  await assert.rejects(() => fetchBseSensex({ endpoint: "", accessToken: "" }), /BSE_MARKET_DATA_URL/);
  await assert.rejects(() => fetchBseSensex({
    endpoint: "http://feed.example.test/data", accessToken: "token"
  }), /HTTPS/);
});

test("BSE fetcher reports HTTP errors without exposing the access token", async () => {
  const fetchImpl = async () => ({
    ok: false, status: 403, json: async () => ({ message: "Access denied" })
  });
  await assert.rejects(() => fetchBseSensex({
    endpoint: "https://feed.example.test/data", accessToken: "secret-token", fetchImpl
  }), /Access denied/);
});

test("BSE fetcher supports the authentication header issued by the exchange", async () => {
  let headers;
  const fetchImpl = async (_url, init) => {
    headers = init.headers;
    return { ok: true, status: 200, json: async () => payload };
  };
  await fetchBseSensex({
    endpoint: "https://feed.example.test/data",
    accessToken: "api-key", authHeader: "X-API-Key", authScheme: "",
    fetchImpl
  });
  assert.equal(headers["X-API-Key"], "api-key");
  assert.equal(headers.Authorization, undefined);
});

test("BSE fetcher redacts credentials echoed by an upstream error", async () => {
  const fetchImpl = async () => ({
    ok: false, status: 401, json: async () => ({ message: "Rejected secret-token" })
  });
  await assert.rejects(() => fetchBseSensex({
    endpoint: "https://feed.example.test/data", accessToken: "secret-token", fetchImpl
  }), error => error.message === "BSE market-data request failed: Rejected [redacted]");
});
