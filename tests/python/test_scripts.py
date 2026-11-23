"""Offline tests for the Python helpers in skills/forecast-league/scripts (no network, no wallet)."""
import importlib.util, json, os, sys, time, unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCRIPTS = os.path.join(ROOT, "skills", "forecast-league", "scripts")


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(SCRIPTS, name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


paper = load("paper")
crowd = load("crowd_hook")
rev = load("reversal_hook")
MARKET = "0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629"


def preview(code="000000000", bc=None, auth=None, risks=None, success=True):
    return {"success": success, "data": {"requestId": "r", "simulationResult": {
        "simulationCode": code, "balanceChanges": bc or [], "authorityChanges": auth or [], "allowanceChanges": []},
        "risks": {"riskDetails": risks or [], "riskBehaviors": []}}}


class Paper(unittest.TestCase):
    def test_valid_prob(self):
        self.assertEqual(paper.valid_prob(0.3), 0.3)
        for bad in (-0.1, 1.2, float("nan"), float("inf"), "x", None):
            self.assertIsNone(paper.valid_prob(bad))

    def test_addr_word(self):
        self.assertEqual(paper.addr_word("0x" + "ab" * 20), "0" * 24 + "ab" * 20)

    def test_clean_ticket_needs_exactly_one_incoming_ticket(self):
        one = [{"contractAddress": MARKET.lower(), "tokenType": "Erc721", "change": 1}]
        self.assertTrue(paper.clean(preview(bc=one), MARKET, True)[0])
        self.assertFalse(paper.clean(preview(), MARKET, True)[0])
        self.assertFalse(paper.clean(preview(bc=one + one), MARKET, True)[0])
        other = [{"contractAddress": "0x" + "1" * 40, "tokenType": "Erc721", "change": 1}]
        self.assertFalse(paper.clean(preview(bc=other), MARKET, True)[0])

    def test_clean_claim_needs_no_balance_change(self):
        self.assertTrue(paper.clean(preview(), MARKET, False)[0])
        self.assertFalse(paper.clean(preview(bc=[{"change": -1}]), MARKET, False)[0])

    def test_clean_rejects_require_confirmation(self):
        pv = preview()
        pv["data"]["requireConfirmation"] = True
        self.assertFalse(paper.clean(pv, MARKET, False)[0])

    def test_clean_rejects_failures_approvals_and_risks(self):
        self.assertFalse(paper.clean(preview(code="1"), MARKET, False)[0])
        self.assertFalse(paper.clean(preview(success=False), MARKET, False)[0])
        self.assertFalse(paper.clean(preview(auth=[{"x": 1}]), MARKET, False)[0])
        self.assertFalse(paper.clean(preview(risks=[{"x": 1}]), MARKET, False)[0])

    def test_markets_table(self):
        for name, (to, sec, sym, iv, tf) in paper.MARKETS.items():
            self.assertRegex(to, r"^0x[0-9a-fA-F]{40}$")
            self.assertIn(sec, (3600, 21600, 86400))
            self.assertTrue(sym.endswith("USDT"))


class Crowd(unittest.TestCase):
    def setUp(self):
        sec = 21600
        self.r = 83118
        crowd._cache.update(ts=time.time(), data={"markets": {"BTC 6h": [
            {"round": self.r, "up": 6, "down": 1}, {"round": self.r - 1, "up": 1, "down": 1}]}})
        self.ctx = {"cfg": {"timeframe": "6 hour", "symbol": "BTCUSDT"}, "policy": {}}
        self.start = (self.r + 1) * sec * 1000

    def test_shrunk_probability(self):
        self.assertAlmostEqual(crowd.estimate_probability({"start_ms": self.start}, self.ctx), 7 / 9)

    def test_too_few_picks_skips(self):
        self.assertIsNone(crowd.estimate_probability({"start_ms": self.start - 21600 * 1000}, self.ctx))

    def test_min_is_a_policy_key(self):
        ctx = dict(self.ctx, policy={"crowd_min": 10})
        self.assertIsNone(crowd.estimate_probability({"start_ms": self.start}, ctx))

    def test_unaligned_window_skips(self):
        self.assertIsNone(crowd.estimate_probability({"start_ms": self.start + 3600 * 1000}, self.ctx))

    def test_unknown_timeframe_skips(self):
        ctx = {"cfg": {"timeframe": "5 min", "symbol": "BTCUSDT"}, "policy": {}}
        self.assertIsNone(crowd.estimate_probability({"start_ms": self.start}, ctx))


class Reversal(unittest.TestCase):
    def test_fades_last_hour(self):
        c = {"cfg": {"timeframe": "1 hour"}, "streak": 2, "streak_dir": 1}
        self.assertEqual(rev.estimate_probability({}, c), 0.48)
        c["streak_dir"] = 0
        self.assertEqual(rev.estimate_probability({}, c), 0.52)

    def test_other_cadences_skip(self):
        self.assertIsNone(rev.estimate_probability({}, {"cfg": {"timeframe": "6 hour"}, "streak": 2, "streak_dir": 1}))
        self.assertIsNone(rev.estimate_probability({}, {"cfg": {"timeframe": "1 hour"}, "streak": None, "streak_dir": None}))


if __name__ == "__main__":
    unittest.main()
