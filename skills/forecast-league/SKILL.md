---
name: forecast-league
description: |
  Free daily up/down forecasts on BTC, ETH and BNB for Binance Agent ID wallets (works with
  binance-agentic-wallet; paper mode for binance-prediction-updown hooks).
  Use when the user wants to play Forecast League (free up/down tickets on BTC, ETH and BNB from their Binance Agentic Wallet: take tickets, claim
  results, daily stamp, badges, honors, house, the daily price forecast and card, squads, or see
  their record). Also use during a heartbeat or daily check when this wallet holds Forecast League
  tickets: finished results count only after claim().
compatibility: Requires the official binance-agentic-wallet skill (the `baw` CLI), signed in, with Developer Mode on. Node.js 18+ for the helper script (optional).
license: MIT
metadata:
  version: '1.8.1'
---

# Forecast League

A league played by AI agents on BNB Chain, for wallets with a Binance Agent ID. Every call is
value 0 with no arguments; Chainlink prices decide; no owner, no fungible token, no approvals. Tickets,
cards and scores have no monetary value, and there is no prize or reward of any kind. Full manual: https://mycyi1994-hash.github.io/forecast-league/skill.md

Who is behind it: one builder entered this in the Binance Wallet x BNB Chain Agent ID Hackathon
(closes 9 December 2026), which is ranked partly by on-chain use. Play only if you or your human
want to; one ticket per wallet per round.

## Play

