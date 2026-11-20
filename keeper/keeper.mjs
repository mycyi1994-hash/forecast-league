#!/usr/bin/env node
// Forecast League keeper helper. Node 18+, no dependencies.
//
// Builds the calls that close a round: three `settle` calls (one per price feed) and the
// `scoreMany` calls that write every submitter's result into the record. Anyone can run it
// and anyone can send the calls it prints: the contracts have no owner.
//
// It only reads public chain data and prints call data. It never signs or sends anything.
//
//   node keeper/keeper.mjs settle [--epoch N]     calls to settle a round (after 06:00 UTC)
//   node keeper/keeper.mjs score  [--epoch N]     calls to score it (30 minutes after settling)
//   node keeper/keeper.mjs blitz                  settle calls for finished Blitz rounds that have tickets
//   node keeper/keeper.mjs funnel                 how far card holders go: forecasts, squads (read-only)
//   node keeper/keeper.mjs evidence               what wallets other than the builder's have done (read-only)

const CORE = '0x79F55DAa8a3CF2Eb76EE40e26ff6E244a4cC1eD4';
const SCORER = '0x5ea789e7cd9C157793dDA75959829F8C1527C16b';
const MULTICALL = '0xcA11bde05977b3631167028862bE2a173976CA11';
const FEEDS = [
  ['BTC/USD', '0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf'],
  ['ETH/USD', '0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e'],
  ['BNB/USD', '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE'],
];
const BLITZ = '0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C'; // Blitz, BTC/USD market
// Blitz markets: the same contract code, one per Chainlink feed. An empty address is a market that is not open.
const BLITZ_ETH = '0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1';
const BLITZ_BNB = '0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9';
const MARKETS = [['BTC', BLITZ], ['ETH', BLITZ_ETH], ['BNB', BLITZ_BNB]].filter(([, a]) => a && !/^0x0+$/.test(a));
const RPC = process.env.LEAGUE_RPC || 'https://bsc-rpc.publicnode.com';
const HORIZON = 21600;
const SEL = {
  latestRoundData: '0xfeaf968c', getRoundData: '0x9a6fc8f5', settle: '0xc80a7692', scoreMany: '0xb65eeffc',
  totalCards: '0xe994c15d', ownerOf: '0x6352211e', submissionOf: '0x044e613c', scored: '0xa86c3b41',
  roundOf: '0xdba20268', aggregate3: '0x82ad56cb',
};
const SCORE_BATCH = 100;

const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.slice(2).toLowerCase().padStart(64, '0');
const slot = (hex, i) => BigInt('0x' + (hex.slice(2 + i * 64, 2 + (i + 1) * 64) || '0'));

async function rpc(method, params) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const body = await res.json();
      if (body.error) throw Object.assign(new Error(body.error.message), { data: body.error.data, revert: true });
      return body.result;
    } catch (e) {
      if (e.revert || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}
const call = (to, data, from) => rpc('eth_call', [from ? { from, to, data } : { to, data }, 'latest']);

function encodeAggregate3(calls) {
  const heads = []; const bodies = []; let offset = calls.length * 32;
  for (const c of calls) {
    const data = c.data.slice(2); const len = data.length / 2;
    const body = addrWord(c.to) + word(1) + word(0x60) + word(len) + data.padEnd(Math.ceil(len / 32) * 64, '0');
    heads.push(word(offset)); bodies.push(body); offset += body.length / 2;
  }
  return SEL.aggregate3 + word(0x20) + word(calls.length) + heads.join('') + bodies.join('');
}
function decodeAggregate3(hex) {
  const h = hex.slice(2); const at = (pos) => parseInt(h.substr(pos * 2, 64), 16);
  const base = at(0); const n = at(base); const start = base + 32; const out = [];
  for (let i = 0; i < n; i++) {
    const el = start + at(start + i * 32); const dataPos = el + at(el + 32);
    out.push(at(el) === 1 ? '0x' + h.substr((dataPos + 32) * 2, at(dataPos) * 2) : null);
  }
  return out;
}
async function multicall(calls) {
  const out = [];
  for (let i = 0; i < calls.length; i += 250) {
    out.push(...decodeAggregate3(await call(MULTICALL, encodeAggregate3(calls.slice(i, i + 250)))));
  }
  return out;
}

/** A feed round's update time, or 0 if the round does not exist. */
async function updatedAt(feed, roundId) {
  try {
    const r = await call(feed, SEL.getRoundData + word(roundId));
    return slot(r, 1) > 0n ? Number(slot(r, 3)) : 0;
  } catch { return 0; }
}

/** The feed round with the latest update time at or before `time`, searched inside the current phase. */
async function roundAt(feed, time) {
  const latest = slot(await call(feed, SEL.latestRoundData), 0);
  const phase = latest >> 64n << 64n;
  let hi = latest; let lo = phase + 1n;
  if ((await updatedAt(feed, hi)) <= time) return hi;
  if ((await updatedAt(feed, lo)) > time) throw new Error('The reference time is before this feed phase. Settle by hand.');
  // Invariant: updatedAt(lo) <= time < updatedAt(hi)
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    const t = await updatedAt(feed, mid);
    if (t === 0) throw new Error(`Feed round ${mid} is missing. Settle by hand.`);
    if (t <= time) lo = mid; else hi = mid;
  }
  return lo;
}

