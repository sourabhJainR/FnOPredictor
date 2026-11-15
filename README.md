# FnOPredictor

A standalone single-page application for BSE options research and defined-risk spread analysis.

## Project status

The repository was empty when this project was started. The application is being built as a separate product and does not require AUREN or another application runtime.

## Data integrity

- Market prices and option-chain values must include source, exchange timestamp, retrieval time, and freshness status.
- A provider is usable only when its access method and terms permit this use.
- The application must never label delayed, cached, simulated, or manually entered values as live.
- If no permitted live BSE feed is available, the UI must show that state and must not issue trade recommendations from stale data.
- Public exchange pages are not assumed to be a free, unrestricted redistribution API.

## Risk

This is an analytical tool, not investment advice or an order execution system. Spread calculations are estimates and exclude brokerage, taxes, slippage, and liquidity effects unless explicitly configured.
