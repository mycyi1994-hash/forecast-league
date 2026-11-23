#!/usr/bin/env python3
"""Single-signal studies for the agent, on two years of hourly candles, plus a look at the most accurate picker.
Read-only. Writes docs/api/agent/research.json.

Every study is a simple rule evaluated on all windows (no fitting), so its hit rate needs no train/test split;
intervals are Wilson 95%. A rule only "helps" if its interval sits above 50%.
"""
import json, math, os, sys, time, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import data, model

ROOT = os.path.dirname(HERE)
HOUR = 3600
series = {k: model.index(data.hourly(k)) for k in ("BTC", "ETH", "BNB")}


def windows(asset, win):
    s = series[asset]; ts = sorted(s); step = win * HOUR
    for L in range(ts[0] // step * step + 4 * step, ts[-1] - step, step):
        y = model.label(series, asset, L, win)
        if y is None:
            continue
        yield L, y


def study(name, asset, win, signal):
    """signal(L) -> +1 (up), -1 (down) or 0 (no call)"""
    h = n = 0
    for L, y in windows(asset, win):
        sg = signal(L)
        if sg == 0:
            continue
        n += 1; h += 1 if (sg > 0) == (y == 1) else 0
    return {"study": name, "asset": asset, "windowHours": win, "calls": n, "right": h, "hitRate": round(h / n, 4) if n else None,
            "ci95": model.wilson(h, n), "helps": bool(n and model.wilson(h, n)[0] > 0.5)}


def ret(asset, t0, t1):
    s = series[asset]
    return math.log(s[t1 - HOUR]["c"] / s[t0]["o"]) if t0 in s and (t1 - HOUR) in s else None


out = {"name": "Forecast League builder agent: single-signal studies", "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
       "data": "Binance spot 1h candles, about two years; labels: open at the window start vs close at its end", "studies": []}
S = out["studies"]
for win in (1, 6):
    step = win * HOUR
    for a in ("BTC", "ETH", "BNB"):
        # 4. cross-asset: follow the other two coins' last window when they agree
        def cross(L, a=a, step=step):
            others = [o for o in ("BTC", "ETH", "BNB") if o != a]
            rs = [ret(o, L - step, L) for o in others]
            if None in rs or (rs[0] > 0) != (rs[1] > 0):
                return 0
            return 1 if rs[0] > 0 else -1
        S.append(study("4. follow the other two coins' last window when they agree", a, win, cross))
        # 5. volatility regime: fade the last window only when the last 24h were calm / stormy
        def vol24(L, a=a):
            s = series[a]; r = [math.log(s[L - k * HOUR]["c"] / s[L - (k + 1) * HOUR]["c"]) for k in range(1, 25) if (L - (k + 1) * HOUR) in s and (L - k * HOUR) in s]
            return (sum(x * x for x in r) / len(r)) ** 0.5 if len(r) == 24 else None
        vols = [v for v in (vol24(L) for L, _ in windows(a, win)) if v]
        med = sorted(vols)[len(vols) // 2] if vols else 0
        for regime, cond in (("calm", lambda v: v < med), ("stormy", lambda v: v >= med)):
            def fade_in(L, a=a, step=step, cond=cond):
                v = vol24(L); r = ret(a, L - step, L)
                if v is None or r is None or not cond(v):
                    return 0
                return -1 if r > 0 else 1
            S.append(study(f"5. fade the last window, {regime} market only", a, win, fade_in))
        # 6. time of day: always up in each 6-hour session (base rate per session)
        for sess in (0, 6, 12, 18):
            S.append(study(f"6. always up, windows starting {sess:02d}-{sess + 5:02d} UTC", a, win,
                           lambda L, sess=sess: 1 if ((L // HOUR) % 24) // 6 * 6 == sess else 0))
# 8. funding: fade crowded positioning (positive funding -> down) over the OKX history available (~3 months)
for a in ("BTC", "ETH", "BNB"):
    fund = data.okx_funding(a)
    if fund:
        f0 = fund[0][0]
        def fsig(L, fund=fund):
            past = [r for t, r in fund if t <= L]
            if not past or abs(past[-1]) < 1e-5:
                return 0
            return -1 if past[-1] > 0 else 1
        r = study("8. fade the sign of the latest OKX funding rate", a, 6, lambda L, f0=f0, fsig=fsig: fsig(L) if L >= f0 else 0)
        r["note"] = "OKX funding history reaches back about three months only"
        S.append(r)

# 7. Chainlink vs Binance spot: how often do the two settle the same direction (from vs-market.json, 1h)?
try:
    v = json.load(open(os.path.join(ROOT, "docs", "api", "vs-market.json")))
    out["feeds"] = {"comparedHours": v["totals"]["feedsCompared"], "sameDirection": v["totals"]["feedsAgree"],
                    "source": "api/vs-market.json: Binance spot hourly close vs Binance Prediction start price, against the Chainlink prices our hourly contracts recorded"}
except Exception:
    out["feeds"] = None

# 18. the most accurate picker: when and how it picks
try:
    led = json.load(open(os.path.join(ROOT, "docs", "api", "picks", "ledger.json")))["tickets"]
    fin = json.load(open(os.path.join(ROOT, "docs", "api", "findings.json")))
    top = fin["topPickers"][0]["wallet"]
    mine = [t for t in led if t["holder"] == top and t["how"] in ("up", "down")]
    by_m = {}
    for t in mine:
        by_m[t["m"]] = by_m.get(t["m"], 0) + 1
    # did it follow or fade the market's previous round (same market, previous window's spot move)?
    follow = fade = 0
    for t in mine:
        win = 6 if t["m"].endswith("6h") else 1 if t["m"].endswith("1h") else 24
        asset = t["m"].split()[0]; step = win * HOUR; lock = (t["round"] + 1) * step
        r = ret(asset, lock - 2 * step, lock - step)  # the last window fully known when a ticket of this round is bought
        if r is None:
            continue
        if (r > 0) == t["up"]:
            follow += 1
        else:
            fade += 1
    out["topPicker"] = {"wallet": top, "picked": len(mine), "byMarket": by_m, "upShare": round(sum(1 for t in mine if t["up"]) / len(mine), 3) if mine else None,
                        "sameSideAsPreviousWindow": follow, "oppositeSide": fade,
                        "record": {k: fin["topPickers"][0][k] for k in ("won", "decided", "hitRate", "ci95")}}
except Exception as e:
    out["topPicker"] = {"error": str(e)[:200]}

out["helps"] = [x for x in S if x["helps"]]
with open(os.path.join(ROOT, "docs", "api", "agent", "research.json"), "w") as f:
    json.dump(out, f, indent=1)
print(json.dumps({"studies": len(S), "helps": [(x["study"], x["asset"], x["windowHours"], x["hitRate"], x["ci95"]) for x in out["helps"]], "topPicker": out["topPicker"]}, indent=1))
