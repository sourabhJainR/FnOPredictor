const DEFAULT_TIMEOUT_MS = 10000;

function validTimestamp(value) {
  return typeof value === "string" && /^\\d{4}-\\d{2}-\\d{2}T.*(?:Z|[+-]\\d{2}:\\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function normalizeOption(option) {
  const strike = Number(option.strike ?? option.strikePrice);
  const type = String(option.type ?? option.optionType ?? "").toUpperCase();
  const bid = Number(option.bid ?? option.bestBidPrice);
  const ask = Number(option.ask ?? option.bestAskPrice);
  const bidQty = Number(option.bidQty ?? option.bestBidQuantity ?? 0);
  const askQty = Number(option.askQty ?? option.bestAskQuantity ?? 0);
  const normalized = {
    strike, type, bid, ask,
    ltp: Number(option.ltp ?? option.lastTradedPrice),
    oi: Number(option.oi ?? option.openInterest ?? 0),
    volume: Number(option.volume ?? option.tradedVolume ?? 0),
    iv: Number(option.iv ?? option.impliedVolatility ?? 0),
    bidQty, askQty
  };
  if (!Number.isFinite(strike) || strike <= 0 || !["CE", "PE"].includes(type))
    throw new Error("BSE feed contains an option with an invalid strike or option type.");
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid || ask <= 0)
    throw new Error("BSE feed contains missing, zero or crossed best bid/ask quotes.");
  if (!Number.isFinite(normalized.ltp) || normalized.ltp < 0 ||
      !Number.isFinite(normalized.oi) || normalized.oi < 0 ||
      !Number.isFinite(normalized.volume) || normalized.volume < 0 ||
      !Number.isFinite(normalized.iv) || normalized.iv < 0)
    throw new Error("BSE feed contains invalid LTP, OI, volume or IV values.");
  return normalized;
}

/**
 * BSE Self Data Feed adapter.
 *
 * BSE provisions endpoint details and credentials after subscription. The configured
 * URL must be the exact HTTPS API endpoint supplied by BSE. The response must follow
 * the normalized contract documented in docs/DATA_PROVIDERS.md; no public-site XHR,
 * browser-cookie replay or undocumented endpoint discovery is performed here.
 */
export function normalizeBseSnapshot(payload, retrievedAt = new Date().toISOString()) {
  const data = payload?.data && !Array.isArray(payload.data) ? payload.data : payload;
  const spot = Number(data?.spot ?? data?.underlyingSpot);
  const timestamp = data?.timestamp ?? data?.exchangeTimestamp;
  const expiry = String(data?.expiry ?? "");
  const expiryType = String(data?.expiryType ?? "").toLowerCase();
  const weeklyExpiries = Array.isArray(data?.weeklyExpiries) ? data.weeklyExpiries.map(String) : [];
  const lotSize = Number(data?.lotSize);
  if (!Number.isFinite(spot) || spot <= 0) throw new Error("BSE feed did not provide a valid SENSEX spot value.");
  if (!validTimestamp(timestamp)) throw new Error("BSE feed must provide an exchange timestamp in ISO-8601 format.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || expiryType !== "weekly" || !weeklyExpiries.includes(expiry))
    throw new Error("BSE feed must identify the selected expiry as weekly and include it in weeklyExpiries.");
  if (!Number.isInteger(lotSize) || lotSize <= 0) throw new Error("BSE feed did not provide a valid SENSEX lot size.");
  if (!Array.isArray(data?.options) || data.options.length < 4)
    throw new Error("BSE feed returned fewer than four option contracts.");
  const options = data.options.map(normalizeOption);
  const unique = new Set(options.map(o => `${o.strike}:${o.type}`));
  if (unique.size !== options.length) throw new Error("BSE feed contains duplicate strike/type contracts.");
  const validTopOfBook = options.filter(o => o.bidQty > 0 && o.askQty > 0);
  if (validTopOfBook.length < 4)
    throw new Error("BSE feed returned fewer than four contracts with positive bid and ask quantities.");
  return {
    spot, timestamp, timestampSource: "exchange",
    source: String(data.source || "BSE Self Data Feed"),
    expiry, expiryType: "weekly", weeklyExpiries, lotSize, options,
    retrievedAt
  };
}

export async function fetchBseSensex({
  endpoint, accessToken, authHeader = "Authorization", authScheme = "Bearer", fetchImpl = fetch, now = new Date(), timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  if (!endpoint || !accessToken)
    throw new Error("Configure BSE_MARKET_DATA_URL and BSE_MARKET_DATA_TOKEN from an authorised BSE data-feed subscription.");
  if (!/^[A-Za-z0-9-]+$/.test(authHeader)) throw new Error("BSE_MARKET_DATA_AUTH_HEADER must be a valid HTTP header name.");
  let url;
  try { url = new URL(endpoint); } catch { throw new Error("BSE_MARKET_DATA_URL must be a valid HTTPS URL."); }
  if (url.protocol !== "https:") throw new Error("BSE market-data endpoint must use HTTPS.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        [authHeader]: authScheme ? `${authScheme} ${accessToken}` : accessToken,
        "User-Agent": "FnOPredictor/1.0"
      },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload?.message || payload?.error || `HTTP ${response.status}`;
      throw new Error(`BSE market-data request failed: ${detail}`);
    }
    if (!payload || typeof payload !== "object") throw new Error("BSE feed returned an invalid JSON response.");
    const retrievedAt = new Date(now).toISOString();
    const chain = normalizeBseSnapshot(payload, retrievedAt);
    return {
      quote: {
        spot: chain.spot, timestamp: chain.timestamp,
        source: chain.source, timestampSource: "exchange"
      },
      chain
    };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("BSE market-data request timed out.");
    const safeMessage = String(error.message || "BSE market-data request failed.").split(accessToken).join("[redacted]");
    throw new Error(safeMessage);
  } finally {
    clearTimeout(timeout);
  }
}
