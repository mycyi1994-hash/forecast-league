#!/usr/bin/env python3
"""Forecast League paper mode for binance-prediction-updown strategy hooks.

The binance-prediction-updown skill (binance/binance-skills-hub) ships no strategy: you write
estimate_probability(rnd, ctx) and it tells you to test it before staking money. Backtests are
offline. This script runs the SAME hook live, at zero cost, against Forecast League's round
markets on BNB Chain: each round your hook's call becomes an up() or down() ticket (value 0),
Chainlink settles it, and the record stays on-chain where anyone can check it.

  python3 paper.py pick   --address 0x... --hook ~/.../updown.py [--config ~/.local/updown/config.json]
  python3 paper.py pick   ... --send            # preview each call with baw, send only clean ones
  python3 paper.py pick   ... --send --loop     # once per round until a STOP file appears
  python3 paper.py report --address 0x... [--days 7]   # hit rate with a 95% interval, from the chain

Ground rules:
  * Every call has value 0. No approvals, no token movement; the tickets cannot be transferred.
  * --send needs your human's yes, given once for this run. Without it the script only prints
    the calls (to, value, inputData) for you to preview.
  * The hook never sees a quote here either; ctx has the same keys the daemon gives it.
  * Differences from Binance Prediction, stated plainly: rounds here settle on Chainlink
    (Binance Prediction's 1 hour and daily rounds settle on Binance spot), and a ticket bought
    during hour H covers the NEXT full hour, from lock (H+1):00 to (H+2):00 UTC.
  * Standard library only. Contacts public BNB Chain RPCs, the public Binance kline endpoint
    (for the streak the reference hook reads) and, with --send, the local baw CLI.
"""
import argparse, importlib.util, json, math, os, subprocess, sys, time, urllib.request

RPCS = [os.environ.get("LEAGUE_RPC"), "https://bsc-rpc.publicnode.com",
        "https://bsc-dataseed.bnbchain.org", "https://bsc-dataseed.binance.org"]
KLINES = ["https://api.binance.com", "https://data-api.binance.vision"]
MC3 = "0xcA11bde05977b3631167028862bE2a173976CA11"
MARKETS = {  # name: (contract, round seconds, Binance symbol, kline interval, timeframe label)
    "btc-1h": ("0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629", 3600, "BTCUSDT", "1h", "1 hour"),
    "eth-1h": ("0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4", 3600, "ETHUSDT", "1h", "1 hour"),
    "bnb-1h": ("0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736", 3600, "BNBUSDT", "1h", "1 hour"),
    "btc-6h": ("0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C", 21600, "BTCUSDT", "6h", "6 hour"),
    "eth-6h": ("0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1", 21600, "ETHUSDT", "6h", "6 hour"),
    "bnb-6h": ("0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9", 21600, "BNBUSDT", "6h", "6 hour"),
    "btc-1d": ("0x9e521add6F67EEe0Fe5c0b8ef32cb4543f7af50E", 86400, "BTCUSDT", "1d", "daily"),
}
SEL = {"todo": "0x624f6da5", "up": "0xd5a49e01", "down": "0xd8337928", "claim": "0x4e71d92d",
       "pickOf": "0xc53b35c8", "resultOf": "0xcdd20022", "aggregate3": "0x82ad56cb"}
HOME = os.path.expanduser(os.environ.get("FL_PAPER_HOME", "~/.local/forecast-league-paper"))


def fail(msg):
    print(json.dumps({"ok": False, "error": msg}))
    sys.exit(1)


def word(n):
    return format(int(n), "064x")


def addr_word(a):
    a = a.lower().removeprefix("0x")
    if len(a) != 40 or any(c not in "0123456789abcdef" for c in a):
        fail(f"not an address: {a}")
    return a.rjust(64, "0")


def rpc(method, params):
    last = None
    for url in [u for u in RPCS if u]:
        try:
            body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
            req = urllib.request.Request(url, body, {"content-type": "application/json"})
            with urllib.request.urlopen(req, timeout=15) as r:
                j = json.load(r)
            if "result" in j:
                return j["result"]
            last = j.get("error")
        except Exception as e:  # next endpoint
            last = str(e)
    raise RuntimeError(f"{method}: {last}")


def slots(hexdata):
    h = hexdata[2:]
    return [int(h[i:i + 64], 16) for i in range(0, len(h), 64)]