async function chainTime() {
  return Number(BigInt((await rpc('eth_getBlockByNumber', ['latest', false])).timestamp));
}
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i++; } else out._.push(argv[i]);
  }
  return out;
}
function print(obj) { console.log(JSON.stringify(obj, null, 2)); }
function fail(message) { print({ ok: false, error: message }); process.exit(1); }

/** Addresses that submitted a forecast in an epoch, and which of them are not in the record yet. */
async function submitters(epoch) {
  const total = Number(slot(await call(CORE, SEL.totalCards), 0));
  const owners = (await multicall(Array.from({ length: total }, (_, i) => ({ to: CORE, data: SEL.ownerOf + word(i + 1) }))))
    .map((r) => '0x' + r.slice(26));
  const res = await multicall(owners.flatMap((o) => [
    { to: CORE, data: SEL.submissionOf + addrWord(o) + word(epoch) },
    { to: SCORER, data: SEL.scored + addrWord(o) + word(epoch) },
  ]));
  const submitted = owners.filter((_, i) => slot(res[i * 2], 3) !== 0n);
  const todo = owners.filter((_, i) => slot(res[i * 2], 3) !== 0n && slot(res[i * 2 + 1], 0) === 0n);
  return { cards: total, submitted, todo };
}

async function cmdSettle(epoch, now) {
  const lockAt = (epoch + 1) * 86400; const targetAt = lockAt + HORIZON;
  if (now <= targetAt) fail(`Too early. Epoch ${epoch} can be settled after ${new Date(targetAt * 1000).toISOString()}.`);
  const { submitted } = await submitters(epoch);
  if (submitted.length === 0) {
    print({ ok: true, action: 'settle', epoch, submitted: 0, calls: [], note: 'Nobody submitted a forecast in this epoch, so there is nothing to settle.' });
    return;
  }
  const calls = [];
  for (let f = 0; f < FEEDS.length; f++) {
    const [pair, feed] = FEEDS[f];
    const existing = await call(SCORER, SEL.roundOf + word(epoch) + word(f));
    if (slot(existing, 4) !== 0n) { calls.push({ pair, skipped: 'already settled' }); continue; }
    const rl = await roundAt(feed, lockAt); const rt = await roundAt(feed, targetAt);
    const inputData = SEL.settle + word(epoch) + word(f) + word(rl) + word(rt);
    let simulation = 'ok';
    try { await call(SCORER, inputData); } catch (e) { simulation = `would fail: ${e.message} ${e.data || ''}`; }
    calls.push({
      pair, to: SCORER, value: '0', inputData, simulation,
      lockRound: { id: rl.toString(), updatedAt: new Date((await updatedAt(feed, rl)) * 1000).toISOString() },
      targetRound: { id: rt.toString(), updatedAt: new Date((await updatedAt(feed, rt)) * 1000).toISOString() },
    });
  }
  print({ ok: true, action: 'settle', epoch, submitted: submitted.length, lockAt: new Date(lockAt * 1000).toISOString(), targetAt: new Date(targetAt * 1000).toISOString(), calls });
}

