"""Features and a small logistic model for "is the price higher at the end of the window than at its start?".

A window starts at the lock L (a round boundary) and lasts W hours. The decision is made G hours before L, using
only candles that had closed by then (no look-ahead). Labels use Binance spot hourly candles: the open of the
candle at L against the close of the candle that ends at L+W. Forecast League settles on Chainlink, which tracks
these closely but not exactly (see the feeds comparison on the judges page).
Standard library only. MODEL_VERSION changes whenever the features or the training rule change.
"""
import json, math, os

MODEL_VERSION = "fl-logit-1"
HOUR = 3600
FEATURES = ["r1", "r3", "r6", "r12", "r24", "r72", "prevwin", "vol24", "volratio", "z24", "rangepos", "vratio",
            "eth_rel6", "bnb_rel6", "s00", "s06", "s12", "s18", "fund"]


def index(rows):
    return {r["t"]: r for r in rows}


def lr(a, b):
    return math.log(a / b) if a > 0 and b > 0 else 0.0


def features(series, asset, lock, window_h, gap_h, funding=None):
    """Feature dict for the asset's window starting at `lock` (unix s), decided gap_h hours before it; None if data is missing."""
    s = series[asset]
    last = lock - gap_h * HOUR - HOUR  # open time of the last candle closed by the decision time
    need = [last - k * HOUR for k in range(0, 73)]
    if any(t not in s for t in need):
        return None
    c = lambda k: s[last - k * HOUR]["c"]
    rets = [lr(c(k), c(k + 1)) for k in range(0, 72)]
    vol24 = (sum(x * x for x in rets[:24]) / 24) ** 0.5 or 1e-9
    vol6 = (sum(x * x for x in rets[:6]) / 6) ** 0.5
    closes24 = [c(k) for k in range(0, 24)]
    mean24 = sum(closes24) / 24
    hi24 = max(s[last - k * HOUR]["h"] for k in range(0, 24))
    lo24 = min(s[last - k * HOUR]["l"] for k in range(0, 24))
    v6 = sum(s[last - k * HOUR]["v"] for k in range(0, 6)) / 6
    v24 = sum(s[last - k * HOUR]["v"] for k in range(0, 24)) / 24 or 1e-9
    # the last full window of the same length that ended by the decision time
    pw_end = (last + HOUR) // (window_h * HOUR) * (window_h * HOUR)
    pw_start = pw_end - window_h * HOUR
    prevwin = lr(s[pw_end - HOUR]["c"], s[pw_start]["o"]) if (pw_end - HOUR) in s and pw_start in s else 0.0
    f = {
        "r1": lr(c(0), c(1)) / vol24, "r3": lr(c(0), c(3)) / vol24, "r6": lr(c(0), c(6)) / vol24,
        "r12": lr(c(0), c(12)) / vol24, "r24": lr(c(0), c(24)) / vol24, "r72": lr(c(0), c(72)) / vol24,
        "prevwin": prevwin / vol24, "vol24": vol24 * 100, "volratio": vol6 / vol24,
        "z24": (c(0) - mean24) / (c(0) * vol24), "rangepos": (c(0) - lo24) / (hi24 - lo24) if hi24 > lo24 else 0.5,
        "vratio": v6 / v24,
    }
    for other, key in (("ETH", "eth_rel6"), ("BNB", "bnb_rel6")):
        o = series.get(other, {})
        if other != asset and last in o and (last - 6 * HOUR) in o:
            f[key] = (lr(o[last]["c"], o[last - 6 * HOUR]["c"]) - lr(c(0), c(6))) / vol24
        else:
            f[key] = 0.0
    hod = (lock // HOUR) % 24
    for h in (0, 6, 12, 18):
        f[f"s{h:02d}"] = 1.0 if (hod // 6) * 6 == h else 0.0
    f["fund"] = 0.0
    if funding:
        past = [r for (t, r) in funding if t <= lock - gap_h * HOUR]
        if past:
            f["fund"] = past[-1] * 10000  # basis points per 8h
    return f


def label(series, asset, lock, window_h):
    s = series[asset]
    end = lock + window_h * HOUR - HOUR
    if lock not in s or end not in s:
        return None
    o, cl = s[lock]["o"], s[end]["c"]
    return None if cl == o else (1 if cl > o else 0)


class Logit:
    """L2-regularised logistic regression with feature standardisation (batch gradient descent)."""

    def __init__(self, l2=1.0, epochs=400, lr_=0.1):
        self.l2, self.epochs, self.lr = l2, epochs, lr_

    def fit(self, X, y):
        n, d = len(X), len(X[0])
        self.mu = [sum(r[j] for r in X) / n for j in range(d)]
        self.sd = [max((sum((r[j] - self.mu[j]) ** 2 for r in X) / n) ** 0.5, 1e-9) for j in range(d)]
        Z = [[(r[j] - self.mu[j]) / self.sd[j] for j in range(d)] for r in X]
        self.w, self.b = [0.0] * d, 0.0
        for _ in range(self.epochs):
            gw, gb = [0.0] * d, 0.0
            for z, t in zip(Z, y):
                p = 1 / (1 + math.exp(-max(-30, min(30, self.b + sum(wj * zj for wj, zj in zip(self.w, z))))))
                e = p - t
                gb += e
                for j in range(d):
                    gw[j] += e * z[j]
            self.b -= self.lr * gb / n
            self.w = [wj - self.lr * (gj / n + self.l2 * wj / n) for wj, gj in zip(self.w, gw)]
        return self

    def proba(self, x):
        z = [(xj - m) / s for xj, m, s in zip(x, self.mu, self.sd)]
        return 1 / (1 + math.exp(-max(-30, min(30, self.b + sum(wj * zj for wj, zj in zip(self.w, z))))))

    def to_json(self, names):
        return {"version": MODEL_VERSION, "features": names, "mu": self.mu, "sd": self.sd, "w": self.w, "b": self.b, "l2": self.l2}

    @classmethod
    def from_json(cls, j):
        m = cls(l2=j.get("l2", 1.0))
        m.mu, m.sd, m.w, m.b = j["mu"], j["sd"], j["w"], j["b"]
        return m


def vec(f):
    return [f[k] for k in FEATURES]


def wilson(h, n):
    if not n:
        return None
    z, p = 1.96, h / n
    c = (p + z * z / (2 * n)) / (1 + z * z / n)
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return [round(c - m, 4), round(c + m, 4)]
