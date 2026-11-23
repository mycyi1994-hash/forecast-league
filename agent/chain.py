"""On-chain reads for the agent: resultOf(round) on the Forecast League market contracts. Read-only."""
import json, urllib.request

RPCS = ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org", "https://bsc-dataseed.binance.org"]
CONTRACTS = {"BTC 1h": "0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629", "ETH 1h": "0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4",
             "BNB 1h": "0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736", "BTC 6h": "0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C",
             "ETH 6h": "0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1", "BNB 6h": "0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9"}
LEN = {"1h": 3600, "6h": 21600}


def call(to, data):
    for u in RPCS:
        try:
            body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": to, "data": data}, "latest"]}).encode()
            with urllib.request.urlopen(urllib.request.Request(u, body, {"content-type": "application/json"}), timeout=15) as r:
                j = json.load(r)
            if j.get("result"):
                return j["result"]
        except Exception:
            continue
    return None


def outcome(market, rnd):
    """1 up, 0 down, None not settled / push / void (resultOf(round): p0, p1, outcome, finished)."""
    h = call(CONTRACTS[market], "0xcdd20022" + format(rnd, "064x"))
    if not h or len(h) < 2 + 4 * 64:
        return None
    o = int(h[2 + 2 * 64: 2 + 3 * 64], 16)
    return 1 if o == 1 else 0 if o == 2 else None