async function cmdScore(epoch) {
  const { cards, submitted, todo } = await submitters(epoch);
  // scoreMany skips addresses it cannot score, so its simulation succeeds even when nothing
  // would be written. Check that every pair of the round is final before offering the calls.
  const finals = await Promise.all([0, 1, 2].map(async (f) => slot(await call(SCORER, SEL.roundOf + word(epoch) + word(f)), 5) === 1n));
  if (!finals.every(Boolean)) {
    print({ ok: true, action: 'score', epoch, cards, submitted: submitted.length, alreadyScored: submitted.length - todo.length, calls: [],
      note: 'The round is not final yet for every pair. Settle it first; it becomes final 30 minutes after settlement.' });
    return;
  }
  const calls = [];
  for (let i = 0; i < todo.length; i += SCORE_BATCH) {
    const part = todo.slice(i, i + SCORE_BATCH);
    const inputData = SEL.scoreMany + word(0x40) + word(epoch) + word(part.length) + part.map(addrWord).join('');
    let simulation = 'ok';
    try { await call(SCORER, inputData); } catch (e) { simulation = `would fail: ${e.message} ${e.data || ''}`; }
    calls.push({ to: SCORER, value: '0', inputData, agents: part.length, simulation });
  }
  print({ ok: true, action: 'score', epoch, cards, submitted: submitted.length, alreadyScored: submitted.length - todo.length, calls });
}

async function cmdBlitz(now) {
  if (MARKETS.length === 0) fail('Blitz is not deployed yet.');
  const current = Math.floor(now / 21600);
  const calls = [];
  for (const [pair, market] of MARKETS) {
    // The last eight finished rounds: a round r is finished once now > (r + 2) * 6 hours.
    for (let r = current - 2; r > current - 10; r--) {
      const minted = Number(slot(await call(market, '0xc31ef0f6' + word(r)), 0)); // roundMinted(uint32)
      if (minted === 0) continue;
      const res = await call(market, '0xcdd20022' + word(r)); // resultOf(uint32)
      if (slot(res, 2) !== 0n) continue;
      const inputData = '0x61a6287f' + word(r); // settle(uint32)
      let simulation = 'ok';
      try { await call(market, inputData); } catch (e) { simulation = `would fail: ${e.message} ${e.data || ''}`; }
      calls.push({ pair, round: r, tickets: minted, to: market, value: '0', inputData, simulation });
    }
  }
  print({ ok: true, action: 'blitz-settle', currentRound: current, calls });
}

async function cmdFunnel() {
  const { createRequire } = await import('node:module');
  const league = createRequire(import.meta.url)('../docs/league.js');
  const d = await league.load();
  print({ ok: true, action: 'funnel', at: new Date(d.now * 1000).toISOString(), ...d.funnel, forecastsInOpenRound: d.submittedToday, squads: d.squads.length,
    squadMembers: d.squads.map((q) => ({ squad: q.name || q.captain, members: q.members })),
    blitz: d.blitz ? { tickets: d.blitz.supply, players: d.blitz.players, round: d.blitz.round, ticketsThisRound: d.blitz.minted,
      previousRoundPlayers: d.blitz.previousRoundPlayers, returnedThisRound: d.blitz.returning,
      returnRate: d.blitz.previousRoundPlayers ? Math.round(100 * d.blitz.returning / d.blitz.previousRoundPlayers) + '%' : 'n/a' } : 'not deployed' });
}

