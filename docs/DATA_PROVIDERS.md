# Market data providers and monitoring

## Live data is a required dependency

The monitor does not scrape the BSE page or bypass browser protections. Configure approved HTTPS JSON endpoints for a BSE SENSEX quote and a SENSEX option chain. Confirm the provider's exchange licensing, personal-use terms and rate limits.

References:
- BSE option chain: https://www.bseindia.com/markets/derivatives/derireports/derioptionchain
- BSE market-data products: https://marketdata.bseindia.com/
- SEBI equity-derivatives directory: https://www.sebi.gov.in/curation/equity_derivatives.html

## Environment

- `BSE_QUOTE_JSON_URL`: quote endpoint; receives `symbol=SENSEX`.
- `BSE_OPTION_CHAIN_JSON_URL`: chain endpoint; receives `symbol=SENSEX&expiry=nearest-weekly`.
- `CACHE_TTL_MS`: cache duration, default 15000.
- `POLL_SECONDS`: monitor poll interval, default 15 (10–60 seconds).
- `CAPITAL_INR`: default 10000.
- `RISK_LIMIT_INR`: maximum paper risk, capped at 2000.
- `SENSEX_LOT_SIZE`: fallback lot size if the provider omits it; default 20 based on the configured research assumption. Prefer the current lot size returned by the provider.

## Required provider response

Quote endpoint JSON:

```json
{
  "spot": 81500.25,
  "timestamp": "2026-11-16T10:05:00+05:30"
}
```

Option-chain endpoint JSON must represent the **nearest weekly expiry only** and return:

```json
{
  "spot": 81500.25,
  "timestamp": "2026-11-16T10:05:00+05:30",
  "source": "Approved provider",
  "lotSize": 20,
  "expiry": "2026-11-17",
  "expiryType": "weekly",
  "weeklyExpiries": ["2026-11-17", "2026-11-24"],
  "options": [
    {"strike":81500,"type":"CE","bid":180,"ask":182,"ltp":181,"oi":12000,"volume":800,"iv":15.2},
    {"strike":81500,"type":"PE","bid":175,"ask":177,"ltp":176,"oi":13000,"volume":900,"iv":15.5}
  ]
}
```

Every option must include executable bid and ask quotes. The monitor suppresses recommendations unless:
- The snapshot timestamp is valid and no older than two minutes.
- The provider identifies the selected expiry as `weekly`.
- `expiry` equals the earliest non-expired item in `weeklyExpiries`.
- At least four contracts have valid bid/ask values.
- The current lot size is known from provider or local configuration.

The provider must return a fresh chain for the requested expiry on every poll. If its API uses a different response shape, write a provider adapter rather than adding scraping or undocumented endpoint assumptions.

## Monitoring behaviour

- Polls during the BSE weekday session, 09:15–15:30 Asia/Kolkata. Exchange holidays are not bundled; provider errors and missing quotes remain visible.
- Evaluates the best call debit spread and put debit spread independently.
- Simulates at most one paper position per day, selecting the higher-ranked side. No real order is placed.
- One position at a time; maximum debit risk is the lower of configured capital and risk limit (hard cap ₹2,000).
- Default exit: book at +25% of entry debit, cut at -30%, or time exit at 15:20 IST.
- Closing values use long-leg bid less short-leg ask. If exit quotes are missing, the position remains open and no result is fabricated.
- Paper outcomes calibrate the side-specific ranking score only after 20 closed trades. This is a small bounded adjustment, not a proven predictive model.
- State is stored in `data/state.json`; daily HTML reports are written to `reports/YYYY-MM-DD.html`.

## Keep the laptop awake

The server requests an OS sleep inhibitor automatically on startup and releases it on shutdown:
- Windows: `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)`.
- macOS: `caffeinate`.
- Linux: `systemd-inhibit`.

This prevents automatic system sleep while the server is running. The display may still turn off, and OS policy can still lock the screen. Stopping the server or shutting down the process releases the inhibitor. The dashboard has a control to toggle it manually.

## Run locally

```sh
npm install
cp .env.example .env
# Set both approved provider endpoints in .env
npm start
```

Open http://localhost:3000. Keep the server process running for continuous monitoring. State and reports remain on the local machine.
