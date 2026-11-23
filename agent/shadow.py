#!/usr/bin/env python3
"""Shadow evaluation: once an hour, record what the agent WOULD pick in every round market (nothing is sent),
then score past shadow picks against the result each market contract recorded from Chainlink. Read-only.

  python3 agent/shadow.py            # append new picks, score old ones, write docs/api/agent/shadow.json

Each line of docs/api/agent/shadow.jsonl: market, round, decided-at, side, prob, rule, ruleProb, modelProb, crowd.
"""
import json, os, sys, time, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ.setdefault("FL_DAYS", "6")
import pick, model

ROOT = os.path.dirname(HERE)
LOG = os.path.join(ROOT, "docs", "api", "agent", "shadow.jsonl")
OUT = os.path.join(ROOT, "docs", "api", "agent", "shadow.json")
from chain import CONTRACTS, outcome  # noqa: E402
LEN = {"1h": 3600, "6h": 21600}


now = int(time.time())
os.makedirs(os.path.dirname(LOG), exist_ok=True)
rows = []
if os.path.exists(LOG):
    with open(LOG) as f:
        rows = [json.loads(x) for x in f if x.strip()]
have = {(r["market"], r["round"]) for r in rows}
added = 0
for key in ("btc-1h", "eth-1h", "bnb-1h", "btc-6h", "eth-6h", "bnb-6h"):
    name = pick.MARKETS[key][2]
    rnd = now // LEN[name.split()[1]]
    if (name, rnd) in have:
        continue  # one shadow pick per round, the first one taken
    try:
        d = pick.decide(key, None, now)
    except BaseException as e:  # a missing candle must not stop the others
        print(json.dumps({"skip": key, "why": str(e)[:200]}))
        continue
    rows.append({"market": name, "round": d["round"], "at": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(now)), "hoursToLock": d["hoursToLock"],
                 "side": d["side"], "prob": d["prob"], "rule": d["rule"], "ruleProb": d["ruleProb"], "modelProb": d["modelProb"],
                 "model": d["model"], "crowd": d["crowd"]})
    added += 1
# score: fill in results for finished rounds
for r in rows:
    if r.get("result") is None and now > (r["round"] + 2) * LEN[r["market"].split()[1]]:
        res = outcome(r["market"], r["round"])
        if res is not None:
            r["result"] = res
with open(LOG, "w") as f:
    f.write("\n".join(json.dumps(r) for r in rows) + "\n")


def summary(sel, key):
    sc = [r for r in sel if r.get("result") in (0, 1) and r.get(key) is not None and r[key] != 0.5]
    hits = sum(1 for r in sc if (r[key] > 0.5) == (r["result"] == 1))
    brier = sum((r[key] - r["result"]) ** 2 for r in sc) / len(sc) if sc else None
    return {"decided": len(sc), "right": hits, "hitRate": round(hits / len(sc), 4) if sc else None, "ci95": model.wilson(hits, len(sc)),
            "brier": round(brier, 4) if brier is not None else None}


out = {"name": "Forecast League builder agent: shadow picks (recorded, not sent)",
       "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
       "method": "Every hour the agent records the side it would pick in each round market (rule, probability, model probability, crowd), "
                 "without sending anything. Results come from resultOf(round) on each market contract (Chainlink). 'rule' is the pick the agent uses; "
                 "'model' is the logistic model's probability alone; 'crowd' is the picked tickets of other agents (Laplace-smoothed), where at least five exist.",
       "since": rows[0]["at"] if rows else None, "picks": len(rows), "scored": sum(1 for r in rows if r.get("result") in (0, 1)), "markets": {}}
for m in CONTRACTS:
    sel = [r for r in rows if r["market"] == m]
    crowd_rows = [dict(r, crowdProb=r["crowd"]["p"]) for r in sel if r.get("crowd")]
    out["markets"][m] = {"rule": summary(sel, "prob"), "model": summary(sel, "modelProb"), "crowd": summary(crowd_rows, "crowdProb")}
allr = rows
out["total"] = {"rule": summary(allr, "prob"), "model": summary(allr, "modelProb"),
                "crowd": summary([dict(r, crowdProb=r["crowd"]["p"]) for r in allr if r.get("crowd")], "crowdProb")}
with open(OUT, "w") as f:
    json.dump(out, f, indent=1)
print(json.dumps({"ok": True, "added": added, "picks": len(rows), "scored": out["scored"]}))
