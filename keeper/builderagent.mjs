#!/usr/bin/env node
// One agent, end to end: everything the builder's own agent did in the league, read from the chain.
// Read-only (eth_call, plus eth_getLogs/eth_getTransactionByHash only for a ticket the picks ledger has not seen yet).
//
// The wallet is the builder's Agentic Wallet. An AI agent runs it under its human's standing approval:
// one Blitz ticket per round in the BTC 6h market, its claim, and one daily BTC/ETH/BNB forecast on LeagueCore.
// This wallet is left out of every usage number on the site. It is an example, not evidence of adoption.
//
// Output: docs/api/builder-agent.json. Reasons come from launch/builder_reasons.json, kept by hand.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const L = createRequire(import.meta.url)('../docs/league.js');
const RPCS = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org'];
const MC = '0xcA11bde05977b3631167028862bE2a173976CA11';
const REG = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f';
const CORE = '0x79F55DAa8a3CF2Eb76EE40e26ff6E244a4cC1eD4', SCORER = '0x5ea789e7cd9C157793dDA75959829F8C1527C16b';
const WALLET = '0x2a2f48145780639dbd91e748df157f35283165da';
const ROUTINE_MARKET = 'BTC 6h';
const CORE_FIRST_EPOCH = 20774; // 18 Nov 2026, before LeagueCore went live (19 Nov)
const M = [
  ['BTC 6h', '0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C'], ['ETH 6h', '0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1'], ['BNB 6h', '0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9'],
  ['BTC 1h', '0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629'], ['ETH 1h', '0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4'], ['BNB 1h', '0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736'],
  ['BTC 1d', '0x9e521add6F67EEe0Fe5c0b8ef32cb4543f7af50E'],
];
const SEL = { '0xd5a49e01': 'up', '0xd8337928': 'down', '0x1249c58b': 'mint' };
const STATUS = ['live', 'waiting', 'won', 'lost', 'push', 'void'];
const OUTCOME = [null, 'up', 'down', 'push', 'void'];
const PAIRS = ['BTC', 'ETH', 'BNB'];

async function rpc(method, params, only) {
  let last;
  for (let a = 0; a < 4; a++) for (const u of only ? [only] : RPCS) {
    try {
      const r = await (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30000) })).json();
      if (r.result !== undefined && r.result !== null) return r.result;
      last = r.error;
    } catch (e) { last = e; }
    await new Promise((s) => setTimeout(s, 400 * (a + 1)));
  }
  throw new Error('rpc failed: ' + method + ' ' + JSON.stringify(last && (last.message || last)));
}
const multi = async (calls) => { const out = []; for (let i = 0; i < calls.length; i += 200) out.push(...L.decodeAggregate3(await rpc('eth_call', [{ to: MC, data: L.encodeAggregate3(calls.slice(i, i + 200)) }, 'latest']))); return out; };
const w = (n) => BigInt(n).toString(16).padStart(64, '0');
const aw = WALLET.slice(2).padStart(64, '0');
const at = (h, i) => (h ? BigInt('0x' + (h.slice(2 + i * 64, 2 + (i + 1) * 64) || '0')) : 0n);
const num = (h, i) => Number(at(h, i));
const iso = (t) => new Date(t * 1000).toISOString().replace('.000', '');
const str = (h) => { if (!h || h.length < 130) return ''; const len = num(h, 1); return Buffer.from(h.slice(130, 130 + len * 2), 'hex').toString('utf8'); };

const block = await rpc('eth_getBlockByNumber', ['latest', false]);
const blockNumber = parseInt(block.number, 16), now = parseInt(block.timestamp, 16);

// 1. Identity: name.ai, whether it is shown, the card.
const [handle, show, card, count, stats] = await multi([
  { to: REG, data: '0xc50a1514' + aw }, { to: CORE, data: '0xfeeb4e45' + aw }, { to: CORE, data: '0x48e748a0' + aw },
  { to: CORE, data: '0x920ccaf1' + aw }, { to: SCORER, data: '0x15cfc405' + aw },
]);

