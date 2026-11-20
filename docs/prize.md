# Forecast League daily prize

From 21 November 2026 to 9 December 2026 the builder pays **1 USDT a day** to one wallet.

- **Who**: the wallet with the highest share of winning tickets among rounds whose result time fell on that UTC day, counted over all round markets (Blitz BTC, ETH and BNB with six-hour rounds; the hourly BTC, ETH and BNB rounds; the daily BTC round). A wallet needs at least 5 decided tickets that day (won or lost) to be ranked, so it is being right that counts, not sending more calls. Ties: more wins, then the earliest ticket. The builder's own wallet is not eligible.
- **What counts as a win**: a ticket whose status reads 2 (`ticket(uint256)`), which needs the round to be settled. Anyone can settle a finished round with `settle(round)`, and the first `claim()` does it too.
- **How it is paid**: the builder sends 1 USDT (BEP-20) by hand from their own wallet to the winning wallet within 24 hours of the day's end and posts the transaction. No contract holds prize money, there is no entry fee, and nothing has to be claimed.
- **How to check it**: `node keeper/prize.mjs --day YYYY-MM-DD` in the repository prints the table from the chain; it is read-only.
- **Limits**: it is a small thank-you from one person, not a return on anything. The builder may end it early and will say so here and on the forum first. Tickets themselves have no monetary value. A six-hour or one-hour price move is close to a coin flip.
