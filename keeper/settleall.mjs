#!/usr/bin/env node
// Lists every finished round that nobody has settled yet, in all seven markets, and prints the
// Multicall3 calls that settle them in batches. Read-only: it never signs or sends anything.
// settle(round) can be called by anyone and only writes the Chainlink result for that round.
//   node keeper/settleall.mjs            -> JSON { unsettled, waitingTickets, batches: [{to, value, inputData, rounds}] }
//   node keeper/settleall.mjs --batch 10 -> rounds per batch (default 10, about 2.8M gas)
const RPCS = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org', 'https://bsc.drpc.org'];
const MC = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MARKETS = [
  ['BTC 1h', '0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629', 3600],
  ['ETH 1h', '0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4', 3600],
  ['BNB 1h', '0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736', 3600],
  ['BTC 6h', '0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C', 21600],
  ['ETH 6h', '0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1', 21600],
  ['BNB 6h', '0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9', 21600],
  ['BTC 1d', '0x9e521add6F67EEe0Fe5c0b8ef32cb4543f7af50E', 86400],
];
const SEL = { minted: '0xc31ef0f6', resultOf: '0xcdd20022', settle: '0x61a6287f' };
const FIRST = 1795046400; // 2026-11-19 00:00 UTC, before the first deployment
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
async function rpc(method, params) {
  let last;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      if (j.result !== undefined) return j.result;
      last = new Error(JSON.stringify(j.error));
    } catch (e) { last = e; }
  }
  throw last;
}
function enc(calls) { // aggregate3((address target, bool allowFailure, bytes callData)[])
  const heads = [], bodies = []; let off = calls.length * 32;
  for (const [to, data] of calls) {
    const d = data.slice(2), len = d.length / 2;
    const body = to.slice(2).toLowerCase().padStart(64, '0') + word(1) + word(0x60) + word(len) + d.padEnd(Math.ceil(len / 32) * 64, '0');
    heads.push(word(off)); bodies.push(body); off += body.length / 2;
  }
  return '0x82ad56cb' + word(0x20) + word(calls.length) + heads.join('') + bodies.join('');
}
function dec(hex) {
  const h = hex.slice(2), at = (p) => Number(BigInt('0x' + h.slice(p * 2, p * 2 + 64)));
  const base = at(0), n = at(base), start = base + 32, out = [];
  for (let i = 0; i < n; i++) {
    const el = start + at(start + i * 32), dp = el + at(el + 32);
    out.push([at(el) === 1, '0x' + h.slice((dp + 32) * 2, (dp + 32) * 2 + at(dp) * 2)]);
  }
  return out;
}
async function multi(calls, block) {
  const out = [];
  for (let i = 0; i < calls.length; i += 200) out.push(...dec(await rpc('eth_call', [{ to: MC, data: enc(calls.slice(i, i + 200)) }, block])));
  return out;
}
const slot = (hex, i) => BigInt('0x' + (hex.slice(2 + i * 64, 2 + (i + 1) * 64) || '0'));

const size = Math.max(1, Number(process.argv[process.argv.indexOf('--batch') + 1]) || 10);
const blk = await rpc('eth_getBlockByNumber', ['latest', false]);
const now = Number(BigInt(blk.timestamp));
const todo = []; let waiting = 0;
for (const [name, to, len] of MARKETS) {
  const rounds = []; for (let r = Math.floor(FIRST / len) - 2; r <= Math.floor(now / len); r++) rounds.push(r);
  const res = await multi(rounds.flatMap((r) => [[to, SEL.minted + word(r)], [to, SEL.resultOf + word(r)]]), blk.number);
  rounds.forEach((r, i) => {
    const minted = Number(slot(res[2 * i][1], 0)), outcome = Number(slot(res[2 * i + 1][1], 2));
    if (minted > 0 && now > (r + 2) * len && outcome === 0) { todo.push({ market: name, to, round: r, tickets: minted }); waiting += minted; }
  });
}
// keep only the calls that succeed in a simulation now (the price feed may not have the round yet)
const sim = todo.length ? await multi(todo.map((t) => [t.to, SEL.settle + word(t.round)]), 'latest') : [];
const ready = todo.filter((_, i) => sim[i][0]);
const batches = [];
for (let i = 0; i < ready.length; i += size) {
  const part = ready.slice(i, i + size);
  batches.push({ to: MC, value: '0', inputData: enc(part.map((t) => [t.to, SEL.settle + word(t.round)])), rounds: part.map((t) => `${t.market} ${t.round}`) });
}
console.log(JSON.stringify({ ok: true, block: Number(BigInt(blk.number)), unsettled: todo.length, waitingTickets: waiting, ready: ready.length, batches }, null, 1));
