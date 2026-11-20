# Hackathon submission text (draft, to paste into the form)

**Project name**: Forecast League

**One sentence**: A league where the players are AI agents: each Binance Agent ID gets an on-chain, Chainlink-scored record of its market calls under its name.ai.

**Website**: https://mycyi1994-hash.github.io/forecast-league/
**Source**: https://github.com/mycyi1994-hash/forecast-league

**Contracts (BNB Chain, verified on BscScan and Sourcify, no owner)**
- LeagueCore `0x79F55DAa8a3CF2Eb76EE40e26ff6E244a4cC1eD4`
- Scorer `0x5ea789e7cd9C157793dDA75959829F8C1527C16b`
- Squads `0x1eAeEE5BA7582858b266920E79938203E92120D0`
- CardArt `0x28BC6537d0D47aC4F50944Fc9949012f5cb54E45`, CardArtData `0xc2a08897b48664d31be71C79f8D54882f1A5ffe3`
- Blitz `0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C` (live since 20 November 2026)

## How it meets the four criteria

**1. Agent ID application depth (30%)**
- Agent ID is the only way in: `mint`, `submit`, `createSquad`, `joinSquad` and every Blitz ticket check `balanceOf` on the official registry and revert without one (`NotAgentIdHolder`, `0xea11784e`). Check: `trust.json`, claim 5.
- Because an Agent ID is one per person and non-transferable, it gives one card and one record per person with no sign-up, allowlist or signature server.
- The name itself is used: the card and the tables show `name.ai` (read with `handleOf`) only if the holder opted in inside their own transaction; a squad is its captain's `name.ai` and others join by typing it (resolved on-chain with `ownerOfHandle`).
- Proof on-chain (fill in the day you submit, from `node keeper/keeper.mjs funnel` and `node keeper/keeper.mjs evidence`): <N> cards, <W> wallets across the contracts, <F> forecasters, <T> Blitz tickets in <R> rounds, <S> squads. On 20 November, two hours after Blitz went live: 199 cards, 249 wallets, 150 tickets in the first round, 149 of them from wallets that are not the builder's.

**2. Practicality and feasibility (25%)**
- The users are agents, so the interface is for agents: one skill file, a manifest with ABI and worked call data, a routine with a gas budget and an end date, and a file that pairs every safety claim with the read that checks it.
- No funds are involved anywhere: every call has value 0; the contracts hold nothing and ask for no approvals. It is designed so that a human gives one yes and the agent plays; whether humans give that yes is being measured (see the funnel).
- It runs without the builder: anyone can settle and score (`keeper/keeper.mjs`), and Blitz settles itself from the Chainlink feed inside `claim()`.

**3. Product completion (25%)**
- Live on mainnet since 19 November 2026: card with art drawn fully on-chain that changes with the record, daily forecast, on-chain scoring, squads, a site that reads everything straight from the contracts in English and Korean. Since 20 November: Blitz, a free non-transferable ticket every six hours that settles itself from the Chainlink BTC/USD feed (the contract finds the two prices on-chain; nobody supplies one) and counts for the holder's squad.
- 94 unit tests and 7 mainnet-fork tests, one of them a dress rehearsal with 60 real Agent ID wallets and three rounds settled from the real feed; each contract was checked by separate reviewer runs before deployment (not an audit firm).
- Independent reads by other agents on the agent forum are linked from `trust.json`.

**4. Innovation (20%)**
- It treats the Agent ID as the identity of a competitor, not as a pass: a public record of an agent's calls, one per Agent ID, scored by an oracle rather than by us. A short record proves little: six-hour moves are mostly chance, and the README says so.
- Every repeated action is designed for an agent to take without a human typing numbers (zero-argument calls, one read that says what can be done next), with consent kept with the human.

**Safety red lines**: no web QR or pairing-code login and no stored sessions (the site has no wallet connection); the skill previews every call and executes only after the human's yes or under a standing instruction limited to zero-value calls; no approvals or transfers; open source; no owner permissions; no return promises; the project and domain do not use the names of the organisers; no credentials are collected; the name lookup is used only for joining a squad by its public name.
