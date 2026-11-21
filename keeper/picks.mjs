#!/usr/bin/env node
// Which tickets were picked and which were assigned. Read-only (eth_getLogs, eth_getTransactionByHash, eth_call).
//
// A ticket minted with up() or down() is a side the caller chose. mint() takes the side the contract
// assigns from the wallet and the round. The three calls emit the same events, so the only record of
// which one was used is the transaction's input. Public nodes keep logs for about 30 to 42 hours, so
// this script keeps its own ledger (docs/api/picks/ledger.json) and adds to it each run.
//
// A ticket minted through another contract (a smart wallet, a batcher) has an input we cannot read
// as up/down/mint. It counts as picked when its side differs from the assigned side; otherwise unknown.
//
// Output: docs/api/picks/ledger.json (every ticket seen), docs/api/picks.json (totals and boards).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const L = createRequire(import.meta.url)('../docs/league.js');
const LOGS = 'https://bsc-rpc.publicnode.com';
const RPCS = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed.binance.org'];
const MC = '0xcA11bde05977b3631167028862bE2a173976CA11';
const BUILDER = '0x2a2f48145780639dbd91e748df157f35283165da';
const T = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', Z = '0x' + '0'.repeat(64);
const FIRST_BLOCK = 134590000; // before the first market (Blitz BTC 6h, 20 Nov 2026 00:09 UTC)
const M = [
  ['BTC 6h', '0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C'], ['ETH 6h', '0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1'], ['BNB 6h', '0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9'],
  ['BTC 1h', '0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629'], ['ETH 1h', '0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4'], ['BNB 1h', '0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736'],
  ['BTC 1d', '0x9e521add6F67EEe0Fe5c0b8ef32cb4543f7af50E'],
];
const BY_ADDR = Object.fromEntries(M.map(([n, a]) => [a.toLowerCase(), n]));
const SEL = { '0xd5a49e01': 'up', '0xd8337928': 'down', '0x1249c58b': 'mint' };
const STATUS = ['live', 'finished', 'won', 'lost', 'push', 'void'];

let rr = 0;
async function rpc(method, params, url) {
  for (let a = 0; a < 6; a++) {
    const u = url || RPCS[rr++ % RPCS.length];
    try {
      const r = await (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(45000) })).json();
      if (r.result !== undefined && r.result !== null) return r.result;
    } catch {}
    await new Promise((s) => setTimeout(s, 500 * (a + 1)));
  }
  throw new Error('rpc failed: ' + method);
}
const multi = async (calls) => { const out = []; for (let i = 0; i < calls.length; i += 200) out.push(...L.decodeAggregate3(await rpc('eth_call', [{ to: MC, data: L.encodeAggregate3(calls.slice(i, i + 200)) }, 'latest']))); return out; };
const w = (n) => BigInt(n).toString(16).padStart(64, '0');
const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); };

mkdirSync('docs/api/picks', { recursive: true });
const LEDGER = 'docs/api/picks/ledger.json';
const led = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { note: 'One row per ticket: market, ticket id, holder, round, side (up true), how it was minted, mint transaction, block. how: up/down = chosen by the caller; mint = side assigned by the contract; picked-indirect = minted through another contract with a side that differs from the assigned one; unknown = minted through another contract with the assigned side.', coveredFrom: FIRST_BLOCK, scannedTo: FIRST_BLOCK - 1, tickets: [] };
const known = new Set(led.tickets.map((t) => t.m + ':' + t.id));

// 1. New mint events since the last run.
const head = parseInt(await rpc('eth_blockNumber', [], LOGS), 16) - 3;
const from = led.scannedTo + 1;
const fresh = [];
for (let b = from; b <= head; b += 50000) {
  const to = Math.min(head, b + 49999);
  const r = await rpc('eth_getLogs', [{ address: M.map((m) => m[1]), fromBlock: '0x' + b.toString(16), toBlock: '0x' + to.toString(16), topics: [T, Z] }], LOGS);
  if (b < 134500000 || (!r.length && b === from && from < head - 300000)) console.error('note: logs before block 134,500,000 may no longer be served; range', b, to);
  for (const l of r) {
    const m = BY_ADDR[l.address.toLowerCase()]; const id = Number(BigInt(l.topics[3]));
    if (!known.has(m + ':' + id)) { known.add(m + ':' + id); fresh.push({ m, id, tx: l.transactionHash, block: parseInt(l.blockNumber, 16) }); }
  }
}

// 2. How each new ticket was minted: the transaction's input, when it called the market directly.
const txs = [...new Set(fresh.map((t) => t.tx))]; const how = new Map();
await pool(txs, 8, async (h) => { const t = await rpc('eth_getTransactionByHash', [h]); const direct = t.to && BY_ADDR[t.to.toLowerCase()]; how.set(h, direct ? SEL[t.input.slice(0, 10)] || 'other' : 'other'); });

