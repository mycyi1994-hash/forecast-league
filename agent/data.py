"""Data for the Forecast League builder agent. Standard library only, read-only, public endpoints.

- Hourly spot candles for BTC, ETH and BNB from the public Binance market-data mirror
  (data-api.binance.vision; the main api.binance.com and the futures API are geo-blocked in some regions).
- Perpetual funding rates from OKX's public API (Binance futures data is not reachable from here).
- Forecast League's own public feeds: picked sides per round (crowd.json), Binance Prediction quotes (vs-market.json).
Candles are cached as JSON lines under agent/cache/ (git-ignored) and extended on each call.
"""
import json, os, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
SYMBOLS = {"BTC": "BTCUSDT", "ETH": "ETHUSDT", "BNB": "BNBUSDT"}
KLINE_BASES = ["https://data-api.binance.vision", "https://api.binance.com"]
SITE = "https://mycyi1994-hash.github.io/forecast-league"
HOUR = 3600


def get_json(url, timeout=20, tries=3):
    last = None
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "forecast-league-agent"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except Exception as e:  # retry, then give up
            last = e
            time.sleep(1 + a)
    raise RuntimeError(f"{url}: {last}")


def _klines_page(symbol, start_ms):
    for base in KLINE_BASES:
        try:
            rows = get_json(f"{base}/api/v3/klines?symbol={symbol}&interval=1h&startTime={start_ms}&limit=1000")
            if isinstance(rows, list):
                return rows
        except Exception:
            continue
    raise RuntimeError(f"no kline source answered for {symbol}")


def hourly(asset, since=None, days=None):
    """Closed 1h candles as dicts {t (open time, s), o, h, l, c, v}, oldest first, cached on disk."""
    days = days or int(os.environ.get("FL_DAYS", "730"))
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{asset}_1h.jsonl")
    rows = []
    if os.path.exists(path):
        with open(path) as f:
            rows = [json.loads(x) for x in f if x.strip()]
    now = int(time.time())
    start = (rows[-1]["t"] + HOUR) if rows else (since or now - days * 86400) // HOUR * HOUR
    new = []
    while start < now - HOUR:
        page = _klines_page(SYMBOLS[asset], start * 1000)
        if not page:
            break
        for k in page:
            t = int(k[0]) // 1000
            if t + HOUR > now:  # still open: never use an unfinished candle
                continue
            new.append({"t": t, "o": float(k[1]), "h": float(k[2]), "l": float(k[3]), "c": float(k[4]), "v": float(k[5])})
        last = int(page[-1][0]) // 1000
        if last + HOUR >= now - HOUR or len(page) < 1000:
            break
        start = last + HOUR
    if new:
        seen = {r["t"] for r in rows}
        rows += [r for r in new if r["t"] not in seen]
        rows.sort(key=lambda r: r["t"])
        with open(path, "w") as f:
            f.write("\n".join(json.dumps(r) for r in rows) + "\n")
    return rows


def okx_funding(asset, pages=8):
    """OKX perpetual funding rates (8-hourly), newest pages first; returns [(t_s, rate)] oldest first."""
    inst = f"{asset}-USDT-SWAP"
    out, after = [], ""
    for _ in range(pages):
        url = f"https://www.okx.com/api/v5/public/funding-rate-history?instId={inst}&limit=100" + (f"&after={after}" if after else "")
        try:
            j = get_json(url)
        except Exception:
            break
        data = j.get("data") or []
        if not data:
            break
        out += [(int(d["fundingTime"]) // 1000, float(d["realizedRate"] or d["fundingRate"])) for d in data]
        after = data[-1]["fundingTime"]
    return sorted(set(out))


def crowd():
    """Picked up/down counts per open and locked round, from the public feed (None if unreachable)."""
    try:
        return get_json(f"{SITE}/api/crowd.json?t={int(time.time() // 300)}")
    except Exception:
        return None