// 2. Every ticket the wallet holds, in each market: balanceOf, then tokenOfOwnerByIndex.
const head = await multi(M.flatMap(([, a]) => [{ to: a, data: '0x70a08231' + aw }, { to: a, data: '0xb24ae1f8' }, { to: a, data: '0xc06ac6a3' + aw }]));
const ids = [];
M.forEach(([m, a], i) => { for (let k = 0; k < num(head[3 * i], 0); k++) ids.push({ m, a, len: num(head[3 * i + 1], 0), k }); });
const idRes = await multi(ids.map((t) => ({ to: t.a, data: '0x2f745c59' + aw + w(t.k) })));
ids.forEach((t, i) => { t.id = num(idRes[i], 0); });
const tk = await multi(ids.map((t) => ({ to: t.a, data: '0xc129ff32' + w(t.id) })));
ids.forEach((t, i) => { const r = tk[i]; t.round = num(r, 1); t.up = at(r, 2) === 1n; t.status = STATUS[num(r, 4)]; });
const more = await multi(ids.flatMap((t) => [{ to: t.a, data: '0xcdd20022' + w(t.round) }, { to: t.a, data: '0x386d5777' + aw + w(t.round) }]));
ids.forEach((t, i) => { const r = more[2 * i]; t.p0 = num(r, 0); t.p1 = num(r, 1); t.outcome = OUTCOME[num(r, 2)]; t.assignedUp = at(more[2 * i + 1], 0) === 1n; });

