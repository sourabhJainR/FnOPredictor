# Market data provider

## Primary provider: BSE Self Data Feed

FnOPredictor now uses BSE as its only market-data provider. Upstox integration and the undocumented BSE public-page XHR fallback are not used.

BSE's official market-data portal lists Equity Derivatives API data and describes registration, KYC, data-plan selection, agreement and payment steps. It also advertises limited trial access for selected feeds. BSE must provide the endpoint, authentication method, message/response specification and the permitted usage category for the user's account before live integration can be activated.

Official entry points:
- BSE Self Data Feed: https://marketdata.bseindia.com/
- BSE public SENSEX option-chain page: https://www.bseindia.com/markets/Derivatives/DeriReports/DeriOptionchain.html
- SEBI's curated BSE options-chain link: https://www.sebi.gov.in/curation/equity_derivatives.html

The public option-chain webpage is for viewing market data. Its browser XHR calls are not treated as a supported or licensed API. The application does not replay browser cookies, mimic browser sessions, scrape the page, or bypass access controls.

## Configure the authorised feed

After BSE approves the subscription and provides API access, copy `.env.example` to `.env` and set the exact HTTPS endpoint and token issued for the subscription:

```dotenv
BSE_MARKET_DATA_URL=https://the-exact-endpoint-provided-by-bse
BSE_MARKET_DATA_TOKEN=the-token-provided-by-bse
BSE_MARKET_DATA_AUTH_HEADER=Authorization
BSE_MARKET_DATA_AUTH_SCHEME=Bearer
POLL_SECONDS=15
```

The token stays on the local server and is never sent to the browser or written to the trade ledger. The header name and scheme are configurable because BSE must confirm the exact authentication method for the selected feed. The defaults are `Authorization: Bearer`. Do not commit `.env` or paste credentials into chat.

**Activation status:** code and contract tests are implemented, but a live BSE handshake cannot be claimed until the user has an authorised feed endpoint, credentials and the matching BSE response specification. The app stays `not-configured` when either endpoint or token is missing. It does not silently fall back to Upstox, Quantsapp, synthetic values or public-site scraping.

## Adapter response contract

The BSE adapter expects the configured BSE endpoint to return JSON in the following normalized shape. This is the FnOPredictor adapter contract, not a claim that BSE's API natively returns these exact property names. If BSE supplies a different schema, map it in `lib/bse.js` against the official feed manual before enabling the feed.

```json
{
  "spot": 81500.25,
  "timestamp": "2026-11-16T10:05:00+05:30",
  "source": "BSE Self Data Feed",
  "lotSize": 20,
  "expiry": "2026-11-17",
  "expiryType": "weekly",
  "weeklyExpiries": ["2026-11-17"],
  "options": [
    {"strike": 81500, "type": "CE", "bid": 180, "ask": 182, "ltp": 181, "oi": 12000, "volume": 800, "iv": 15.2, "bidQty": 20, "askQty": 25},
    {"strike": 81500, "type": "PE", "bid": 175, "ask": 177, "ltp": 176, "oi": 13000, "volume": 900, "iv": 15.5, "bidQty": 30, "askQty": 35}
  ]
}
```

The adapter also accepts the common aliases `underlyingSpot`, `exchangeTimestamp`, `strikePrice`, `optionType`, `bestBidPrice`, `bestAskPrice`, `lastTradedPrice`, `openInterest`, `tradedVolume`, `impliedVolatility`, `bestBidQuantity` and `bestAskQuantity`.

## Validation and failure behaviour

- HTTPS endpoint and authenticated access are mandatory. Configure the header name and scheme to match BSE's issued API manual; defaults are `Authorization: Bearer`.
- A request times out after ten seconds.
- Exchange timestamp, SENSEX spot, weekly expiry, expiry list and lot size are mandatory.
- Bid and ask must be positive and non-crossed; bid/ask quantities must be positive for at least four contracts.
- Invalid, stale or missing snapshots suppress recommendations and paper-trade updates.
- The adapter rejects duplicate strike/type rows and invalid OI, volume or IV values.
- No data is fabricated when the provider is unavailable.
- The provider timestamp is kept distinct from the local retrieval timestamp.

## BSE access and licence

BSE's data portal says customers must register, complete KYC, select data plans, agree pricing and agreements, and obtain access. It lists Equity Derivatives API and trial access for selected feeds. The applicable price and usage rights depend on the selected plan and user category; confirm with BSE whether a single-user local research and paper-trading application is permitted under the intended licence.

## Monitoring safeguards

- Polls during the BSE weekday session, 09:15–15:30 Asia/Kolkata.
- Poll interval defaults to 15 seconds.
- Entry uses long ask and short bid; exit uses long bid and short ask.
- Maximum simulated risk remains capped at ₹2,000 by default.
- One simulated position at a time; no real orders are placed.
- Missing or invalid quotes suppress signals and P&L updates.
- Existing research, event tracking and paper-trade learning remain independent of the provider adapter.
