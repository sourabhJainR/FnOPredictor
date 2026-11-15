import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUpstoxChain, fetchUpstoxSensex } from "../lib/upstox.js";

const expiry = "2026-11-17";
const contracts = [
  { exchange: "BSE", segment: "BSE_FO", underlying_key: "BSE_INDEX|SENSEX", expiry, weekly: true, lot_size: 20, instrument_type: "CE" },
  { exchange: "BSE", segment: "BSE_FO", underlying_key: "BSE_INDEX|SENSEX", expiry, weekly: true, lot_size: 20, instrument_type: "PE" },
  { exchange: "BSE", segment: "BSE_FO", underlying_key: "BSE_INDEX|SENSEX", expiry: "2026-11-24", weekly: true, lot_size: 20, instrument_type: "CE" }
];
const rows = [
  { expiry, strike_price: 81500, underlying_spot_price: 81520, call_options: { instrument_key: "BSE_FO|1", market_data: { bid_price: 100, ask_price: 102, ltp: 101, oi: 1000, volume: 500, bid_qty: 20, ask_qty: 30 }, option_greeks: { iv: 14 } }, put_options: { instrument_key: "BSE_FO|2", market_data: { bid_price: 95, ask_price: 97, ltp: 96, oi: 1200, volume: 600, bid_qty: 25, ask_qty: 35 }, option_greeks: { iv: 15 } } },
  { expiry, strike_price: 81600, underlying_spot_price: 81520, call_options: { market_data: { bid_price: 60, ask_price: 62, ltp: 61, oi: 800, volume: 400, bid_qty: 20, ask_qty: 20 } }, put_options: { market_data: { bid_price: 135, ask_price: 137, ltp: 136, oi: 900, volume: 450, bid_qty: 30, ask_qty: 30 } } }
];

test("Upstox adapter normalizes SENSEX weekly chain and executable quotes", () => {
  const chain = normalizeUpstoxChain(rows, contracts, "2026-11-16T04:30:00.000Z");
  assert.equal(chain.spot, 81520);
  assert.equal(chain.expiry, expiry);
  assert.equal(chain.expiryType, "weekly");
  assert.equal(chain.lotSize, 20);
  assert.equal(chain.timestampSource, "retrieved_at");
  assert.equal(chain.options.length, 4);
  assert.equal(chain.options[0].bid, 100);
  assert.equal(chain.options[0].ask, 102);
  assert.equal(chain.options[0].iv, 14);
});

test("Upstox adapter rejects monthly-only or unverified contracts", () => {
  assert.throws(
    () => normalizeUpstoxChain(rows, contracts.map(c => ({ ...c, weekly: false })), "2026-11-16T04:30:00.000Z"),
    /weekly BSE SENSEX option expiry/
  );
});

test("Upstox adapter rejects mixed lot sizes", () => {
  const mixed = contracts.map((c, i) => ({ ...c, lot_size: i === 0 ? 20 : 30 }));
  assert.throws(
    () => normalizeUpstoxChain(rows, mixed, "2026-11-16T04:30:00.000Z"),
    /inconsistent lot sizes/
  );
});

test("Upstox fetcher requests weekly BSE chain with bearer auth", async () => {
  const calls = [];
  const responses = [
    { status: "success", data: contracts },
    { status: "success", data: rows }
  ];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const body = responses.shift();
    return { ok: true, status: 200, json: async () => body };
  };
  const snapshot = await fetchUpstoxSensex({
    accessToken: "test-token",
    fetchImpl,
    now: new Date("2026-11-16T04:30:00.000Z")
  });
  assert.equal(snapshot.chain.expiry, expiry);
  assert.equal(snapshot.quote.spot, 81520);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.url.includes("BSE_INDEX%7CSENSEX") && c.url.includes("expiry_date=current_week")));
  assert.ok(calls.every(c => c.init.headers.Authorization === "Bearer test-token"));
});

test("Upstox fetcher requires a configured token", async () => {
  await assert.rejects(() => fetchUpstoxSensex({ accessToken: "" }), /UPSTOX_ACCESS_TOKEN/);
});

test("Upstox adapter rejects empty top-of-book quantities", () => {
  const noDepth = rows.map(row => ({
    ...row,
    call_options: { ...row.call_options, market_data: { ...row.call_options.market_data, bid_qty: 0, ask_qty: 0 } },
    put_options: { ...row.put_options, market_data: { ...row.put_options.market_data, bid_qty: 0, ask_qty: 0 } }
  }));
  assert.throws(
    () => normalizeUpstoxChain(noDepth, contracts, "2026-11-16T04:30:00.000Z"),
    /fewer than four contracts with valid bid\/ask quotes/
  );
});
