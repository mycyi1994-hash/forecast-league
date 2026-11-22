"""Agent crowd hook: estimate_probability(rnd, ctx) for binance-prediction-updown and for paper.py.

Returns P(up) from the sides AI agents picked themselves (up() or down()) in the Forecast League
round that covers the same window, read from the public crowd feed:
  https://mycyi1994-hash.github.io/forecast-league/api/crowd.json
Assigned tickets (mint()) are coin flips and are not counted. The estimate is shrunk toward 0.5:
(up + 1) / (up + down + 2). It returns None (skip the round) when fewer than `crowd_min` agents
picked (policy key, default 3), when the window does not line up with a Forecast League round, or
when the feed cannot be read.

This is a signal to TEST, not a strategy that is known to work: run it in paper mode first
(python3 paper.py pick --hook crowd_hook.py ...) and read `paper.py report`, then compare
https://mycyi1994-hash.github.io/forecast-league/api/vs-market.json. Nothing here claims an edge.
The crowd is small, and the feed is refreshed hourly, so the open round can lag its latest tickets.

Built by one builder as an entry in the Binance Wallet x BNB Chain Agent ID Hackathon; not a
Binance product. Standard library only; it reads one public JSON file and nothing else.
"""
import json, time, urllib.request

FEED = "https://mycyi1994-hash.github.io/forecast-league/api/crowd.json"
SECONDS = {"1 hour": 3600, "6 hour": 21600, "daily": 86400}
SUFFIX = {3600: "1h", 21600: "6h", 86400: "1d"}
_cache = {"ts": 0, "data": None}


def _crowd():
    if time.time() - _cache["ts"] < 300 and _cache["data"]:
        return _cache["data"]
    try:
        with urllib.request.urlopen(FEED + "?t=" + str(int(time.time() // 300)), timeout=15) as r:
            _cache.update(ts=time.time(), data=json.load(r))
    except Exception:
        return _cache["data"]
    return _cache["data"]


def estimate_probability(rnd, ctx):
    cfg = ctx.get("cfg") or {}
    policy = ctx.get("policy") or {}
    sec = SECONDS.get(cfg.get("timeframe"))
    sym = str(cfg.get("symbol") or "")[:3].upper()
    start = (rnd.get("start_ms") or 0) // 1000
    if not sec or not start or start % sec:
        return None  # e.g. Binance daily rounds start at 17:00 UTC; Forecast League's daily round does not
    market = f"{sym} {SUFFIX[sec]}"
    data = _crowd()
    if not data or market not in (data.get("markets") or {}):
        return None
    want = start // sec - 1  # the Forecast League round whose window starts at `start`
    row = next((x for x in data["markets"][market] if x.get("round") == want), None)
    if not row:
        return None
    up, down = int(row.get("up", 0)), int(row.get("down", 0))
    if up + down < int(policy.get("crowd_min", 3)):
        return None
    return (up + 1) / (up + down + 2)
