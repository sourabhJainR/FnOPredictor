# Adaptive research and strategy evaluation

## Purpose

FnOPredictor records independent strategy forecasts, resolves them only after future observations arrive, scores their performance and keeps a paper-only research champion. The research champion is not automatically promoted into the trading strategy. A strategy must pass a sample-size and out-of-sample gate before it can be considered for a separate paper validation period.

## Algorithms under evaluation

The research engine currently compares:

- Momentum: five-observation and twenty-observation price returns.
- Mean reversion: deviation from a rolling twenty-observation mean.
- RSI(14): momentum exhaustion and strength.
- MACD(12,26,9): trend direction and momentum crossover.
- Bollinger(20): rolling standard-deviation bands for mean reversion.
- Put/call positioning: PCR level and its change.
- Volatility breakout: price movement adjusted for change in average option implied volatility.

The next algorithm families to add are ATR breakout, VWAP, and option Greeks / volatility-surface signals. They must use only fields available from the configured feed. VWAP and ATR must not be fabricated when the provider does not supply the required underlying volume or OHLC history.

## Walk-forward evaluation

Each signal records its strategy name, timestamp, input spot, direction, raw confidence, explanation, recent news/event context tags and five-observation horizon. It is resolved only after five later snapshots exist. The outcome record stores the future spot, realized direction, return and Brier loss. This avoids scoring a forecast against the same snapshot used to create it.

The leaderboard reports sample count, hit rate, average five-observation directional return, Brier score and distinct sessions. Each model also runs one defined-risk option-spread shadow trade per day when a valid spread exists. Shadow entries use long ask / short bid; exits use long bid / short ask after five later snapshots. The leaderboard reports shadow trade count, win rate, P&L and return on risk. Unpriced exits are excluded rather than guessed. The passive buy-and-hold forecast is the benchmark. A challenger needs at least 50 resolved forecasts, 15 distinct sessions, lower Brier loss, higher average directional return, at least 15 closed shadow trades and a better shadow return on risk than buy-and-hold before it can be named research champion. A champion is still shadow research, not an automatic live-strategy change.

Confidence calibration is withheld until at least 30 outcomes exist for a strategy and at least 10 comparable observations exist in the confidence neighbourhood. Small samples are labelled uncalibrated.

## Market events and news

Market-derived events include large spot moves, extreme PCR and implied-volatility surges. RSS/Atom news feeds can be configured through NEWS_FEED_URLS as a comma-separated list of HTTPS feed URLs. News is stored with its source, publication time, link, topic tags and a simple keyword sentiment label.

News labels are research annotations only. They do not prove that a headline caused a market move, and they do not change trade decisions. Add material scheduled events manually through POST /api/research/events. Do not treat unverified headlines or model-generated summaries as confirmed facts.

## Persistence and endpoints

The existing local state store retains research history, forecasts, resolved outcomes, events and news. The dashboard/API endpoint GET /api/research/state exposes the leaderboard, champion, recent forecasts and event feed. POST /api/research/events records a manual event.

## Promotion policy

- No strategy may be promoted from in-sample results alone.
- Keep all candidate models in shadow mode while gathering evidence.
- Require at least 50 resolved forecasts across 15 sessions, lower Brier score, higher directional return, at least 15 closed shadow trades and higher shadow return on risk than buy-and-hold.
- Require a separate paper validation period before changing the production paper-trade selector.
- Keep the current ₹2,000 risk ceiling, one-position limit and no-order-execution policy unchanged.
- Preserve model version, features, forecast, data timestamp and evaluation result for every future model change.
- Current shadow paper fills use live bid/ask snapshots and exclude brokerage, taxes, slippage and partial fills. A future historical bid/ask replay should add these costs before any stronger performance claim.

## Data limitations

The Upstox option-chain endpoint used by this application supplies snapshots, not a complete historical tick archive. The five-snapshot horizon is therefore a polling horizon, not a fixed wall-clock duration. News feed availability, licensing, delay and completeness depend on each feed operator. RSS ingestion is optional and does not require sending account tokens to a news service.
