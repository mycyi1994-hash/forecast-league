#!/usr/bin/env python3
"""The builder agent's pick for a Forecast League round market. Read-only: prints a decision, sends nothing.

  python3 agent/pick.py --market btc-6h [--round N]

Decision rule (see docs/api/agent/backtest_*.json for why):
  * 6h windows: two years of out-of-sample backtest found no edge in the model (about 49%) and none
    statistically in simple rules; the least bad was following the last 6h window (about 51%, interval
    includes 50%). The agent therefore follows the last window, and logs the model's probability next to it
    so the two can be compared on live rounds.
  * 1h windows: fading the last hour scored about 52% for BTC and ETH, an interval above 50%.
  * The crowd (sides other agents picked themselves, from crowd.json) is logged next to each pick when at
    least five picked tickets exist, but it does not move the pick until the shadow evaluation shows it helps.
Prints JSON: side, probability, rule, model probability, model version, crowd, a one-sentence reason.
"""
import argparse, json, math, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import data, model

HOUR = 3600
MARKETS = {"btc-6h": ("BTC", 6, "BTC 6h"), "eth-6h": ("ETH", 6, "ETH 6h"), "bnb-6h": ("BNB", 6, "BNB 6h"),
           "btc-1h": ("BTC", 1, "BTC 1h"), "eth-1h": ("ETH", 1, "ETH 1h"), "bnb-1h": ("BNB", 1, "BNB 1h")}


def decide(market, rnd=None, now=None):
    asset, win, crowd_key = MARKETS[market]
    now = now or int(time.time())
    step = win * HOUR
    rnd = rnd if rnd is not None else now // step          # the open round; its window starts at the lock
    lock = (rnd + 1) * step
    gap = max(0.0, (lock - now) / HOUR)
    series = {k: model.index(data.hourly(k)) for k in ("BTC", "ETH", "BNB")}
    fund = data.okx_funding(asset, pages=1) if win == 6 else None
    # use the latest closed candle (decision time = now)
    g = max(0, math.ceil((lock - now) / HOUR))  # the last candle used has closed by now
    f = model.features(series, asset, lock, win, g, fund)
    if f is None:
        raise SystemExit(json.dumps({"ok": False, "error": "candles missing for the decision time"}))
    wpath = os.path.join(HERE, f"weights_{asset.lower()}_{win}h.json")
    pm = None
    if os.path.exists(wpath):
        w = json.load(open(wpath))
        pm = model.Logit.from_json(w).proba(model.vec(f))
    # the rule: last full window of the same length, known at decision time
    prev = f["prevwin"]
    if win == 6:
        rule, p_rule = "follow the last 6h window", (0.52 if prev > 0 else 0.48)
    else:
        rule, p_rule = "fade the last hour", (0.48 if f["r1"] > 0 else 0.52)
    p = p_rule
    crowd = None
    c = data.crowd()
    if c and crowd_key in (c.get("markets") or {}):
        row = next((x for x in c["markets"][crowd_key] if x.get("round") == rnd), None)
        if row and row.get("up", 0) + row.get("down", 0) >= 5:
            pc = (row["up"] + 1) / (row["up"] + row["down"] + 2)
            crowd = {"up": row["up"], "down": row["down"], "p": round(pc, 3)}
            # logged only: the crowd has not shown an edge yet (see shadow.json); it does not move the pick
    side = "up" if p > 0.5 else "down" if p < 0.5 else ("up" if prev >= 0 else "down")
    pct = lambda x: f"{x * 100:+.2f}%"
    s = series[asset]; last = lock - g * HOUR - HOUR
    pw_end = (last + HOUR) // step * step  # the same last full window the features use
    lastwin_ret = (s[pw_end - HOUR]["c"] / s[pw_end - step]["o"] - 1) if win == 6 and (pw_end - HOUR) in s and (pw_end - step) in s else None
    if win == 6:
        reason = (f"Rule {rule}: {asset} moved {pct(lastwin_ret) if lastwin_ret is not None else 'n/a'} over the last full 6h window, so {side}; "
                  f"backtests found no reliable edge at 6h, so this is a transparent default, not a prediction I trust.")
    else:
        reason = f"Rule {rule}: {asset} moved {pct(s[last]['c'] / s[last]['o'] - 1)} in the last hour, so {side}; 1h reversal scored about 52% out of sample."
    if crowd:
        reason += f" Crowd of picked tickets: {crowd['up']} up, {crowd['down']} down."
    return {"ok": True, "market": crowd_key, "round": rnd, "lock": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(lock)),
            "hoursToLock": round(gap, 2), "side": side, "prob": round(p, 4), "rule": rule, "ruleProb": p_rule,
            "modelProb": round(pm, 4) if pm is not None else None, "model": model.MODEL_VERSION, "crowd": crowd,
            "features": {k: round(v, 4) for k, v in f.items()}, "reason": reason}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", default="btc-6h", choices=sorted(MARKETS))
    ap.add_argument("--round", type=int)
    a = ap.parse_args()
    print(json.dumps(decide(a.market, a.round), indent=1))