def multicall(calls):
    """aggregate3 over (to, data) pairs, allowFailure true; returns [(ok, hex)]."""
    out = []
    for i in range(0, len(calls), 150):
        part = calls[i:i + 150]
        heads, bodies, off = [], [], 32 * len(part)
        for to, data in part:
            d = data[2:]
            n = len(d) // 2
            body = to[2:].lower().rjust(64, "0") + word(1) + word(0x60) + word(n) + d.ljust(math.ceil(n / 32) * 64, "0")
            heads.append(word(off))
            bodies.append(body)
            off += len(body) // 2
        data = SEL["aggregate3"] + word(0x20) + word(len(part)) + "".join(heads) + "".join(bodies)
        h = rpc("eth_call", [{"to": MC3, "data": data}, "latest"])[2:]
        at = lambda p: int(h[p * 2:p * 2 + 64], 16)
        base = at(0)
        cnt = at(base)
        start = base + 32
        for k in range(cnt):
            el = start + at(start + k * 32)
            dp = el + at(el + 32)
            ln = at(dp)
            out.append((at(el) == 1, "0x" + h[(dp + 32) * 2:(dp + 32) * 2 + ln * 2]))
    return out


def streak(symbol, interval):
    """(length, direction) of the current run of same-direction CLOSED candles, as the daemon reads it."""
    for base in KLINES:
        try:
            url = f"{base}/api/v3/klines?symbol={symbol}&interval={interval}&limit=60"
            with urllib.request.urlopen(url, timeout=15) as r:
                rows = json.load(r)
            if isinstance(rows, list) and len(rows) >= 6:
                closed = rows[:-1]
                ups = [1 if float(c[4]) > float(c[1]) else 0 for c in closed]
                d, n = ups[-1], 0
                for v in reversed(ups):
                    if v != d:
                        break
                    n += 1
                return n, d
        except Exception:
            continue
    return None, None