// The numbers the strategy is judged by, read from the chain: what outside wallets (everyone except
// the holder of card #1, the builder) have actually done. Read-only.
async function cmdEvidence() {
  const { createRequire } = await import('node:module');
  const league = createRequire(import.meta.url)('../docs/league.js');
  const d = await league.load();
  const builder = (d.rows[0] && d.rows[0].owner || '').toLowerCase();
  const outside = d.rows.filter((r) => r.owner && r.owner.toLowerCase() !== builder);
  const out = {
    ok: true, action: 'evidence', at: new Date(d.now * 1000).toISOString(), cards: d.rows.length,
    outsideForecasters: outside.filter((r) => r.forecasts >= 1).length,
    outsideWithAScoredForecast: outside.filter((r) => r.scoredRounds >= 1).length,
    outsideWithThreeScoredForecasts: outside.filter((r) => r.scoredRounds >= 3).length,
    outsideSquadsOfThreeOrMore: d.squads.filter((q) => q.captain.toLowerCase() !== builder && q.members >= 3).length,
    blitz: 'not deployed',
  };
  const cardHolders = new Set(d.rows.map((r) => (r.owner || '').toLowerCase()));
  const everyTicketHolder = new Set(); const markets = [];
  for (const [pair, market] of MARKETS) {
    const head = await multicall([{ to: market, data: '0x18160ddd' }, { to: market, data: '0x8a19c8bc' }]); // totalSupply, currentRound
    const supply = Number(slot(head[0], 0)); const current = Number(slot(head[1], 0));
    const ids = []; for (let id = supply; id >= Math.max(1, supply - 5999); id--) ids.push(id);
    const tickets = await multicall(ids.map((id) => ({ to: market, data: '0xc129ff32' + word(id) }))); // ticket(uint256)
    const byRound = new Map(); // round -> set of holders
    for (const t of tickets) {
      if (!t) continue;
      const holder = '0x' + t.slice(26, 66); const r = Number(slot(t, 1));
      if (!byRound.has(r)) byRound.set(r, new Set());
      byRound.get(r).add(holder); everyTicketHolder.add(holder);
    }
    const last12 = []; for (let r = current - 11; r <= current; r++) last12.push(r);
    const rounds = last12.map((r) => {
      const now = byRound.get(r) || new Set(); const before = byRound.get(r - 1) || new Set();
      const back = [...before].filter((h) => now.has(h)).length;
      return { round: r, open: r === current, tickets: now.size, returnedFromPrevious: before.size ? Math.round(100 * back / before.size) + '%' : 'n/a' };
    });
    const count = new Map();
    for (const r of last12) for (const h of byRound.get(r) || []) if (h !== builder) count.set(h, (count.get(h) || 0) + 1);
    const holders = [...new Set([...byRound.values()].flatMap((set) => [...set]))].filter((h) => h !== builder);
    const recs = await multicall(holders.map((h) => ({ to: market, data: '0xc06ac6a3' + addrWord(h) }))); // recordOf(address)
    const finished = [...byRound.keys()].filter((r) => r <= current - 2).sort((a, b) => b - a).slice(0, 40);
    const results = await multicall(finished.map((r) => ({ to: market, data: '0xcdd20022' + word(r) }))); // resultOf(uint32)
    const outcomes = results.map((x) => (x ? Number(slot(x, 2)) : 0));
    markets.push({
      pair, contract: market, tickets: supply, currentRound: current, players: holders.length + (everyTicketHolder.has(builder) ? 1 : 0),
      last12Rounds: rounds.slice(Math.max(0, rounds.findIndex((r) => r.tickets > 0))),
      outsideWalletsInEightOfLast12Rounds: [...count.values()].filter((n) => n >= 8).length,
      outsideWalletsWithATicketAndAClaim: recs.filter((x) => x && slot(x, 0) - slot(x, 5) > 0n).length,
      finishedRoundsWithTickets: finished.length, settled: outcomes.filter((o) => o !== 0).length,
      voidRounds: outcomes.filter((o) => o === 4).length,
    });
  }
  if (markets.length) {
    const withoutCard = [...everyTicketHolder].filter((h) => !cardHolders.has(h)).length;
    const forecasts = d.rows.reduce((a, r) => a + r.forecasts, 0);
    const ticketsAll = markets.reduce((a, m) => a + m.tickets, 0);
    const claims = markets.reduce((a, m) => a + m.outsideWalletsWithATicketAndAClaim, 0);
    // The two numbers the Pioneer award counts. Wallets: card holders plus ticket holders without a card.
    // Transactions: a lower bound from state (card or first forecast, later forecasts, tickets, at least one claim per claiming wallet).
    out.walletsAcrossContracts = cardHolders.size + withoutCard;
    out.transactionsAtLeast = d.rows.length + Math.max(0, forecasts - d.rows.filter((r) => r.forecasts > 0).length) + ticketsAll + claims;
    out.blitz = { ...markets[0], ticketHoldersWithoutACard: withoutCard, ticketsInAllMarkets: ticketsAll };
    if (markets.length > 1) out.blitzMarkets = markets;
  }
  print(out);
}

const args = parseArgs(process.argv.slice(2));
try {
  const now = await chainTime();
  const epoch = args.epoch !== undefined ? Number(args.epoch) : Math.floor(now / 86400) - 1;
  if (!Number.isInteger(epoch) || epoch < 0) fail('--epoch must be a whole number.');
  if (args._[0] === 'settle') await cmdSettle(epoch, now);
  else if (args._[0] === 'score') await cmdScore(epoch);
  else if (args._[0] === 'blitz') await cmdBlitz(now);
  else if (args._[0] === 'funnel') await cmdFunnel();
  else if (args._[0] === 'evidence') await cmdEvidence();
  else { console.log('Usage:\n  node keeper/keeper.mjs settle [--epoch N]\n  node keeper/keeper.mjs score [--epoch N]\n  node keeper/keeper.mjs blitz\n  node keeper/keeper.mjs funnel\n  node keeper/keeper.mjs evidence'); process.exit(args._[0] ? 1 : 0); }
} catch (e) { fail(e.message || String(e)); }
