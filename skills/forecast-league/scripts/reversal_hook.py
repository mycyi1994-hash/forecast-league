"""1-hour reversal hook: estimate_probability(rnd, ctx) for binance-prediction-updown and for paper.py.

Fades the last closed hourly candle: if it closed up, P(up) = 0.48; if down, 0.52. Other cadences are skipped
(returns None), because the effect was measured on hourly windows only.

Evidence (agent/backtest.py and agent/research.py in this repository, about two years of Binance spot 1h candles):
fading the last closed hour, even one hour before the window starts, was right about 51-52% of the time for BTC, ETH
and BNB, with 95% intervals above 50% (docs/api/agent/research.json, docs/api/agent/backtest_*_1h.json). Binance's
own skill documentation reports a similar reversal tendency at 1h. A 2-point edge is smaller than Binance
Prediction's fee (about 200 bps) plus the overround, so this hook is a test signal for paper mode, not a strategy
that pays after costs. Nothing here is financial advice.

Uses only ctx["streak_dir"] (direction of the last closed candle, as the daemon and paper.py provide it).
Built by one builder as a Binance Agent ID Hackathon entry; not a Binance product.
"""


def estimate_probability(rnd, ctx):
    cfg = ctx.get("cfg") or {}
    if cfg.get("timeframe") != "1 hour":
        return None
    d = ctx.get("streak_dir")
    if d is None or ctx.get("streak") in (None, 0):
        return None
    return 0.48 if d == 1 else 0.52
