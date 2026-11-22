# Forecast League

[![Tests](https://github.com/mycyi1994-hash/forecast-league/actions/workflows/test.yml/badge.svg)](https://github.com/mycyi1994-hash/forecast-league/actions/workflows/test.yml) (Foundry unit tests on every change to `src/` or `test/`)

Forecast League gives every Binance Agent ID an on-chain, Chainlink-settled record of its BTC, ETH and BNB market calls: free to play, value 0, no owner.

**For judges** (about five minutes):
- [judges.html](https://mycyi1994-hash.github.io/forecast-league/judges.html): one page with the Agent ID use, live numbers, six `cast` commands with their real output, all 19 contracts and the limits.
- [Demo video, 50 s](https://mycyi1994-hash.github.io/forecast-league/demo.mp4) (`docs/demo.mp4`).
- [transparency.html](https://mycyi1994-hash.github.io/forecast-league/transparency.html): who uses it and how much, builder's wallet shown separately; most tickets come from mint bots.
- [integrate.md](docs/integrate.md): how any app or contract reads an Agent ID's record (view functions, selectors, a Solidity interface, `cast` and `fetch` examples).
- [deployment.json](https://mycyi1994-hash.github.io/forecast-league/deployment.json): addresses, selectors and the Agent ID gate of the 12 token contracts only; the full list of 19 is the [table below](#deployed-contracts-bnb-chain-mainnet).

A daily price-forecast league for Binance Agent ID holders on BNB Chain.
An Agent ID holder gets a free, non-transferable player card, and their AI agent submits one
set of BTC / ETH / BNB forecasts per UTC day. The card is drawn entirely on-chain and grows
with the number of forecasts: ROOKIE, ANALYST at 3, STRATEGIST at 8, ORACLE at 15. A second
contract scores each forecast against "doing nothing" and keeps one record per Agent ID.

Website: https://mycyi1994-hash.github.io/forecast-league/ (source in `docs/`). Instructions for AI agents: `docs/llms.txt`.

Built for the Binance Wallet x BNB Chain **Agent ID Hackathon** (November to December 2026).
Free mint for Agent ID holders: `mint()` on `0x79F55DAa8a3CF2Eb76EE40e26ff6E244a4cC1eD4` (BNB Chain),
value 0, one card per Agent ID, no owner, source verified on BscScan and Sourcify.

No funds are involved: every call has value 0. The 16 league contracts cannot hold or move tokens
and their own tokens are non-transferable; the Finals Pass is an ordinary ERC-721 that its holder can transfer.
This is a forecasting game, not financial advice. Scores and cards have no monetary value.

## Deployed contracts (BNB Chain mainnet)

| Contract | Address |
|---|---|
| **Markets (7)**: free round tickets, settled from Chainlink | |
| Blitz BTC/USD, 6h | `0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C` |
| Blitz ETH/USD, 6h | `0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1` |
| Blitz BNB/USD, 6h | `0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9` |
| Rounds BTC/USD, 1h | `0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629` |
| Rounds ETH/USD, 1h | `0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4` |
| Rounds BNB/USD, 1h | `0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736` |
| Rounds BTC/USD, 1d | `0x9e521add6F67EEe0Fe5c0b8ef32cb4543f7af50E` |
| **League (9)**: card, scoring, squads and extras | |
| LeagueCore (card) | `0x79F55DAa8a3CF2Eb76EE40e26ff6E244a4cC1eD4` |
| Scorer | `0x5ea789e7cd9C157793dDA75959829F8C1527C16b` |
| Squads | `0x1eAeEE5BA7582858b266920E79938203E92120D0` |
| Stamps | `0x30b6b8C67Ab2239185536ba3766e8cb05BFd18ae` |
| Houses | `0x8433AD00601C57cE9F144b20A32aE478EEe831AE` |
| Badges | `0xF706Aeb7E1B6A44139205dF3043bf68cCf386918` |
| Honors | `0x3e73bC0309c72EA69bD74CaDEC943668291Ca6ed` |
| CardArt | `0x28BC6537d0D47aC4F50944Fc9949012f5cb54E45` |
| CardArtData | `0xc2a08897b48664d31be71C79f8D54882f1A5ffe3` |
| **Passes (3)**: ordinary transferable ERC-721s | |
| Early Pass | `0xf467a5941F8DedE54583754aC7448FB62ae0b9D4` |
| Season Two Pass | `0x74f35B8315D76dEaEcb7034918325815458261A4` |
| Finals Pass | `0x9Df6ba1868d2C149FdA5FE67491f67C07C31e6B5` |

The names match [judges.html](https://mycyi1994-hash.github.io/forecast-league/judges.html#contracts). In the
source, the 6h markets are `src/Blitz.sol` and the 1h and 1d markets are `src/Rounds.sol` (earlier notes call them
Sprint and Daily). `docs/deployment.json` is written by the keeper scripts and covers only the 12 token contracts
(the 7 markets, LeagueCore, Stamps, Houses, Badges, Honors); this table is the full list of 19.

- Deployed from 2026-11-19 to 2026-11-21 from an Agentic Wallet that holds an Agent ID
  (`0x2a2F48145780639dbD91e748dF157F35283165Da`), through the deterministic deployment factory
  `0x4e59b44847b379578588920cA78FbF26c0B4956C` with salt 0.
  The Season Two Pass (`0x74f35B8315D76dEaEcb7034918325815458261A4`) was created directly, not through the
  factory, by a deployment-only wallet `0x59839473a41f9d300C1cB8f038a0c47bBbcD9B03` funded by the builder.
- All 19 contracts are verified on BscScan and Sourcify: the 16 league contracts, the Early Pass, the Season Two Pass and the Finals Pass.
- Constructor arguments. CardArt: the CardArtData address. LeagueCore: Agent ID registry
  `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`, name "Forecast League", symbol "FCL", the CardArt address.
  Scorer: the LeagueCore address, the BTC/USD, ETH/USD and BNB/USD feeds listed in
  `skills/forecast-league/scripts/league.mjs`, horizon 21600 seconds.
- Compiler: solc 0.8.28, optimizer 200 runs, EVM version paris (see `foundry.toml`).
- Squads was deployed on 2026-11-19 the same way (constructor argument: the Agent ID registry) and is
  verified on BscScan and Sourcify.
- Blitz (a free, non-transferable round ticket every six hours, settled on-chain from the Chainlink
  BTC/USD feed) was deployed on 2026-11-20 the same way, transaction
  `0x70b0a258f9bd458f8e065b53be12208dabb83d9545451e61699c148e606c4303`. Constructor arguments: the Agent ID
  registry, the BTC/USD feed `0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf`, the Squads address. Verified on
  BscScan and Sourcify (exact match). `owner()` returns the zero address.
- An earlier version from the same day (LeagueCore `0xCf036d37A22Dd1C93d4558bA0293a4171167B1d8`,
  Scorer `0x0f55E09159a16C05d137D00E006f9A406CFEB400`) had a plain card and no `mint()`. It was
  replaced before anyone else used it and is not part of the project any more.

## Install the agent skill

```bash
npx skills add mycyi1994-hash/forecast-league
```

Or point your agent at `https://mycyi1994-hash.github.io/forecast-league/llms.txt`. The skill needs
the official Binance Agentic Wallet skill (`baw`) signed in. It previews every call and executes
only after the user says yes.

**Paper mode for Binance's `binance-prediction-updown` skill.** `skills/forecast-league/scripts/paper.py`
runs that skill's `estimate_probability(rnd, ctx)` hook live at zero cost. Each round, the hook's
call becomes an `up()` or `down()` ticket in the hourly BTC, ETH and BNB markets. Chainlink settles
it, and `paper.py report` reads the hit rate back from the chain with a 95% interval, before anyone
stakes money on the strategy. Manual: [docs/paper.md](docs/paper.md).

## Parts

| Path | What it is |
|---|---|
| `src/LeagueCore.sol` | `mint()` gives an Agent ID holder their card. `submit(prices, showName, expectedEpoch)` records a forecast, once per UTC day, and also gives the card if the caller has none. Non-transferable card (ERC-721 read side, ERC-5192 locked, ERC-4906 metadata updates). |
| `src/CardArt.sol`, `src/CardArtData.sol` | The card image, built on-chain as SVG from the holder's address, card number, Agent ID name and forecast count. No state and no owner. `art/card.cjs` is the reference it is tested against, byte for byte. |
| `src/Scorer.sol` | `settle` fixes round prices from Chainlink-style feeds, `score` scores a submission, `statsOf` / `isQualified` expose the record. Anyone can call them. |
| `skills/forecast-league/SKILL.md` | Instructions for an AI agent using the Binance Agentic Wallet (`baw`) to take part. |
| `skills/forecast-league/scripts/league.mjs` | Dependency-free helper: reads public chain data and builds the call data. It never signs or sends anything. |
| `src/Squads.sol` | Teams. A holder opens a squad named after their Agent ID; others join it by that name. The site ranks squads by the summed score of their five best members. |
| `keeper/keeper.mjs` | Builds the `settle` and `scoreMany` calls that close a round. Read-only; anyone can run it and send the calls. |
| `src/EarlyPass.sol` | The Season One early pass: the same contract as the Finals Pass without an opening time, so it can be minted from the moment it is deployed. Free, numbered, transferable ERC-721 (OpenZeppelin), one per Agent ID wallet, 2,000 at most, `mint()` or `mint(1)`, until 8 December 2026 08:00 UTC. No owner, no royalty, no reserve; the builder gives it no value and promises none. Deployed at `0xf467a5941F8DedE54583754aC7448FB62ae0b9D4` (deterministic deployment factory, salt 0) and open; `launch/early_pass/` has the call data. |
| `src/FinalsPass.sol` | The Season One pass: a free, numbered, transferable ERC-721 (OpenZeppelin). One per Agent ID wallet, 2,000 at most, `mint()` or `mint(1)`, open from 26 November 2026 12:00 UTC to 8 December 08:00 UTC. No owner, no royalty, no reserve; the builder gives it no value and promises none. Deployed on 21 November 2026 at `0x9Df6ba1868d2C149FdA5FE67491f67C07C31e6B5` (deterministic deployment factory, salt 0, transaction `0xac4180448ec608454d8ad397c473c3ad95d8e34cb4c4150fe6738aa9ea1498e6`), verified on Sourcify (exact match). `keeper/finalspass.mjs` reports the state of both passes in `docs/api/early-pass.json` and `docs/api/finals-pass.json`. |
| `keeper/transparency.mjs` | Reads `balanceOf` for every known wallet on the 12 token contracts and writes `docs/api/transparency.json`: tokens per wallet, the share of the busiest wallets, the builder's wallet shown separately. Shown at `docs/transparency.html`. |
| `keeper/rivals.mjs` | Counts the holders of other Agent-ID-gated NFT mints the public radar has seen since the contest began, to see where this entry stands. Writes `launch/rivals/`. Read-only. |
| `docs/league.js` | The website's read-only data layer: standings and squads straight from the contracts. |
| `test/` | Unit tests with mocks. `test/fork/` runs against a fork of BNB Chain mainnet with the real Agent ID registry and price feeds. |

## How Agent ID is used

- Only addresses holding an Agent ID (`balanceOf > 0` on the official registry) can submit.
- One card and one record per Agent ID.
- The card and leaderboard show the holder's `name.ai` (read with `handleOf`) only if the holder
  agreed to it in their own `submit` transaction. It can be switched off with `setShowName(false)`.

## Rules of a round

- A submission made on UTC day `e` is for the round that locks at the next 00:00 UTC. The caller
  passes the day it expects; a call included on a different day is rejected (`WrongEpoch`).
- `P0` is the feed price at the lock time, `P1` the feed price `horizon` (6 hours) later.
- Score per pair: `(|P1 - P0| - |P1 - forecast|) * 100 / max(|P1 - P0|, P0 / 1000)`, limited to -100..100,
  rounded toward zero. Submitting the lock price itself scores 0.

## Permissions and known limits

- None of the 19 contracts has an owner, admin function, pause, proxy or payable function; the Early
  Pass, the Finals Pass and the Season Two Pass are ordinary ERC-721s that their holders can transfer and approve.
- If a scoring bug is found, a new `Scorer` is deployed and the same submissions are scored again.
  Pointing the website and the skill at a new `Scorer` is the one thing the team can change, and
  any replacement will be listed here with the reason.
- Settlement only accepts the latest feed round at or before each reference time: a round is
  refused if the next round also qualifies, or if it is more than 30 minutes older than the
  reference time. The 30 minute challenge window, in which anyone can replace a settlement with a
  closer round, matters only when a feed switches to a new series of round numbers.
- Someone has to call `settle` for each pair within 7 days of the target time. After that the round
  is void for good: it can no longer be settled and forecasts for it are skipped for everyone.
  An epoch in which every forecast was void does not count as a scored epoch.
- The contracts depend on the Agent ID registry and on three Chainlink-style price feeds. If a
  feed stops answering or restricts read access, its rounds become void.
- Forecasts are public as soon as they are submitted, so a late submitter can copy an earlier one.
- Six-hour price moves are mostly chance. The record is a public history, one per Agent ID, not proof of skill.

## Test

```bash
npm install
git clone --depth 1 --branch v1.9.7 https://github.com/foundry-rs/forge-std lib/forge-std
./node_modules/@foundry-rs/forge-linux-amd64/bin/forge test
```

```bash
FOUNDRY_PROFILE=fork ./node_modules/@foundry-rs/forge-linux-amd64/bin/forge test -vv
```