// 3. Picked or assigned: the picks ledger first (built from each mint transaction's input), else this script reads the input itself.
const ledger = existsSync('docs/api/picks/ledger.json') ? JSON.parse(readFileSync('docs/api/picks/ledger.json', 'utf8')) : { tickets: [] };
const byKey = new Map(ledger.tickets.filter((t) => t.holder === WALLET).map((t) => [t.m + ':' + t.id, t]));
for (const t of ids) {
  const row = byKey.get(t.m + ':' + t.id);
  if (row) { t.how = row.how; t.tx = row.tx; t.howSource = 'api/picks/ledger.json'; continue; }
  try {
    const from = blockNumber - 150000; // public nodes keep logs for about 30 to 42 hours
    const logs = await rpc('eth_getLogs', [{ address: t.a, fromBlock: '0x' + from.toString(16), toBlock: 'latest', topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', '0x' + '0'.repeat(64), '0x' + aw, '0x' + w(t.id)] }], RPCS[0]);
    if (logs.length) { const tx = await rpc('eth_getTransactionByHash', [logs[0].transactionHash]); t.tx = tx.hash; t.how = tx.to && tx.to.toLowerCase() === t.a.toLowerCase() ? SEL[tx.input.slice(0, 10)] || 'other' : 'other'; t.howSource = 'transaction input'; }
  } catch {}
  if (!t.how || t.how === 'other') { t.how = t.up !== t.assignedUp ? 'picked-indirect' : 'unknown'; t.howSource = 'side compared with assignedSide()'; }
}
const isPicked = (h) => h === 'up' || h === 'down' || h === 'picked-indirect';

// 4. Daily forecasts on LeagueCore and their scores (same formula as Scorer.scoreOf, from the settled Scorer rounds).
const epochNow = Math.floor(now / 86400);
const [hz] = await multi([{ to: SCORER, data: '0x1ce832b5' }]);
const horizon = num(hz, 0);
const epochs = []; for (let e = CORE_FIRST_EPOCH; e <= epochNow; e++) epochs.push(e);
const subs = await multi(epochs.map((e) => ({ to: CORE, data: '0x044e613c' + aw + w(e) })));
const mine = epochs.map((e, i) => ({ e, r: subs[i] })).filter((x) => num(x.r, 3) !== 0);
const det = await multi(mine.flatMap(({ e }) => [{ to: SCORER, data: '0xa86c3b41' + aw + w(e) }, ...[0, 1, 2].map((f) => ({ to: SCORER, data: '0xdba20268' + w(e) + w(f) }))]));
const forecasts = mine.map(({ e, r }, i) => {
  const [sc, ...rounds] = det.slice(4 * i, 4 * i + 4);
  const pairs = PAIRS.map((pair, f) => {
    const fc = at(r, f); if (fc === 0n) return null;
    const rd = rounds[f]; const p0 = at(rd, 0), p1 = at(rd, 2), final = at(rd, 5) === 1n;
    return { pair, forecast: Number(fc) / 1e8, lockPrice: final ? Number(p0) / 1e8 : null, targetPrice: final ? Number(p1) / 1e8 : null, score: final ? L.scoreOf(p0, p1, fc) : null };
  }).filter(Boolean);
  const done = pairs.every((p) => p.score !== null);
  return { epoch: e, submittedAt: iso(num(r, 3)), lockAt: iso((e + 1) * 86400), targetAt: iso((e + 1) * 86400 + horizon), scoredOnChain: at(sc, 0) === 1n,
    pairs, total: done ? pairs.reduce((s, p) => s + p.score, 0) : null, status: done ? 'scored' : 'waiting' };
});

// 5. Reasons, kept by hand by the operator.
const reasons = existsSync('launch/builder_reasons.json') ? JSON.parse(readFileSync('launch/builder_reasons.json', 'utf8')).entries || [] : [];

const tickets = ids.sort((x, y) => x.round * x.len - y.round * y.len || x.m.localeCompare(y.m)).map((t) => ({
  market: t.m, contract: t.a, ticket: t.id, round: t.round, opensAt: iso(t.round * t.len), lockAt: iso((t.round + 1) * t.len), resultAt: iso((t.round + 2) * t.len),
  side: t.up ? 'up' : 'down', how: t.how, picked: isPicked(t.how), howSource: t.howSource, tx: t.tx || null,
  inRoutine: t.m === ROUTINE_MARKET, status: t.status, outcome: t.outcome,
  lockPrice: t.p0 ? t.p0 / 1e8 : null, resultPrice: t.p1 ? t.p1 / 1e8 : null,
  reason: (reasons.find((r) => r.market === t.m && Number(r.round) === t.round) || {}).reason || null,
}));
const tally = (arr) => ({ tickets: arr.length, won: arr.filter((t) => t.status === 'won').length, lost: arr.filter((t) => t.status === 'lost').length,
  push: arr.filter((t) => t.status === 'push').length, void: arr.filter((t) => t.status === 'void').length, waiting: arr.filter((t) => t.status === 'live' || t.status === 'waiting').length });
const out = {
  name: 'Forecast League: the builder\'s own agent', updated: iso(now), block: blockNumber,
  label: 'The builder\'s own agent. Excluded from all usage numbers. An example, not evidence of adoption.',
  wallet: WALLET, handle: str(handle) || null, showName: at(show, 0) === 1n, card: num(card, 0) || null,
  approval: 'The human approved, as a standing routine: one Blitz ticket per round in the BTC 6h market (0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C), its claim(), and one daily BTC/ETH/BNB price forecast on LeagueCore (0x79F55DAa8a3CF2Eb76EE40e26ff6E244a4cC1eD4), scored by Scorer (0x5ea789e7cd9C157793dDA75959829F8C1527C16b). Every call has value 0.',
  method: 'Ticket ids from balanceOf and tokenOfOwnerByIndex on each of the 7 markets; ticket(id) for side and status; resultOf(round) for the settled prices. Picked or assigned from api/picks/ledger.json (the 4-byte selector of each mint transaction: up()/down() picked, mint() assigned); a ticket not yet in the ledger is read from its own transaction. Daily forecasts from LeagueCore.submissionOf, scores worked out from Scorer.roundOf with the Scorer formula. Nothing is left out.',
  summary: { all: tally(tickets), picked: tally(tickets.filter((t) => t.picked)), assigned: tally(tickets.filter((t) => !t.picked)), routine: tally(tickets.filter((t) => t.inRoutine)) },
  recordOf: M.map(([m], i) => { const r = head[3 * i + 2]; return { market: m, tickets: num(r, 0), wins: num(r, 1), losses: num(r, 2), streak: num(r, 3), bestStreak: num(r, 4), unclaimed: num(r, 5) }; }).filter((r) => r.tickets),
  tickets,
  forecasts: { submissions: num(count, 0), scorer: { epochs: num(stats, 0), forecasts: num(stats, 1), wins: num(stats, 2), total: Number(BigInt.asIntN(64, at(stats, 3))) }, horizonSeconds: horizon, days: forecasts },
  reasons,
};
writeFileSync('docs/api/builder-agent.json', JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ ok: true, block: blockNumber, tickets: tickets.length, ...out.summary, forecasts: forecasts.length }));