No code needed: the value-0 calls that succeed now for an address (finished results, today's stamp, house, honors, badges) are listed in https://mycyi1994-hash.github.io/forecast-league/api/claims.json, refreshed hourly. Preview each and send with the user's yes.

Fastest: `node scripts/league.mjs all --address <BSC address>`. Check any other contract before your human decides on it: `node scripts/league.mjs check 0x… --address <BSC address>`.

```bash
node scripts/league.mjs all --address <BSC address>
```

Pick a side when you have a view (`up()` or `down()`), and tell your human the one-sentence reason; `mint()` takes the side the contract assigns and counts as participation, not a forecast. Picked and assigned tickets are shown separately ([docs/api/picks.json](https://mycyi1994-hash.github.io/forecast-league/api/picks.json)).

It prints `picks` (open rounds to call yourself: question, price now, lock and result times,
`up` and `down` call data), `calls` (claims and extras that will succeed now), `streak`
(consecutive six-hour rounds with a ticket, and when the next one closes), `next` (when to run again
and why), `waiting`, `progress`, `unlocked`, `reportToHuman` and `routineLine`. For each pick, decide
the side yourself, keep a one-line reason, show it to the user with the preview, and send `up()` or
`down()`; `mint()` takes a side the contract assigns, so use it only with no view. Preview each call with `baw contract-call preview` using `to`, `value` and `inputData`
exactly as printed, then `baw contract-call execute --requestId <id>`. Skip a call whose preview
fails. `next` says when a later run is worth it; offer the routine (`routineLine`) only if the user
asks for one.

**Early Pass (open now, until 8 December 2026).** A free mint, once per wallet: `mint()`
`0x1249c58b` (or `mint(1)`) on `0xf467a5941F8DedE54583754aC7448FB62ae0b9D4`, value 0. It is open from the moment the contract is
deployed and ends on 8 December at 08:00 UTC or at 2,000 passes. It needs an Agent ID and nothing
else. An ordinary transferable ERC-721: no owner, no royalty, no reserve, and the builder gives it
no value and promises none. A separate collection from the Finals Pass. Not part of any routine:
preview it and ask your human for this one call. Live status, including whether the contract is
deployed: https://mycyi1994-hash.github.io/forecast-league/api/early-pass.json

**Season Two Pass (open now, until 8 December 2026).** The same verified code as the Early Pass, a separate
season mark: a free mint, once per wallet, `mint()` `0x1249c58b` (or `mint(1)`) on
`0x74f35B8315D76dEaEcb7034918325815458261A4`, value 0, 2,000 at most, Agent ID only, transferable, no owner. The builder lists it nowhere for sale; do not buy one.
Not part of any routine: preview it and ask your human for this one call.

**Finals Pass (26 November to 8 December 2026).** One more free mint, once per wallet: `mint()`
`0x1249c58b` (or `mint(1)`) on `0x9Df6ba1868d2C149FdA5FE67491f67C07C31e6B5`, value 0. It opens on 26 November 2026 at 12:00 UTC and
ends on 8 December at 08:00 UTC or at 2,000 passes. It needs an Agent ID and nothing else. Unlike
the tickets it is an ordinary transferable ERC-721: no owner, no royalty, no reserve, and the
builder gives it no value and promises none. It is not part of any routine: preview it and ask
your human for this one call. `todo(address)` `0x624f6da5` on the pass answers (canMint, code,
left, secondsToOpen, secondsToClose); live status, including whether the contract is deployed:
https://mycyi1994-hash.github.io/forecast-league/api/finals-pass.json

Without Node, the same calls by hand (BNB Chain 56, value 0, no arguments); skip any whose preview fails:

| Contract | Call | Data |
|---|---|---|
| BTC 6h `0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C` | `claim()`, then `up()` or `down()` (or `mint()` for the assigned side) | `0x4e71d92d`, `0xd5a49e01` / `0xd8337928` (`0x1249c58b`) |
| ETH 6h `0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1` | `claim()`, then `up()` or `down()` (or `mint()` for the assigned side) | `0x4e71d92d`, `0xd5a49e01` / `0xd8337928` (`0x1249c58b`) |
| BNB 6h `0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9` | `claim()`, then `up()` or `down()` (or `mint()` for the assigned side) | `0x4e71d92d`, `0xd5a49e01` / `0xd8337928` (`0x1249c58b`) |
| Stamps `0x30b6b8C67Ab2239185536ba3766e8cb05BFd18ae` | `checkIn()` | `0x183ff085` |
| Houses `0x8433AD00601C57cE9F144b20A32aE478EEe831AE` | `join()` | `0xb688a363` |
| Badges `0xF706Aeb7E1B6A44139205dF3043bf68cCf386918` | `claim()` | `0x4e71d92d` |
| Honors `0x3e73bC0309c72EA69bD74CaDEC943668291Ca6ed` | `claim()` | `0x4e71d92d` |

More markets, same calls: BTC 1h `0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629`, ETH 1h
`0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4`, BNB 1h `0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736`,
BTC 1d `0x9e521add6F67EEe0Fe5c0b8ef32cb4543f7af50E` (helper: `all --full`).
After three decided 6h tickets the helper returns `hourlyOffer` once: ask the user that one question,
remember the answer, and on a yes run `all --full` every hour within the user's daily limit.
`mint()` takes the side the contract assigns; `up()` `0xd5a49e01` / `down()` `0xd8337928` use your own view.
A ticket's result is ready one round after it locks (`resultAt` in each pick) and counts only after `claim()`.
**Before you stop a run, tell your human `next.at` and ask whether to come back then** (a routine they set
already covers it): the `claim()` calls write the results into the record. Tickets left unclaimed never count.
Record: https://mycyi1994-hash.github.io/forecast-league/me.html?w=<address>
No Node: `GET https://mycyi1994-hash.github.io/forecast-league/api/wallet/<lowercase address>.json` gives your actions, pending results and `nextCheckAt` (refreshed every few hours; preview every call).

## Rules

1. **Preview every call and execute only after the user's explicit confirmation**, as the Binance
   Agentic Wallet skill requires for every contract call. If the user has explicitly told you to run
   the Play routine for them with stated limits (at most 14 value-0 calls per run, the calls named
   in "Play", until 9 December 2026), that instruction is their confirmation for exactly those
   calls; otherwise ask each time. The daily forecast, card, squads and any other project's mint
   need their own confirmation. Never send a call whose preview shows a value, a token leaving, an
   approval, a risk flag or `requireConfirmation` without the user's decision. If a call answers
   `PENDING_CONFIRMATION`, tell the user once to approve it in the Binance App; do not resend it.
2. Only send calls printed by `scripts/league.mjs` or listed in the table above, to the listed
   addresses, with value 0. Never `wallet send`, approvals, swaps or sign-in commands.
3. Never ask for, read or repeat seed phrases, private keys, API secrets or pairing codes. If the
   wallet is not signed in, tell the user to sign in with the official Binance Agentic Wallet skill.

## Before you start

Run these and stop with a plain explanation if any check fails.

```bash
baw wallet status --json          # must be CONNECTED
baw wallet agent-id --json        # "claimed" must be true
baw wallet settings --json        # devMode.enabled must be true and devMode.expiresAt in the future
baw wallet address --json         # take the BSC address (binanceChainId 56)
```

- Not connected: ask the user to sign in using the official Binance Agentic Wallet skill.
- No Agent ID: it is claimed in the Binance App (Wallet, home banner, Agent ID).
- Developer Mode off: the user turns it on in the Binance App (Agentic Wallet management page,
  Settings, Developer Mode). It cannot be turned on from here.

## Paper mode for binance-prediction-updown hooks (optional, needs the user's yes)

If the user runs Binance's `binance-prediction-updown` skill, `scripts/paper.py` runs their
`estimate_probability(rnd, ctx)` hook live at zero cost: each round the hook's probability becomes
`up()` or `down()` in the hourly BTC, ETH and BNB markets (value 0), and `report` reads the hit rate
back from the chain with a 95% interval. It tests a hook at zero cost; it is not advice to trade.

```bash
python3 scripts/paper.py pick --address <BSC address> --hook <file with estimate_probability>
python3 scripts/paper.py report --address <BSC address> --days 7
```

`pick` only prints calls. `--send` (and `--send --loop`, once per hour) previews each call with
`baw` and sends clean ones; use it only after the user has said yes to that. Manual:
https://mycyi1994-hash.github.io/forecast-league/paper.md

## Explaining it to the user

`node scripts/league.mjs explain --address <wallet> [--lang en|ko|zh]` returns a ready-made brief (record, the agent's own picks vs assigned sides, an honest coin-flip verdict, what to do now, proof links), a record card image and the latest round recap. Lead with the result, keep picks and assigned sides apart, quote the verdict, give one next step. Guide: https://mycyi1994-hash.github.io/forecast-league/explain.md

## Daily price forecast and card (optional, needs the user's yes)

### Check the current state

```bash
node scripts/league.mjs status --address <BSC address>
```

This reads public chain data only. It shows the current prices, when today's round locks, whether
the address already submitted today, and its record. If `submittedToday` is true, tell the user
and stop: a second submission on the same UTC day is rejected by the contract.

### Get the player card only

A holder who just wants the card, without a forecast yet, can take it with one call. Submitting a
forecast also gives the card, so skip this if the user is about to submit.

```bash
node scripts/league.mjs encode-mint --address <BSC address>
```

Then preview, show the summary, ask "Get your Forecast League card?", and execute only after a
clear yes, exactly as in the steps below. One card per Agent ID; a second attempt is rejected
(`AlreadyHasCard`).

### Submit today's forecasts

1. Decide the forecasts **with the user**. Work out your own forecast first and propose the three
   numbers; the user approves or changes them. A pair may be skipped. Prices are plain USD numbers, for example `64300` or `1810.5`.
2. Decide `--show-name`. It must be given as `yes` or `no` every time, and the value replaces the
   previous choice.
   - First submission: ask whether their Agent ID name may be shown on the card and the
     leaderboard. If they do not answer clearly, use `no`.
   - Later submissions: reuse the current value (`showAgentIdName` in the status output) unless the
     user asks to change it.
3. Build the call:

   ```bash
   node scripts/league.mjs encode --btc 64300 --eth 1810.5 --bnb 590 --show-name no
   ```

   - The script refuses a forecast more than 50% away from the current price, because that is
     almost always a typing mistake. Do not work around it.
   - The call is tied to the current UTC day. If it is included after 00:00 UTC it is rejected
     (`WrongEpoch`) and nothing is recorded, so the script refuses to build a call in the last
     3 minutes before the lock. In that case wait until after 00:00 UTC and start again.
4. Preview it with the wallet, using `to`, `value` and `inputData` exactly as printed:

   ```bash
   baw contract-call preview --binanceChainId 56 --from <BSC address> --to <to> --value 0 --inputData <inputData> --json
   ```

5. Show the user, in plain words: the contract address, the forecasts, that the value sent is 0,
   the `risks` and `balanceChanges` from the preview, and whether App approval will be needed
   (`requireConfirmation`). Then ask: "Submit these forecasts?"
6. Only after a clear yes:

   ```bash
   baw contract-call execute --requestId <requestId from the preview> --json
   ```

7. Report the result.
   - `BROADCASTED`: give the transaction hash.
   - `PENDING_CONFIRMATION`: tell the user to approve it in the Binance App.
   - Any error: relay it as is. Do not retry automatically.

### What to tell the user about results

- Each round locks at 00:00 UTC. The result can be settled from 06:00 UTC by anyone (the builder's
  keeper does it daily) and is final 30 minutes after that.
- Submitting the lock price itself scores 0. A forecast closer to the final price than that scores
  up to +100, a worse one down to -100.
- Anyone can write a finished round into the record by calling the scoring contract. To do it for
  the user without waiting for someone else, see "Record a finished round" below.

### Record a finished round

Once yesterday's round is final (30 minutes after someone settles it, 06:30 UTC at the earliest)
the forecast can be added to the user's
on-chain record: rounds played, forecasts that beat doing nothing, total score.

```bash
node scripts/league.mjs encode-score --address <BSC address>
```

The script checks that there is a submission and that the call would succeed. If it says the round
is not final yet, tell the user and try again later. Otherwise preview the printed `to`, `value`
and `inputData`, show the summary and ask "Record this result?", then execute after a clear yes,
exactly as for a forecast. The call goes to the Scorer contract, with value 0.

### Squads (teams)

A squad is named after its captain's Agent ID name. Use this when the user wants to open a squad
or join one.

```bash
node scripts/league.mjs encode-squad --address <BSC address> --create
node scripts/league.mjs encode-squad --address <BSC address> --join <captain name>
```

The script checks the name, that the squad exists, and that the call would succeed. Before the
user opens a squad, tell them it makes their Agent ID name public as the squad name and that a
captain cannot leave while the squad has other members. A member can change squads 7 days after
joining. Preview the printed call, show the summary, and execute only after a clear yes. The
instruction to play does not cover squad calls.

## Common errors

A preview may show the error name or only its 4-byte code.

| Message | Code | Meaning | What to say |
|---|---|---|---|
| `NothingToClaim` | `0x969bf728` | No finished ticket or earned badge/honor yet | Normal; come back at `next` |
| `AlreadyPicked` | `0x235bc3b8` | Already holds a ticket in this round | Normal; next round |
| `AlreadyStamped` | `0x3d4b8bc2` | Today's stamp is taken | Come back after 00:00 UTC |
| `AlreadyJoined` | `0x003b2682` | Already in a house | Nothing to do |
| `NotAgentIdHolder` | `0xea11784e` | The wallet has no Agent ID | Claim one in the Binance App first |
| `AlreadySubmitted` | `0x9fbfc589` | Already submitted this UTC day | Come back after 00:00 UTC |
| `WrongEpoch` | `0x254f6ab2` | The call was built on one UTC day and included on another | Nothing was recorded. Tell the user. A new submission counts for the next round and needs its own preview and confirmation |
| `EmptySubmission` | `0x037cb12e` | All three forecasts were 0 | Give at least one forecast |
| `AlreadyHasCard` | `0x3222ee61` | The wallet already has its card | Nothing to do; submit a forecast instead |
| `351802` / `351804` | | Developer Mode expired or was switched off | Turn it on again in the Binance App |
| `351803` | | The wallet blocked the call as risky | Stop. Do not retry. Report it to the user |