// 3. Ticket details, and the assigned side for tickets whose call we could not read.
const addrOf = Object.fromEntries(M.map(([n, a]) => [n, a]));
const det = await multi(fresh.map((t) => ({ to: addrOf[t.m], data: '0xc129ff32' + w(t.id) })));
fresh.forEach((t, i) => { const r = det[i]; t.holder = r ? '0x' + r.slice(26, 66) : null; t.round = r ? parseInt(r.slice(66, 130), 16) : null; t.up = r ? BigInt('0x' + r.slice(130, 194)) === 1n : null; t.how = how.get(t.tx) || 'other'; });
const odd = fresh.filter((t) => t.how === 'other' && t.holder);
const asg = await multi(odd.map((t) => ({ to: addrOf[t.m], data: '0x386d5777' + t.holder.slice(2).padStart(64, '0') + w(t.round) })));
odd.forEach((t, i) => { const assignedUp = asg[i] && BigInt(asg[i]) === 1n; t.how = assignedUp !== t.up ? 'picked-indirect' : 'unknown'; });
for (const t of fresh) led.tickets.push({ m: t.m, id: t.id, holder: t.holder, round: t.round, up: t.up, how: t.how, tx: t.tx, block: t.block });
led.scannedTo = head; led.updated = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
writeFileSync(LEDGER, JSON.stringify(led) + '\n');

// 4. Status of every picked ticket (won, lost, waiting), then totals and boards. The builder's wallet is left out.
const isPicked = (h) => h === 'up' || h === 'down' || h === 'picked-indirect';
const ext = led.tickets.filter((t) => t.holder && t.holder !== BUILDER);
const picked = ext.filter((t) => isPicked(t.how));
const st = await multi(picked.map((t) => ({ to: addrOf[t.m], data: '0xc129ff32' + w(t.id) })));
picked.forEach((t, i) => { t.status = st[i] ? STATUS[parseInt(st[i].slice(258, 322), 16)] || 'live' : 'live'; });
const count = (arr, f) => arr.filter(f).length;
const wallets = {};
for (const t of ext) { const x = (wallets[t.holder] ||= { picked: 0, assigned: 0, unknown: 0, won: 0, lost: 0, waiting: 0 }); if (isPicked(t.how)) x.picked++; else if (t.how === 'mint') x.assigned++; else x.unknown++; }
for (const t of picked) { const x = wallets[t.holder]; if (t.status === 'won') x.won++; else if (t.status === 'lost') x.lost++; else if (t.status !== 'void' && t.status !== 'push') x.waiting++; }
const pickers = Object.entries(wallets).filter(([, x]) => x.picked > 0);
const board = pickers.map(([wallet, x]) => ({ wallet, picked: x.picked, won: x.won, lost: x.lost, waiting: x.waiting, winRate: x.won + x.lost ? Math.round((1000 * x.won) / (x.won + x.lost)) / 10 : null }))
  .sort((a, b) => b.won - a.won || (b.winRate ?? -1) - (a.winRate ?? -1) || b.picked - a.picked);
const perMarket = M.map(([n]) => { const a = ext.filter((t) => t.m === n); return { market: n, tickets: a.length, picked: count(a, (t) => isPicked(t.how)), assigned: count(a, (t) => t.how === 'mint'), unknown: count(a, (t) => t.how === 'unknown') }; });
const out = {
  name: 'Forecast League picks', updated: led.updated, coveredFromBlock: led.coveredFrom, scannedToBlock: led.scannedTo,
  method: 'Each ticket is classified by the call that minted it: up() or down() is a side the caller chose, mint() is a side the contract assigned. A ticket minted through another contract counts as picked only if its side differs from the assigned one. The builder wallet is left out.',
  totals: { tickets: ext.length, picked: picked.length, assigned: count(ext, (t) => t.how === 'mint'), unknown: count(ext, (t) => t.how === 'unknown'), pickedSharePct: ext.length ? Math.round((1000 * picked.length) / ext.length) / 10 : 0, wallets: Object.keys(wallets).length, pickedWallets: pickers.length, pickedDecided: count(picked, (t) => t.status === 'won' || t.status === 'lost'), pickedWon: count(picked, (t) => t.status === 'won') },
  perMarket,
  board: board.slice(0, 50),
  ledger: 'https://mycyi1994-hash.github.io/forecast-league/api/picks/ledger.json',
};
writeFileSync('docs/api/picks.json', JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ ok: true, newTickets: fresh.length, ...out.totals }));
