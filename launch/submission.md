# Hackathon submission text (final draft)

Fill on submission day, then delete this block. [Brackets: 21 Nov 18:10 UTC values.]

| Placeholder | Where to read it |
|---|---|
| `{{AS_OF}}` | `updated` in `docs/api/transparency.json` |
| `{{WALLETS}}`, `{{TOKENS}}` | `wallets`, `tokens` in `docs/api/transparency.json` [421, 3,660] |
| `{{TOP10}}` | `concentration.top10SharePct` in `docs/api/transparency.json` [32.9%] |
| `{{TICKETS}}`, `{{PICKED}}`, `{{PICKED_PCT}}`, `{{PICKED_WALLETS}}` | `totals` in `docs/api/picks.json` [2,905; 57; 2%; 11 of 358] |
| `{{BUILDER}}` | `summary.all` in `docs/api/builder-agent.json` (`node keeper/builderagent.mjs`) [1 won, 10 lost, 3 waiting of 14] |
| `{{UNIT_TESTS}}` | `forge test` summary line [276 passed] |
| `{{PICKED_WON}}`, `{{PICKED_DECIDED}}`, `{{PICKED_HIT}}`, `{{PICKED_CI}}`, `{{ASSIGNED_HIT}}` | `picked` and `assigned` in `docs/api/findings.json` [22 Nov: 53; 80; 66%; 55% to 76%; 50%] |

---

**Forecast League** gives every Binance Agent ID an on-chain, Chainlink-settled record of its BTC, ETH and BNB market calls: free to play, value 0, no owner.

**Problem:** an AI agent's market calls leave no record anyone can check.
**Answer:** free round tickets (hourly, 6-hourly, daily) and a daily price forecast, gated by Agent ID and settled from Chainlink on-chain.
**Result:** one public record per Agent ID wallet that any app or contract can read.

Site: https://mycyi1994-hash.github.io/forecast-league/ · For judges (5 min): https://mycyi1994-hash.github.io/forecast-league/judges.html · Source: https://github.com/mycyi1994-hash/forecast-league

## Agent ID application depth

- Every mint checks `balanceOf > 0` on the Agent ID registry and reverts `NotAgentIdHolder()` otherwise; one ticket per Agent ID wallet per round. Check: `judges.html#check`, command 1.
- `name.ai` is used on-chain: squads are joined by typing a captain's name, resolved with `ownerOfHandle` (`src/Squads.sol#L85`); cards show `handleOf` only after the holder opts in. Check: `judges.html#agentid`.
- Other contracts already read the record on-chain: Honors mints from `recordOf` (`src/Honors.sol#L153-L167`), Houses scores members from it (`src/Houses.sol#L96-L110`), passes take their tier from league balances. Live counts: `judges.html#composable`.
- Anyone can build on it: view functions, verified selectors, a Solidity interface, `cast` and `fetch` examples in `docs/integrate.md`.
- The agent reads its next free call in one view: `todo(address)`. Check: `judges.html#check`, command 6.
- It plugs into Binance's own agent stack: paper mode runs a `binance-prediction-updown` `estimate_probability` hook live at zero cost on the hourly markets, and the record comes back from the chain with a 95% interval. `docs/paper.md`.

## Practicality and feasibility

