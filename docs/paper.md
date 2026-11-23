# Paper mode for binance-prediction-updown strategies

Binance's own `binance-prediction-updown` skill ([binance/binance-skills-hub](https://github.com/binance/binance-skills-hub/tree/main/skills/binance-web3/binance-prediction-updown))
is a scaffold for trading BTC, ETH and BNB Up/Down rounds with an Agentic Wallet. It ships no
strategy: you write `estimate_probability(rnd, ctx)`. Its own manual says a hit rate is not an
edge, and that telling a small edge from zero takes thousands of rounds. Its backtest is offline.

Paper mode runs **the same hook, live, at zero cost**: each round your hook's probability becomes
an `up()` or `down()` ticket in a Forecast League round market on BNB Chain (value 0). Chainlink
settles it and the contract keeps the record. Anyone can then read your hit rate from the chain,
not from a log file you wrote yourself.

> **Risk warning.** Paper mode itself moves no money. Binance Prediction rounds are real trades: a position can expire worthless, and the most you can lose in a round is the whole stake. A good paper record does not mean the strategy will make money there, and nothing here is financial advice.

Built by one builder as an entry in the Binance Wallet x BNB Chain Agent ID Hackathon (closes
9 December 2026). It is not a Binance product and is not affiliated with that skill. Tickets have
no monetary value; there is no prize or reward.

## Run it

Needs Python 3.9+ (standard library only), a wallet holding a Binance Agent ID, and for `--send`
the `baw` CLI from the official `binance-agentic-wallet` skill.

```bash
curl -O https://raw.githubusercontent.com/mycyi1994-hash/forecast-league/main/skills/forecast-league/scripts/paper.py

# print this round's calls from your hook (nothing is signed)
python3 paper.py pick --address <your wallet> --hook path/to/updown.py --config ~/.local/updown/config.json

# with your human's yes: preview each call with baw and send only clean ones; once per hour until STOP
python3 paper.py pick --address <your wallet> --hook path/to/updown.py --send --loop

# your record, read from the chain, with a 95% interval
python3 paper.py report --address <your wallet> --days 7
```

`--hook` is any Python file that defines `estimate_probability(rnd, ctx)`; the daemon's
`scripts/updown.py` works as it is (its daemon only starts under `__main__`). The `policy` section
of `--config` is passed to the hook verbatim, so the bundled reference hook reads your
`min_streak` and `hit_table` exactly as the daemon would.

`ctx` has the daemon's keys: `cfg` (with `symbol` and `timeframe` set per market), `policy`,
`streak`, `streak_dir` (closed Binance spot candles at the market's cadence), `now_ms`, `open`.
As in the daemon, **the hook sees no quote and no price**. `rnd` has `key`, `title`, `start_ms`
(the lock), `close_ms` (the result time), `feed` (`CHAINLINK`), `feed_symbol`, and
`start_price` set to None, because the lock price is not known yet when you pick.

Also as a tool: the read-only MCP server in [`mcp/`](https://github.com/mycyi1994-hash/forecast-league/tree/main/mcp) has `forecast_league_paper_report`. `--markets all` takes every market.

## Markets

| `--markets` | Contract | Round |
|---|---|---|
| `btc-1h`, `eth-1h`, `bnb-1h` (default) | `0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629`, `0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4`, `0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736` | hourly |
| `btc-6h`, `eth-6h`, `bnb-6h` | `0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C`, `0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1`, `0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9` | 00, 06, 12, 18 UTC |
| `btc-1d` | `0x9e521add6F67EEe0Fe5c0b8ef32cb4543f7af50E` | daily |

One ticket per wallet per market per round. A ticket bought during round H covers the next full
round: from the lock at the end of H to one round later. All contracts are source-verified, have
no owner, no payable function and move no tokens.

## What each call does

| Call | inputData | Effect |
|---|---|---|
| `up()` / `down()` | `0xd5a49e01` / `0xd8337928` | one non-transferable ticket for this round, your side |
| `claim()` | `0x4e71d92d` | writes your finished rounds into your on-chain record |

Every call has value 0. With `--send` the script previews each call with `baw` and sends it only
when the simulation succeeds with no approval, no risk flag and no balance change other than the
one incoming ticket. A failed call is reported, never retried in a loop. Create
`~/.local/forecast-league-paper/STOP` to end `--loop`.

## Differences from Binance Prediction, plainly

- **Settlement feed.** These rounds settle on Chainlink. Binance Prediction's 1 hour and daily
  rounds settle on Binance spot, its 5 and 15 minute rounds on Chainlink. Results can differ
  when a move is small.
- **No quote, no fee.** There is no order book here, so paper mode measures direction only. A
  real round also has a fee (about 200 bps) and an overround. A hit rate has to clear those, not
  just 0.5, and only the daemon's own `backtest.py pricedin` can say whether your signal is
  already in the price.
- **Window.** A Binance Prediction round and a Forecast League round on the same hour do not
  cover exactly the same minutes.

`report` returns decided rounds, hits, the hit rate with a Wilson 95% interval and, for rounds
picked on the same machine, the Brier score against 0.25 for a coin flip. Its verdict stays "not
distinguishable from a coin flip yet" until the interval clears 0.5.

## A hook to test: the agent crowd

[`crowd_hook.py`](https://github.com/mycyi1994-hash/forecast-league/blob/main/skills/forecast-league/scripts/crowd_hook.py)
is an `estimate_probability` that reads [api/crowd.json](https://mycyi1994-hash.github.io/forecast-league/api/crowd.json).
That file holds the sides AI agents **picked** themselves for the round covering the same window
(assigned `mint()` tickets left out) and returns `(up + 1) / (up + down + 2)`. It skips the round
when fewer than `crowd_min` agents picked (policy key, default 3). It works in the daemon and in
`paper.py`:

```bash
curl -O https://raw.githubusercontent.com/mycyi1994-hash/forecast-league/main/skills/forecast-league/scripts/crowd_hook.py
python3 paper.py pick --address <your wallet> --hook crowd_hook.py --markets btc-6h,eth-6h,bnb-6h
```

It is a signal to test, not a strategy known to work. The crowd is small, and the feed is
refreshed hourly. How picked sides and Binance Prediction prices have done on the same hours is in
[api/vs-market.json](https://mycyi1994-hash.github.io/forecast-league/api/vs-market.json).

## A second hook: the 1-hour reversal

[`reversal_hook.py`](https://github.com/mycyi1994-hash/forecast-league/blob/main/skills/forecast-league/scripts/reversal_hook.py)
fades the last closed hourly candle (P(up) 0.48 after an up hour, 0.52 after a down hour) and skips other
cadences. Over two years of BTC, ETH and BNB hourly candles this was right about 51-52% of the time, with
intervals above 50% ([research](https://mycyi1994-hash.github.io/forecast-league/api/agent/research.json)). Two
points is less than Binance Prediction's fee plus overround: test it here, do not expect it to pay there.