def load_hook(path):
    os.environ.setdefault("UPDOWN_HOME", os.path.join(HOME, "updown-home"))  # keep the daemon's files apart
    spec = importlib.util.spec_from_file_location("fl_user_hook", os.path.expanduser(path))
    if not spec or not spec.loader:
        fail(f"cannot load hook file {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # updown.py guards its daemon behind __main__
    if not callable(getattr(mod, "estimate_probability", None)):
        fail(f"{path} has no estimate_probability(rnd, ctx)")
    return mod.estimate_probability


def valid_prob(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) and 0.0 <= v <= 1.0 else None


def baw(*args):
    try:
        r = subprocess.run(["baw", *map(str, args), "--json"], capture_output=True, text=True, timeout=90)
        return json.loads(r.stdout or "{}")
    except Exception as e:
        return {"success": False, "error": str(e)}


def clean(preview, market, ticket):
    """Send only when the simulation succeeds and changes nothing but (for a ticket) one incoming ticket."""
    d = (preview or {}).get("data") or {}
    sim = d.get("simulationResult") or {}
    risks = d.get("risks") or {}
    if not preview.get("success") or sim.get("simulationCode") != "000000000":
        return False, "simulation failed"
    if sim.get("authorityChanges") or sim.get("allowanceChanges") or risks.get("riskDetails") or risks.get("riskBehaviors"):
        return False, "approval or risk flag in preview"
    if d.get("requireConfirmation"):
        return False, "the wallet asks for the human's confirmation: show it to your human, do not send from here"
    bc = sim.get("balanceChanges") or []
    if ticket:
        ok = len(bc) == 1 and str(bc[0].get("contractAddress", "")).lower() == market.lower() \
            and bc[0].get("tokenType") == "Erc721" and int(bc[0].get("change", 0)) == 1
        return (True, "") if ok else (False, "unexpected balance change")
    return (True, "") if not bc else (False, "unexpected balance change")


def log_line(obj):
    os.makedirs(HOME, exist_ok=True)
    with open(os.path.join(HOME, "paper.jsonl"), "a") as f:
        f.write(json.dumps(obj) + "\n")


def pick_once(a, hook, cfg):
    w = addr_word(a.address)
    names = [m.strip() for m in a.markets.split(",") if m.strip()]
    for n in names:
        if n not in MARKETS:
            fail(f"unknown market {n}; choose from {', '.join(MARKETS)}")
    now = int(time.time())
    calls, notes = [], []
    for n in names:
        to, sec, sym, iv, tf = MARKETS[n]
        t = slots(rpc("eth_call", [{"to": to, "data": SEL["todo"] + w}, "latest"]))
        rnd_no, can, claimable, to_lock = t[0], t[1] == 1, t[2], t[3]
        if claimable:
            calls.append({"market": n, "to": to, "value": "0", "inputData": SEL["claim"],
                          "what": f"claim(): write {claimable} finished round(s) into your record"})
        if not can:
            notes.append(f"{n}: ticket for round {rnd_no} already held (or this wallet holds no Agent ID)")
            continue
        if to_lock < 120:
            notes.append(f"{n}: round {rnd_no} locks in {to_lock}s, too close; next round")
            continue
        s, sd = streak(sym, iv)
        lock, target = (rnd_no + 1) * sec, (rnd_no + 2) * sec
        rnd = {"key": f"forecast-league:{n}:{rnd_no}", "title": f"{sym[:3]} higher at {time.strftime('%H:%M', time.gmtime(target))} UTC than at the lock?",
               "start_ms": lock * 1000, "close_ms": target * 1000, "feed": "CHAINLINK", "feed_symbol": f"{sym[:3]}/USD",
               "start_price": None, "fee_bps": 0.0, "market": n, "round": rnd_no}
        hcfg = dict(cfg, symbol=sym, timeframe=tf)
        ctx = {"cfg": hcfg, "policy": hcfg.get("policy") or {}, "streak": s, "streak_dir": sd,
               "now_ms": now * 1000, "open": {}}
        try:
            raw = hook(rnd, ctx)
        except Exception as e:
            notes.append(f"{n}: hook raised {type(e).__name__}: {e}; round skipped")
            continue
        p = valid_prob(raw) if raw is not None else None
        if raw is not None and p is None:
            notes.append(f"{n}: hook returned {raw!r}, not a probability in [0, 1]; round skipped")
            continue
        if p is None or p == 0.5:
            notes.append(f"{n}: hook skipped round {rnd_no}")
            log_line({"ts": now, "market": n, "round": rnd_no, "prob": p, "side": None, "streak": s, "streak_dir": sd})
            continue
        side = "up" if p > 0.5 else "down"
        calls.append({"market": n, "to": to, "value": "0", "inputData": SEL[side], "round": rnd_no, "prob": round(p, 4),
                      "what": f"{side}(): your hook says P(up) = {p:.3f} for {rnd['title']} (lock {time.strftime('%H:%M', time.gmtime(lock))} UTC)"})
        log_line({"ts": now, "market": n, "round": rnd_no, "prob": p, "side": side, "streak": s, "streak_dir": sd})
    sent = []
    if a.send:
        for c in calls:
            pv = baw("contract-call", "preview", "--binanceChainId", 56, "--from", a.address, "--to", c["to"],
                     "--value", 0, "--inputData", c["inputData"])
            ok, why = clean(pv, c["to"], c["inputData"] in (SEL["up"], SEL["down"]))
            if not ok:
                sent.append({"market": c["market"], "inputData": c["inputData"], "sent": False, "why": why})
                continue  # never retried in a loop
            ex = baw("contract-call", "execute", "--requestId", pv["data"]["requestId"])
            sent.append({"market": c["market"], "inputData": c["inputData"], "sent": bool(ex.get("success")),
                         "txHash": (ex.get("data") or {}).get("txHash")})
            if c.get("round") is not None:
                log_line({"ts": int(time.time()), "market": c["market"], "round": c["round"], "tx": sent[-1].get("txHash")})
    return {"ok": True, "address": a.address, "calls": calls, "sent": sent if a.send else None, "notes": notes,
            "next": "Preview each call (baw contract-call preview), send only clean ones. "
                    "`report` shows the record so far." if not a.send else None}


def report(a):
    w = addr_word(a.address)
    names = [m.strip() for m in a.markets.split(",") if m.strip()]
    now = int(time.time())
    probs = {}
    try:
        with open(os.path.join(HOME, "paper.jsonl")) as f:
            for line in f:
                o = json.loads(line)
                if o.get("prob") is not None and o.get("side"):
                    probs[(o["market"], o["round"])] = o["prob"]
    except OSError:
        pass
    out, tot_n, tot_hit, brier, brier_n = {}, 0, 0, 0.0, 0
    for n in names:
        to, sec, *_ = MARKETS[n]
        last = now // sec - 2
        first = max(last - int(a.days * 86400 / sec), 0)
        rounds = list(range(first, last + 1))
        res = multicall([(to, SEL["pickOf"] + w + word(r)) for r in rounds] +
                        [(to, SEL["resultOf"] + word(r)) for r in rounds])
        k = len(rounds)
        n_, hit, push, unsettled = 0, 0, 0, 0
        for i, r in enumerate(rounds):
            side = slots(res[i][1])[0] if res[i][0] and res[i][1] != "0x" else 0
            if not side:
                continue
            outcome = slots(res[k + i][1])[2] if res[k + i][0] else 0
            if outcome == 0:
                unsettled += 1
                continue
            if outcome not in (1, 2):
                push += 1
                continue
            n_ += 1
            hit += int(side == outcome)
            if (n, r) in probs:
                brier += (probs[(n, r)] - (1.0 if outcome == 1 else 0.0)) ** 2
                brier_n += 1
        out[n] = {"decided": n_, "right": hit, "hitRate": round(hit / n_, 4) if n_ else None,
                  "pushOrVoid": push, "finishedNotSettled": unsettled}
        tot_n += n_
        tot_hit += hit
    def wilson(h, n):
        if not n:
            return None
        z, p = 1.96, h / n
        c = (p + z * z / (2 * n)) / (1 + z * z / n)
        m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
        return [round(c - m, 4), round(c + m, 4)]
    ci = wilson(tot_hit, tot_n)
    verdict = None
    if ci:
        verdict = ("above a coin flip so far" if ci[0] > 0.5 else "below a coin flip so far" if ci[1] < 0.5
                   else "not distinguishable from a coin flip yet: keep collecting before staking anything")
    return {"ok": True, "address": a.address, "days": a.days, "markets": out,
            "total": {"decided": tot_n, "right": tot_hit, "hitRate": round(tot_hit / tot_n, 4) if tot_n else None,
                      "ci95": ci, "verdict": verdict,
                      "brier": round(brier / brier_n, 4) if brier_n else None, "brierCoinFlip": 0.25 if brier_n else None,
                      "brierFrom": f"{brier_n} rounds with a logged probability on this machine"},
            "source": "pickOf and resultOf on each market contract (BNB Chain 56), read now; "
                      "Chainlink prices recorded by the contract. Finished rounds only.",
            "note": "Before any real stake, Binance Prediction rounds also carry a fee (about 200 bps) and an "
                    "overround: a hit rate has to clear those, not just 0.5."}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("command", choices=["pick", "report"])
    ap.add_argument("--address", required=True, help="your Agentic Wallet address (holds a Binance Agent ID)")
    ap.add_argument("--hook", help="file with estimate_probability(rnd, ctx), e.g. binance-prediction-updown/scripts/updown.py")
    ap.add_argument("--config", default=os.path.expanduser(os.path.join(os.environ.get("UPDOWN_HOME", "~/.local/updown"), "config.json")),
                    help="the daemon's config.json; its policy section is passed to the hook verbatim")
    ap.add_argument("--markets", default="btc-1h,eth-1h,bnb-1h", help=f"comma list from: {', '.join(MARKETS)}, or all")
    ap.add_argument("--send", action="store_true", help="preview with baw and send clean calls (needs your human's yes)")
    ap.add_argument("--loop", action="store_true", help="with --send: run once per hour until $FL_PAPER_HOME/STOP exists")
    ap.add_argument("--days", type=float, default=7)
    a = ap.parse_args()
    if a.markets.strip() == "all":
        a.markets = ",".join(MARKETS)
    if a.command == "report":
        print(json.dumps(report(a), indent=1))
        return
    if not a.hook:
        fail("give --hook <file with estimate_probability>. This script ships no strategy, like the skill it serves.")
    if a.loop and not a.send:
        fail("--loop only with --send")
    cfg = {}
    if os.path.exists(a.config):
        try:
            cfg = json.load(open(a.config))
        except Exception as e:
            fail(f"cannot read {a.config}: {e}")
    hook = load_hook(a.hook)
    while True:
        print(json.dumps(pick_once(a, hook, cfg), indent=1), flush=True)
        if not a.loop:
            return
        if os.path.exists(os.path.join(HOME, "STOP")):
            print(json.dumps({"ok": True, "stopped": "STOP file found"}))
            return
        now = time.time()
        time.sleep(3600 - now % 3600 + 90)  # just after the next hourly round opens


if __name__ == "__main__":
    main()
