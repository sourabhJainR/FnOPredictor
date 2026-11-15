# Market data provider

## Primary provider: Upstox Developer API

FnOPredictor now has a native Upstox adapter for BSE SENSEX. Upstox states that its trading and market-data APIs are free to use. Access requires an Upstox account, an API app and a valid bearer token. The token is stored locally in .env; it is never sent to the browser or written to the trade ledger.

Official references:
- API pricing and free access: https://upstox.com/trading-api/
- Option chain endpoint: https://upstox.com/developer/api-documentation/get-pc-option-chain/
- Option contract and weekly-expiry metadata: https://upstox.com/developer/api-documentation/get-option-contracts/
- Instrument key reference: https://upstox.com/developer/api-documentation/instruments/
- Analytics Token setup: https://upstox.com/developer/api-documentation/analytics-token/

### Data mapping

The adapter uses the BSE index instrument key BSE_INDEX|SENSEX.

1. Calls GET /v2/option/contract?instrument_key=BSE_INDEX%7CSENSEX&expiry_date=current_week.
2. Requires returned contracts to identify BSE_FO, the SENSEX underlying, weekly=true, and a consistent lot size. It selects the earliest unexpired weekly expiry.
3. Calls GET /v2/option/chain?instrument_key=BSE_INDEX%7CSENSEX&expiry_date=YYYY-MM-DD.
4. Maps each strike's call and put legs into the app's normalized JSON format:
   - strike_price → strike
   - market_data.bid_price / ask_price → executable bid / ask
   - market_data.ltp → ltp
   - market_data.oi, volume → oi, volume
   - option_greeks.iv → iv
   - underlying_spot_price → SENSEX spot
   - contract lot_size → lot size

The option-chain endpoint returns the SENSEX spot and option quotes in one response, so the adapter does not mix spot values from a different provider.

**Timestamp note:** the documented option-chain response does not expose a per-snapshot exchange timestamp. The adapter records the local retrieval time and labels it retrieved_at. This confirms when the app fetched the snapshot, not the exchange's original quote timestamp. The monitor also requires valid bid/ask values; stale or missing quotes suppress recommendations. Do not interpret the retrieval timestamp as an exchange timestamp.

### Configure Upstox

1. Create or use an Upstox account.
2. Open the Upstox Developer Apps page, select the Analytics tab and generate an Analytics Token. It is free, read-only, valid for one year, and supports the Option Chain API without a static IP. It cannot place or modify orders.
3. Copy .env.example to .env and set:

    UPSTOX_ACCESS_TOKEN=your_token_here
    UPSTOX_INSTRUMENT_KEY=BSE_INDEX|SENSEX
    POLL_SECONDS=15

4. Run npm start.

The app uses current_week on each polling cycle, so the expiry rolls forward automatically. The server keeps the token in its environment and calls Upstox directly. Never commit .env, paste the token into the dashboard, or share it in chat. The repository ignores local environment files.

Upstox says its APIs are free, but account eligibility, authentication, API access and exchange-data terms still apply. A valid token is required; this is not an anonymous public feed.

## Optional custom provider

If Upstox is not configured, the application can use approved HTTPS JSON endpoints:
- BSE_QUOTE_JSON_URL: receives symbol=SENSEX.
- BSE_OPTION_CHAIN_JSON_URL: receives symbol=SENSEX&expiry=nearest-weekly.

Do not use undocumented endpoints or scrape around exchange access controls. Confirm the provider's data licence, personal-use terms and rate limits.

## Provider response contract

Quote endpoint:

    {
      "spot": 81500.25,
      "timestamp": "2026-11-16T10:05:00+05:30"
    }

Option-chain endpoint:

    {
      "spot": 81500.25,
      "timestamp": "2026-11-16T10:05:00+05:30",
      "source": "Approved provider",
      "lotSize": 20,
      "expiry": "2026-11-17",
      "expiryType": "weekly",
      "weeklyExpiries": ["2026-11-17"],
      "options": [
        {"strike":81500,"type":"CE","bid":180,"ask":182,"ltp":181,"oi":12000,"volume":800,"iv":15.2},
        {"strike":81500,"type":"PE","bid":175,"ask":177,"ltp":176,"oi":13000,"volume":900,"iv":15.5}
      ]
    }

## Other free sources considered

- indiaopt / BSE public-site wrappers: useful for research and EOD/option-chain inspection, but unofficial, subject to website changes and rate limits. The documented sample data focuses on LTP, OI, volume and IV; it does not establish executable bid/ask coverage. It is not used for paper fills.
- Nubra: documents BSE option-chain snapshots and real-time streams, but requires an authenticated session. Its REST option-chain sample does not include bid/ask fields in the example response; order-book data is a separate feed. Free eligibility was not established, so it is not the default.
- BSE official market-data products: BSE lists real-time, delayed, EOD and historical feeds. Confirm the current licence and tariff directly with BSE before using an official data feed.

## Monitoring and safeguards

- Polls during BSE weekday session, 09:15–15:30 Asia/Kolkata.
- Poll interval defaults to 15 seconds and can be adjusted in the dashboard.
- Evaluates the best call debit spread and put debit spread independently.
- Simulates at most one paper position per day. No real order is placed.
- Maximum debit risk is capped at ₹2,000.
- Default exit: +25% of entry debit, -30%, or 15:20 IST.
- Entry uses long ask and short bid. Exit uses long bid and short ask.
- If quotes are missing, crossed or invalid, no recommendation or fabricated P&L is produced.
- Daily HTML reports are written to reports/YYYY-MM-DD.html.

## Keep the laptop awake

The server requests an OS sleep inhibitor automatically on startup and releases it on shutdown:
- Windows: SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED).
- macOS: caffeinate.
- Linux: systemd-inhibit.

This prevents automatic system sleep while the server runs. The display may still turn off, and OS policy can still lock the screen.