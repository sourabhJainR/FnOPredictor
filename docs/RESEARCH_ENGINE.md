# Adaptive research and strategy evaluation

## Purpose

FnOPredictor records independent strategy forecasts, resolves them only after future observations arrive, scores their performance and keeps a paper-only research champion. The research champion is not automatically promoted into the trading strategy. A strategy must pass a sample-size and out-of-sample gate before it can be considered for a separate paper validation period.

## Algorithms under evaluation

The research engine currently compares:

- Momentum: five-observation and twenty-observation price returns.
- Mean reversion: deviation from a rolling twenty-observation mean.
- Put/call positioning: PCR level and its change.
- Volatility breakout: price movement adjusted for change in average option implied volatility.

The next algorithm families to add are RSI(14), MACD(12,26,9), Bollinger-band reversion, ATR breakout, VWAP, and option Greeks / volatility-surface signals. They must use only fields available from the configured feed. VWAP and ATR must not be fabricated when the provider does not supply the required underlying volume or OHLC history.

## Walk-forward evaluation

Each signal records its strategy name, timestamp, input spot, direction, raw confidence, explanation and five-observation horizon. It is resolved only after five later snapshots exist. The outcome record stores the future spot, realized direction, return and Brier loss. This avoids scoring a forecast against the same snapshot used to create it.

The leaderboard reports sample count, hit rate, average five-observation return, Brier score and distinct sessions. Momentum is the baseline. A challenger needs at least 50 resolved forecasts, 15 distinct sessions, lower Brier loss and higher average return than the baseline before it can be named research champion. A champion is still shadow research, not an automatic live-strategy change.

Confidence calibration is withheld until at least 30 outcomes exist for a strategy and at least 10 comparable observations exist in the confidence neighbourhood. Small samples are labelled uncalibrated.

## Market events and news

Market-derived events include large spot moves, extreme PCR and implied-volatility surges. RSS/Atom news feeds can be configured through NEWS_FEED_URLS as a comma-separated list of HTTPS feed URLs. News is stored with its source, publication time, link, topic tags and a simple keyword sentiment label.

News labels are research annotations only. They do not prove that a headline caused a market move, and they do not change trade decisions. Add material scheduled events manually through POST /api/research/events. Do not treat unverified headlines or model-generated summaries as confirmed facts.

## Persistence and endpoints

The existing local state store retains research history, forecasts, resolved outcomes, events and news. The dashboard/API endpoint GET /api/research/state exposes the leaderboard, champion, recent forecasts and event feed. POST /api/research/events records a manual event.

## Promotion policy

- No strategy may be promoted from in-sample results alone.
- Keep all candidate models in shadow mode while gathering evidence.
- Require minimum sample and session counts, better Brier score and better average return than the baseline.
- Require a separate paper validation period before changing the production paper-trade selector.
- Keep the current ₹2,000 risk ceiling, one-position limit and no-order-execution policy unchanged.
- Preserve model version, features, forecast, data timestamp and evaluation result for every future model change.
- Compare against passive directional baseline and transaction-cost-adjusted spread paper fills when a complete historical bid/ask replay is available.

## Data limitations

The Upstox option-chain endpoint used by this application supplies snapshots, not a complete historical tick archive. The five-snapshot horizon is therefore a polling horizon, not a fixed wall-clock duration. News feed availability, licensing, delay and completeness depend on each feed operator. RSS ingestion is optional and does not require sending account tokens to a news service.
