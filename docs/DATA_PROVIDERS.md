# Market data providers

## Important limitation

A public screener page is not automatically a free API, and a page visible in a browser is not permission to scrape or redistribute its data. BSE lists an official derivatives option-chain page, but its public web page is not documented here as an unrestricted JSON API. BSE also sells market-data products, including real-time and delayed feeds. Confirm the applicable terms and entitlements before using any feed.

References:
- BSE option chain: https://www.bseindia.com/markets/Derivatives/DeriReports/DeriOptionchain.html
- BSE market-data products: https://marketdata.bseindia.com/
- SEBI equity-derivatives directory: https://www.sebi.gov.in/curation/equity_derivatives.html

## Configure a permitted JSON feed

The server accepts two HTTPS JSON endpoints. This is intentionally provider-neutral: no undocumented third-party URL, browser CORS bypass, login scraping, or anti-bot circumvention is assumed.

Set:
- `BSE_QUOTE_JSON_URL`: quote endpoint; receives `symbol` query parameter.
- `BSE_OPTION_CHAIN_JSON_URL`: option-chain endpoint; receives `symbol` and `expiry` query parameters.
- `CACHE_TTL_MS`: cache duration, minimum 5 seconds; default 15 seconds.

Quote response must be JSON with a numeric `spot` (or `ltp` / `lastPrice`) and optional ISO `timestamp`.

Option-chain response must be JSON:
```json
{
  "spot": 80000,
  "timestamp": "2026-11-15T09:30:00+05:30",
  "source": "Provider name",
  "expiry": "2026-11-26",
  "options": [
    {"strike":80000,"type":"CE","bid":120,"ask":125,"ltp":123,"oi":12000,"volume":800,"iv":14},
    {"strike":80000,"type":"PE","bid":110,"ask":115,"ltp":112,"oi":10000,"volume":700,"iv":15}
  ]
}
```

The UI expects bid/ask, LTP, OI, volume and IV where available. It prefers ask for long legs and bid for short legs. LTP fallback is marked indicative. Provider timestamps are retained for freshness checks.

## Start

```sh
npm install
npm start
```

Open http://localhost:3000. Without both configured feed endpoints the app remains usable with a manual JSON snapshot or clearly labelled synthetic sample data, but it does not claim live market access.

## Security and operations

- Only HTTPS provider endpoints are accepted.
- Keep provider credentials on the server; do not place API keys in browser code.
- Do not use endpoints that require bypassing a provider's access controls or terms.
- Review each provider's exchange licensing, personal-use limits, rate limits and redistribution rights.
- The current gateway expects provider-normalized JSON. Add a dedicated adapter only after the provider documents its API and usage rights.