- Agents are the users: a skill file and a dependency-free helper that prints only calls that will succeed now. A real run of the builder's agent: `judges.html#session`.
- Consent stays with the human: preview every call in the Binance Agentic Wallet, send nothing with value, approvals or `requireConfirmation`, execute only after the human's confirmation. Rules: `docs/skill.md`.
- No funds anywhere: value 0, no payable function, no approvals, no owner. Check: `judges.html#check`, command 2.
- It runs without the builder: `settle`, `claim` and `claimFor` are open to anyone; the price comes from the Chainlink feed inside the contract. Check: `judges.html#check`, command 3.
- Usage is public, weaknesses included: {{WALLETS}} Agent ID wallets hold {{TOKENS}} tokens (builder excluded, {{AS_OF}}): `transparency.html`.
- Agents get exactly the calls that succeed now, per wallet: `api/claims.json` (finished results, today's stamp, house, honors, badges), also exposed through a read-only MCP server (`mcp/`) and an OpenAPI description (`docs/openapi.json`).

## Product completion

- 19 contracts live on BNB Chain since 19 to 21 November, all verified on BscScan and Sourcify. List: `judges.html#contracts`.
- {{UNIT_TESTS}} Foundry unit tests run in CI on every change to `src/` or `test/`; mainnet-fork tests in `test/fork/` with the real registry and feeds. Badge: README; workflow: `.github/workflows/test.yml`.
- Settled results read live from the chain for every finished round. Check: `judges.html#numbers`.
- Bilingual site reading the contracts directly, an hourly public feed and a 50-second demo: `docs/demo.mp4`.
- One agent end to end, every ticket and forecast shown, good or bad: `judges.html#agent`.

## Innovation

- The Agent ID is treated as the identity of a competitor with a checkable track record, scored by an oracle rather than by the builder. Check: `judges.html#what`.
- Picked and assigned tickets are counted apart from each transaction's selector, so participation is never sold as skill: {{PICKED}} of {{TICKETS}} tickets ({{PICKED_PCT}}) were picked. Check: `judges.html#pva`, `api/picks.json`, `keeper/picks.mjs`.
- A pass whose tier is never stored: `tierOf` reads, at view time, how many league contracts its holder uses. Check: `judges.html#passes`.
- A measured answer to "do AI agents beat a coin flip?": picked tickets {{PICKED_WON}} of {{PICKED_DECIDED}} right ({{PICKED_HIT}}, 95% interval {{PICKED_CI}}) against an assigned control of {{ASSIGNED_HIT}}, from `ticket(id)`; one wallet carries most of it. `judges.html#findings`, `api/findings.json`.
- Agents vs the Binance Prediction market on the same hours: Binance's 1 hour Up prices, read hourly, next to the sides agents picked, with Brier scores. `judges.html#vsmarket`, `api/vs-market.json`.

## Honest limits

- **Mostly assigned, mostly bots.** Only {{PICKED_PCT}} of tickets were picked with `up()`/`down()`, by {{PICKED_WALLETS}} wallets; the rest are `mint()` coin flips from mint bots. A record here mostly shows attendance.
- **Concentrated.** The 10 busiest wallets hold {{TOP10}} of tokens. `transparency.html`.
- **Value 0.** No prize, reward or token. A 1 USDT/day prize was announced on 20 November and cancelled before it started; it was never paid.
- **Results mostly unclaimed.** Most finished tickets were never claimed into a record; `api/claims.json` lists the calls, but sending them is up to each agent.
- **Passes did not bring many players.** Of 140 wallets that met the league through a pass, 5 (3.6%) used a league contract afterwards (21 Nov 17:46 UTC). `judges.html#passes`.
- **The builder's own agent does badly:** {{BUILDER}}; its daily forecasts total -600 over 2 scored days. `judges.html#agent`.
- **Composability is internal so far.** The contracts that read the record are this project's; no outside project uses it yet. Squads has one squad, the builder's.
- **Unaudited and unfixable in place.** Tests and separate reviewer runs, no audit firm; no owner or proxy, so a fix is a new contract.

## Contracts (19, BNB Chain)

On the form: the 16 league contracts. Add the 3 passes before sending (see `launch/owner_checklist.md`, item 0), and check that the form shows all 19.

- Markets: Blitz 6h BTC `0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C`, ETH `0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1`, BNB `0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9`; Rounds 1h BTC `0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629`, ETH `0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4`, BNB `0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736`; Rounds 1d BTC `0x9e521add6F67EEe0Fe5c0b8ef32cb4543f7af50E`
- League: LeagueCore `0x79F55DAa8a3CF2Eb76EE40e26ff6E244a4cC1eD4`, Scorer `0x5ea789e7cd9C157793dDA75959829F8C1527C16b`, Squads `0x1eAeEE5BA7582858b266920E79938203E92120D0`, Stamps `0x30b6b8C67Ab2239185536ba3766e8cb05BFd18ae`, Houses `0x8433AD00601C57cE9F144b20A32aE478EEe831AE`, Badges `0xF706Aeb7E1B6A44139205dF3043bf68cCf386918`, Honors `0x3e73bC0309c72EA69bD74CaDEC943668291Ca6ed`, CardArt `0x28BC6537d0D47aC4F50944Fc9949012f5cb54E45`, CardArtData `0xc2a08897b48664d31be71C79f8D54882f1A5ffe3`
- Passes (to add): Early `0xf467a5941F8DedE54583754aC7448FB62ae0b9D4`, Season Two `0x74f35B8315D76dEaEcb7034918325815458261A4`, Finals `0x9Df6ba1868d2C149FdA5FE67491f67C07C31e6B5`

**Safety:** no wallet connection on the site, no credentials collected, no approvals, no owner, no return promises; not affiliated with Binance.
