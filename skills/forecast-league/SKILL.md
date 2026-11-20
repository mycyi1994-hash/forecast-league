---
name: forecast-league
description: |
  Use when the user wants to join or play Forecast League: get the free player card, submit
  today's BTC / ETH / BNB price forecasts from their Binance Agentic Wallet, check whether they
  already submitted today, record a finished round's score, open or join a squad, or see their
  league record and card.
compatibility: Requires Node.js 18 or newer and the official binance-agentic-wallet skill (the `baw` CLI), signed in, with Developer Mode on.
license: MIT
metadata:
  version: '0.8.0'
---

# Forecast League

Agent ID holders get a free, non-transferable player card and submit one set of price forecasts
per UTC day. The card is drawn on-chain and grows with the number of forecasts: ROOKIE, then
ANALYST at 3, STRATEGIST at 8 and ORACLE at 15. A separate contract scores each forecast against
"doing nothing" (submitting the price at the daily lock time). No funds are ever sent: every call
has value 0, and the contracts cannot hold or move tokens.

This is a forecasting game. It is not financial advice, and scores and cards have no monetary value.

Tell the user who is behind it before they decide: One builder made this and entered it in the Binance Wallet x BNB Chain Agent ID Hackathon (submissions close 9 December 2026). The contest ranks entries partly by how many Agent ID wallets use them and how many transactions they send, so every call made here helps the builder's entry.

## Absolute rules

1. **Never run `baw contract-call execute` without the user's explicit "yes" to the summary you
   just showed for that exact call**, except under the standing daily instruction of rule 2. One
   preview, one confirmation, one execute. Being asked to "install", "set up" or "prepare" is not
   a confirmation.
2. **Daily play is the user's choice. Ask once,** saying what it involves: one forecast a day and
   one score call per finished round, at most 2 calls and about $0.02 of gas a day, until
   9 December 2026, and that the builder is a hackathon entrant who gains from each transaction.
   If the user tells you to play on your own, that standing instruction is their confirmation for
   exactly those two kinds of call until that date. Both send value 0, move no tokens and grant
   no approvals. Blitz (`scripts/league.mjs blitz`: one ticket per six-hour round and a claim) is
   covered only if the user said yes after being told about it and its numbers: at most 10 calls
   and about $0.10 of gas a day in all.
   You still preview every call, and you stop and ask if a preview shows any value, token
   movement, approval, risk or `requireConfirmation`. Without such an instruction, ask each time.
   The user can take the instruction back at any time.
3. **If preview fails or is blocked, stop and tell the user.** Do not change the values and try again.
4. **Only use a call produced by `scripts/league.mjs encode`, `encode-mint`, `encode-score` or
   `encode-squad`.**
   Do not write call data by hand, do not change the `to` address, and do not send a value other than 0.
5. **Never call `wallet send`, approvals, swaps or sign-in commands as part of this skill.**
6. **Never ask for, read or repeat seed phrases, private keys, API secrets or pairing codes.** If the
   wallet is not signed in, tell the user to sign in with the official Binance Agentic Wallet skill
   and stop.

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

## Check the current state

```bash
node scripts/league.mjs status --address <BSC address>
```

This reads public chain data only. It shows the current prices, when today's round locks, whether
the address already submitted today, and its record. If `submittedToday` is true, tell the user
and stop: a second submission on the same UTC day is rejected by the contract.

## Get the player card only

A holder who just wants the card, without a forecast yet, can take it with one call. Submitting a
forecast also gives the card, so skip this if the user is about to submit.

```bash
node scripts/league.mjs encode-mint --address <BSC address>
```

Then preview, show the summary, ask "Get your Forecast League card?", and execute only after a
clear yes, exactly as in the steps below. One card per Agent ID; a second attempt is rejected
(`AlreadyHasCard`).

## Submit today's forecasts

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

## What to tell the user about results

- Each round locks at 00:00 UTC. The result can be settled from 06:00 UTC by anyone (the builder's
  keeper does it daily) and is final 30 minutes after that.
- Submitting the lock price itself scores 0. A forecast closer to the final price than that scores
  up to +100, a worse one down to -100.
- Anyone can write a finished round into the record by calling the scoring contract. To do it for
  the user without waiting for someone else, see "Record a finished round" below.

## Record a finished round

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

## Squads (teams)

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
standing daily instruction of rule 2 does not cover squad calls.

## Common errors

A preview may show the error name or only its 4-byte code.

| Message | Code | Meaning | What to say |
|---|---|---|---|
| `NotAgentIdHolder` | `0xea11784e` | The wallet has no Agent ID | Claim one in the Binance App first |
| `AlreadySubmitted` | `0x9fbfc589` | Already submitted this UTC day | Come back after 00:00 UTC |
| `WrongEpoch` | `0x254f6ab2` | The call was built on one UTC day and included on another | Nothing was recorded. Tell the user. A new submission counts for the next round and needs its own preview and confirmation |
| `EmptySubmission` | `0x037cb12e` | All three forecasts were 0 | Give at least one forecast |
| `AlreadyHasCard` | `0x3222ee61` | The wallet already has its card | Nothing to do; submit a forecast instead |
| `351802` / `351804` | | Developer Mode expired or was switched off | Turn it on again in the Binance App |
| `351803` | | The wallet blocked the call as risky | Stop. Do not retry. Report it to the user |
