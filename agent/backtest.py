#!/usr/bin/env python3
"""Walk-forward backtest of the builder agent's model on Forecast League-shaped windows.

  python3 agent/backtest.py [--window 6] [--gap 2] [--asset BTC] [--out agent/backtest_6h.json]

Trains on the first 70% of windows (by time) and reports the last 30%, which the model never saw:
hit rate with a Wilson 95% interval, Brier score, and the same for simple baselines (always up,
follow the last window, fade the last window, coin flip). Also saves the trained weights for live use.
"""
import argparse, json, math, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import data, model

HOUR = 3600
ap = argparse.ArgumentParser()
ap.add_argument("--window", type=int, default=6)
ap.add_argument("--gap", type=float, default=2, help="hours between the decision and the lock")
ap.add_argument("--asset", default="BTC")
ap.add_argument("--l2", type=float, default=5.0)
ap.add_argument("--out")
ap.add_argument("--weights")
a = ap.parse_args()

series = {k: model.index(data.hourly(k)) for k in ("BTC", "ETH", "BNB")}
fund = data.okx_funding(a.asset)
ts = sorted(series[a.asset])
step = a.window * HOUR
locks = [t for t in range(ts[0] // step * step + step * 13, ts[-1] - step, step)]
rows = []
for L in locks:
    f = model.features(series, a.asset, L, a.window, a.gap, fund)
    y = model.label(series, a.asset, L, a.window)
    if f is not None and y is not None:
        rows.append((L, f, y))
cut = int(len(rows) * 0.7)
train, test = rows[:cut], rows[cut:]
m = model.Logit(l2=a.l2).fit([model.vec(f) for _, f, _ in train], [y for _, _, y in train])


def score(name, probs, ys):
    n = len(ys)
    hits = sum(1 for p, y in zip(probs, ys) if (p > 0.5) == (y == 1) and p != 0.5)
    decided = sum(1 for p in probs if p != 0.5)
    brier = sum((p - y) ** 2 for p, y in zip(probs, ys)) / n
    return {"name": name, "decided": decided, "right": hits, "hitRate": round(hits / decided, 4) if decided else None,
            "ci95": model.wilson(hits, decided), "brier": round(brier, 4)}


ys = [y for _, _, y in test]
pm = [m.proba(model.vec(f)) for _, f, _ in test]
base_up = sum(y for _, _, y in train) / len(train)
results = [
    score("model", pm, ys),
    score("always up (train base rate)", [base_up] * len(ys), ys),
    score("follow the last window", [0.55 if f["prevwin"] > 0 else 0.45 for _, f, _ in test], ys),
    score("fade the last window", [0.45 if f["prevwin"] > 0 else 0.55 for _, f, _ in test], ys),
    score("coin flip", [0.5] * len(ys), ys),
]
# confidence buckets: is the model better when it is more sure?
buckets = []
for lo, hi in ((0.5, 0.52), (0.52, 0.55), (0.55, 1.0)):
    sel = [(p, y) for p, y in zip(pm, ys) if lo <= max(p, 1 - p) < hi]
    if sel:
        h = sum(1 for p, y in sel if (p > 0.5) == (y == 1))
        buckets.append({"confidence": f"{lo:.2f}-{hi:.2f}", "n": len(sel), "hitRate": round(h / len(sel), 4), "ci95": model.wilson(h, len(sel))})
out = {
    "model": model.MODEL_VERSION, "asset": a.asset, "windowHours": a.window, "decisionHoursBeforeLock": a.gap,
    "data": "Binance spot 1h candles (data-api.binance.vision), OKX funding; labels: open at the lock vs close at the window end",
    "trainWindows": len(train), "testWindows": len(test),
    "trainFrom": time.strftime("%Y-%m-%d", time.gmtime(train[0][0])), "testFrom": time.strftime("%Y-%m-%d", time.gmtime(test[0][0])),
    "testTo": time.strftime("%Y-%m-%d", time.gmtime(test[-1][0])),
    "results": results, "confidenceBuckets": buckets,
    "weights": dict(zip(model.FEATURES, [round(w, 4) for w in m.w])),
}
print(json.dumps({k: out[k] for k in ("asset", "windowHours", "decisionHoursBeforeLock", "trainWindows", "testWindows")}))
for r in results:
    print(f"  {r['name']:<28} {r['right']}/{r['decided']}  hit {r['hitRate']}  ci {r['ci95']}  brier {r['brier']}")
for b in buckets:
    print("  bucket", b)
if a.out:
    with open(a.out, "w") as f:
        json.dump(out, f, indent=1)
if a.weights:
    full = model.Logit(l2=a.l2).fit([model.vec(f) for _, f, _ in rows], [y for _, _, y in rows])  # live model: all windows
    with open(a.weights, "w") as f:
        json.dump(full.to_json(model.FEATURES) | {"asset": a.asset, "windowHours": a.window, "gapHours": a.gap,
                  "trainedOn": len(rows), "trainedTo": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(rows[-1][0]))}, f, indent=1)
