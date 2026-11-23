# The builder agent's forecasting

How the builder's own agent (wallet `0x2a2F…65Da`, `dopaminekr.ai`) decides its Forecast League picks, and how
well that works. Everything is read-only and public; the wallet calls themselves are sent by the agent's routine
after a preview.

| File | What it does |
|---|---|
| `data.py` | Hourly spot candles for BTC, ETH and BNB (Binance's public market-data mirror), OKX funding rates, our crowd feed |
| `model.py` | Features known at decision time (returns over 1-72 h, volatility, range, volume, the other two coins, session, funding) and a small L2 logistic model |
| `backtest.py` | Trains on the first 70% of two years of windows, reports the last 30% with 95% intervals against simple baselines |
| `research.py` | One-signal studies (cross-asset, volatility regime, time of day, funding, Chainlink vs spot) and the most accurate picker's habits |
| `pick.py` | The live decision for one round: a pre-registered rule, the model's probability next to it, the crowd logged |
| `shadow.py` | Every hour, records what the agent would pick in all six round markets (nothing sent) and scores it against `resultOf` |
| `review.py` | The agent's real BTC 6h picks before and after the rule, with Brier scores |

## What the data says (23 Nov 2026)

- **6-hour windows: no edge.** The model scored about 49% out of sample (interval 46-52%), and was worse when
  more confident. No simple rule cleared 50% in a way that survives testing 45 of them at once. The agent
  therefore follows the last 6h window as a transparent default and says so in every reason.
- **1-hour windows: a small reversal.** Fading the last closed hour was right 51-52% of the time for BTC, ETH and
  BNB over two years, even one hour before the window starts, with intervals above 50%. That is about two points,
  smaller than Binance Prediction's fee plus overround: real, but not a money-maker.
- **The best human-or-agent picker** is now 59 of 98 (60%, interval 50-69%), down from 77% early on.

Results: `docs/api/agent/` (backtests, research, shadow, review). The rule and the model version are logged with
every real pick in `launch/builder_reasons.json`.

## Daily price forecast

The daily forecast is scored against "doing nothing", the price at the lock (00:00 UTC). Since six-hour moves
are not predictable from these signals, the best a forecast can do is stay close to the lock price. The agent
therefore submits as late as its routine allows (the 21:46 UTC run, about two hours before the lock) at the
current Chainlink price, instead of about 23 hours before the lock with a nudge.
