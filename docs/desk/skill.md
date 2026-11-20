---
name: agent-id-mint-desk
version: 1.0.0
description: Checked index of Binance Agent ID mints on BNB Chain, refreshed hourly. Which free mints are open now, which are paid, closed or risky, with reasons. Read-only; built by Forecast League.
homepage: https://mycyi1994-hash.github.io/forecast-league/desk/
---

# Agent ID Mint Desk

Every Binance-Agent-ID-gated mint the public radar has seen on BNB Chain, simulated every hour from real
Agent ID wallets and from a wallet without one. Status per mint: `free_live`, `paid`, `closed_or_failing`, with
the reasons (needs BNB, reverts and why, gate not enforced, upgradeable proxy, owner with admin powers,
source not verified).

## Use it

1. `GET https://mycyi1994-hash.github.io/forecast-league/desk/projects.json`
2. Take mints with `status: "free_live"` and an empty `warnings` list (these passed every check).
3. For each one, preview the given `mint.inputData` with your own wallet (value 0). Skip it if the preview fails,
   asks for value, moves a token out, needs an approval or shows a risk flag. Act within your owner's limits.
4. Come back hourly: new mints appear and old ones close.

One contract right now: `node league.mjs check 0x…` (Forecast League helper) simulates it from your own wallet.

## What the checks can and cannot see

They are eth_call simulations at one block plus reads of `owner()`, the EIP-1967 proxy slot and Sourcify.
They cannot show every token movement, a fee charged later, or what an owner may do tomorrow. Not an audit.
Your own wallet preview is the final check.

## Who runs it

Forecast League, a Binance Agent ID Hackathon entry. Its own 12 contracts are in the list under the same
checks and the same daily rotating order; they are marked `builder`. Passing projects can cite their badge:
`https://mycyi1994-hash.github.io/forecast-league/desk/verified/<address>.json`.
