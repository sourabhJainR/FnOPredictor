# FnOPredictor

A standalone local-first BSE SENSEX options monitoring and paper-trading dashboard. It is independent of AUREN and any other runtime.

## Capabilities

- Continuous SENSEX quote and nearest-weekly option-chain monitoring during the BSE weekday session.
- Best executable Bull Call Debit Spread and Bear Put Debit Spread recommendations.
- Buy legs priced at ask and sell legs priced at bid; no LTP-only auto-trading signals.
- Defined-risk sizing, one simulated position per day and a maximum risk cap of ₹2,000.
- Paper exit rules: +25% debit profit target, -30% debit loss limit, or 15:20 IST time exit.
- Persistent prediction and paper-trade ledger with realized simulated P&L.
- Outcome-based score calibration after at least 20 closed paper trades per side.
- Daily HTML report at `/reports/YYYY-MM-DD.html`.
- Automatic OS sleep prevention while the server runs.
- No order placement, no naked option selling and no averaging.

## Start locally

Requires Node.js 20 or later.

```sh
npm install
cp .env.example .env
# Add the endpoint and token supplied by BSE to .env
npm start
```

Open http://localhost:3000. Keep the terminal/server running for continuous monitoring. The app writes state to `data/state.json` and reports to `reports/`.

## Live data

The primary provider is the BSE Self Data Feed. BSE requires registration, KYC, a selected data plan, a signed agreement and payment or trial access before issuing feed details. Configure the exact HTTPS API endpoint and token supplied by BSE in `.env`:

```dotenv
BSE_MARKET_DATA_URL=https://your-bse-issued-endpoint
BSE_MARKET_DATA_TOKEN=your_bse_issued_token
```

The app does not scrape BSE's public website or call undocumented browser XHR endpoints. Until BSE supplies an endpoint, credentials and the response contract, live monitoring remains `not-configured`; no synthetic or Upstox fallback is used. See [docs/DATA_PROVIDERS.md](docs/DATA_PROVIDERS.md).


## Risk and model limitations

All trades are simulated. The application does not submit orders. The ₹10,000 capital and ₹2,000 maximum risk defaults preserve the configured research limits. It simulates only one defined-risk spread at a time. Exit thresholds are defaults and can be changed in the dashboard.

The ranking score is not a probability of profit. Outcome calibration uses the app's own paper ledger and should not be treated as independent validation. Paper fills exclude brokerage, taxes, market impact, queue priority and partial fills. Real market data, contract specifications and holiday calendars must be verified before using any recommendation.
