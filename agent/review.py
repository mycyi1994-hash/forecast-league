#!/usr/bin/env python3
"""Review of the builder agent's real BTC 6h picks: what it picked, why, and what Chainlink decided. Read-only.
Writes docs/api/agent/review.json: before and after the model-based rule (entries that carry "model"),
hit rates with intervals, Brier score where a probability was logged, and the latest shadow summary.
"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import model
from chain import outcome  # noqa: E402

ROOT = os.path.dirname(HERE)
reasons = json.load(open(os.path.join(ROOT, "launch", "builder_reasons.json")))["entries"]
picks = [e for e in reasons if e.get("market") == "BTC 6h" and e.get("side") in ("up", "down") and e.get("round")]
now = int(time.time())
rows = []
for e in picks:
    res = outcome("BTC 6h", int(e["round"])) if now > (int(e["round"]) + 2) * 21600 else None
    rows.append({"round": e["round"], "utc": e.get("utc"), "side": e["side"], "prob": e.get("prob"), "rule": e.get("rule"),
                 "model": e.get("model"), "result": None if res is None else ("up" if res == 1 else "down"), "reason": e.get("reason")})


def summ(sel):
    d = [r for r in sel if r["result"]]
    h = sum(1 for r in d if r["side"] == r["result"])
    pb = [r for r in d if r.get("prob") is not None]
    brier = sum((r["prob"] - (1 if r["result"] == "up" else 0)) ** 2 for r in pb) / len(pb) if pb else None
    return {"picks": len(sel), "decided": len(d), "right": h, "hitRate": round(h / len(d), 4) if d else None,
            "ci95": model.wilson(h, len(d)), "brier": round(brier, 4) if brier is not None else None, "brierCoinFlip": 0.25}


before = [r for r in rows if not r.get("model")]
after = [r for r in rows if r.get("model")]
shadow = None
try:
    shadow = json.load(open(os.path.join(ROOT, "docs", "api", "agent", "shadow.json")))["total"]
except Exception:
    pass
out = {"name": "Forecast League builder agent: review of its real picks (BTC 6h)",
       "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
       "before": dict(summ(before), how="picked by a written reason each time, no fixed rule, no logged probability"),
       "after": dict(summ(after), how="the rule in agent/pick.py (follow the last 6h window), probability and model version logged"),
       "shadowAllMarkets": shadow,
       "picks": rows[-60:]}
with open(os.path.join(ROOT, "docs", "api", "agent", "review.json"), "w") as f:
    json.dump(out, f, indent=1)
print(json.dumps({k: out[k] for k in ("before", "after")}))
