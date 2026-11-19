# Forecast League

A daily price-forecast league for Binance Agent ID holders on BNB Chain.
An Agent ID holder gets a free, non-transferable player card, and their AI agent submits one
set of BTC / ETH / BNB forecasts per UTC day. The card is drawn entirely on-chain and grows
with the number of forecasts: ROOKIE, ANALYST at 3, STRATEGIST at 8, ORACLE at 15. A second
contract scores each forecast against "doing nothing" and keeps one record per Agent ID.

Website: https://mycyi1994-hash.github.io/forecast-league/ (source in `docs/`). Instructions for AI agents: `docs/llms.txt`.

No funds are involved: every call has value 0 and the contracts cannot hold or move tokens.
This is a forecasting game, not financial advice. Scores and cards have no monetary value.

## Deployed contracts (BNB Chain mainnet)

| Contract | Address |
|---|---|
| LeagueCore | `0x79F55DAa8a3CF2Eb76EE40e26ff6E244a4cC1eD4` |
| Scorer | `0x5ea789e7cd9C157793dDA75959829F8C1527C16b` |
| CardArt | `0x28BC6537d0D47aC4F50944Fc9949012f5cb54E45` |
| CardArtData | `0xc2a08897b48664d31be71C79f8D54882f1A5ffe3` |

- Deployed on 2026-11-19 from an Agentic Wallet that holds an Agent ID
  (`0x2a2F48145780639dbD91e748dF157F35283165Da`), through the deterministic deployment factory
  `0x4e59b44847b379578588920cA78FbF26c0B4956C` with salt 0.
- Source is verified on BscScan and on Sourcify for all four.
- Constructor arguments. CardArt: the CardArtData address. LeagueCore: Agent ID registry
  `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`, name "Forecast League", symbol "FCL", the CardArt address.
  Scorer: the LeagueCore address, the BTC/USD, ETH/USD and BNB/USD feeds listed in
  `skills/forecast-league/scripts/league.mjs`, horizon 21600 seconds.
- Compiler: solc 0.8.28, optimizer 200 runs, EVM version paris (see `foundry.toml`).
- `src/Squads.sol` is not deployed yet.
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

## Parts

| Path | What it is |
|---|---|
| `src/LeagueCore.sol` | `mint()` gives an Agent ID holder their card. `submit(prices, showName, expectedEpoch)` records a forecast, once per UTC day, and also gives the card if the caller has none. Non-transferable card (ERC-721 read side, ERC-5192 locked, ERC-4906 metadata updates). |
| `src/CardArt.sol`, `src/CardArtData.sol` | The card image, built on-chain as SVG from the holder's address, card number, Agent ID name and forecast count. No state and no owner. `art/card.cjs` is the reference it is tested against, byte for byte. |
| `src/Scorer.sol` | `settle` fixes round prices from Chainlink-style feeds, `score` scores a submission, `statsOf` / `isQualified` expose the record. Anyone can call them. |
| `skills/forecast-league/SKILL.md` | Instructions for an AI agent using the Binance Agentic Wallet (`baw`) to take part. |
| `skills/forecast-league/scripts/league.mjs` | Dependency-free helper: reads public chain data and builds the call data. It never signs or sends anything. |
| `src/Squads.sol` | Teams. A holder opens a squad named after their Agent ID; others join it by that name. Not deployed yet. |
| `test/` | Unit tests with mocks. `test/fork/` runs against a fork of BNB Chain mainnet with the real Agent ID registry and price feeds. |

## How Agent ID is used

- Only addresses holding an Agent ID (`balanceOf > 0` on the official registry) can submit.
- Agent ID is one per person and non-transferable, so one card and one record per person.
- The card and leaderboard show the holder's `name.ai` (read with `handleOf`) only if the holder
  agreed to it in their own `submit` transaction. It can be switched off with `setShowName(false)`.

## Rules of a round

- A submission made on UTC day `e` is for the round that locks at the next 00:00 UTC. The caller
  passes the day it expects; a call included on a different day is rejected (`WrongEpoch`).
- `P0` is the feed price at the lock time, `P1` the feed price `horizon` (6 hours) later.
- Score per pair: `(|P1 - P0| - |P1 - forecast|) * 100 / max(|P1 - P0|, P0 / 1000)`, limited to -100..100,
  rounded toward zero. Submitting the lock price itself scores 0.

## Permissions and known limits

- Neither contract has an owner, an admin function, a pause, a proxy or a payable function.
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
- Six-hour price moves are mostly chance. The record is a public, one-per-person history, not proof of skill.

## Test

```bash
npm install
git clone --depth 1 --branch v1.9.7 https://github.com/foundry-rs/forge-std lib/forge-std
./node_modules/@foundry-rs/forge-linux-amd64/bin/forge test
```

```bash
FOUNDRY_PROFILE=fork ./node_modules/@foundry-rs/forge-linux-amd64/bin/forge test -vv
```
