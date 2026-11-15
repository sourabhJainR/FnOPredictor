# FnOPredictor

A standalone single-page application for BSE options research and defined-risk debit spreads. It is independent of AUREN and any other runtime.

## Current capabilities

- Bull call and bear put debit-spread candidates.
- Spread legs priced using ask for buys and bid for sells, with clearly marked LTP fallback.
- Maximum profit, maximum loss, breakeven, return/risk and position sizing against a risk budget.
- Put/call open-interest ratio and an explainable heuristic ranking score.
- Live-feed gateway with caching, source timestamps and stale-data suppression.
- Manual normalized JSON import and synthetic sample mode for UI evaluation.
- Responsive single-page dashboard; no order placement.

## Start locally

Requires Node.js 20 or later.

```sh
npm install
cp .env.example .env
npm start
```

Open http://localhost:3000.

## Market data status

**Live BSE data is not enabled by default.** Configure the two HTTPS JSON feed endpoints documented in [docs/DATA_PROVIDERS.md](docs/DATA_PROVIDERS.md). The provider must permit your intended use and supply quote and option-chain fields. No third-party screener is scraped or represented as a free live API without documented permission.

BSE publishes an option-chain page and sells market-data products. A public web page does not, by itself, grant unrestricted API or redistribution rights. If no authorized provider is configured, the app says so and does not claim live prices.

## Option-chain schema

The chain JSON contains `spot`, optional `lotSize`, `timestamp`, `source`, `expiry` and an `options` array. Each contract contains `strike`, `type` (`CE` or `PE`), `bid`, `ask`, `ltp`, `oi`, `volume` and `iv`. If the feed omits lot size, enter the current exchange contract lot size manually. Never assume it is constant across instruments or contract revisions.

## Model and risk notes

The displayed confidence is a **heuristic model score**, not a calibrated probability of profit or a backtested win rate. It uses directional context, put/call OI, liquidity and IV. The debit-spread payoff is defined-risk at expiry, but displayed estimates exclude brokerage, taxes, slippage, partial fills and early-exit effects. Confirm contract specifications and live bid/ask depth before acting.

Synthetic sample data is for interface testing only. Manual and sample data are never labelled live. Snapshots older than two minutes suppress recommendations.
