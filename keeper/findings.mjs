#!/usr/bin/env node
// Do AI agents call BTC, ETH and BNB better than a coin flip? Read-only.
// Every ticket in the picks ledger (docs/api/picks/ledger.json) is re-read with ticket(id) for its status
// (won / lost / push / void / waiting) as the contract computes it from the Chainlink prices it recorded.
// Picked (up()/down()) and assigned (mint()) tickets are scored separately; the builder wallet is left out.
// Output: docs/api/findings.json.
import { readFileSync, writeFileSync } from 'node:fs';

const RPCS = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed.binance.org'];
const MC = '0xcA11bde05977b3631167028862bE2a173976CA11';
const BUILDER = '0x2a2f48145780639dbd91e748df157f35283165da';
const ADDR = { 'BTC 6h': '0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C', 'ETH 6h': '0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1', 'BNB 6h': '0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9',
  'BTC 1h': '0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629', 'ETH 1h': '0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4', 'BNB 1h': '0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736', 'BTC 1d': '0x9e521add6F67EEe0Fe5c0b8ef32cb4543f7af50E' };
const STATUS = ['live', 'finished', 'won', 'lost', 'push', 'void'];
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
let rr = 0;
async function rpc(method, params) {
  for (let a = 0; a < 6; a++) {
    try {
      const r = await (await fetch(RPCS[rr++ % RPCS.length], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30000) })).json();
      if (r.result !== undefined && r.result !== null) return r.result;
    } catch {}
    await new Promise((s) => setTimeout(s, 500 * (a + 1)));
  }
  throw new Error(method + ' failed');
}
function enc(calls) {
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
  for (let i = 0; i < n; i++) { const el = start + at(start + i * 32), dp = el + at(el + 32); out.push([at(el) === 1, '0x' + h.slice((dp + 32) * 2, (dp + 32) * 2 + at(dp) * 2)]); }
  return out;
}
const r4 = (x) => Math.round(x * 10000) / 10000;
function wilson(h, n) {
  if (!n) return null;
  const z = 1.96, p = h / n, c = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const m = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return [r4(c - m), r4(c + m)];
}
const led = JSON.parse(readFileSync('docs/api/picks/ledger.json', 'utf8'));
const tix = led.tickets.filter((t) => t.holder && t.holder !== BUILDER && ADDR[t.m]);
const calls = tix.map((t) => [ADDR[t.m], '0xc129ff32' + word(t.id)]);
for (let i = 0; i < calls.length; i += 250) {
  const part = dec(await rpc('eth_call', [{ to: MC, data: enc(calls.slice(i, i + 250)) }, 'latest']));
  part.forEach(([ok, hex], k) => { tix[i + k].status = ok && hex.length >= 2 + 5 * 64 ? STATUS[Number(BigInt('0x' + hex.slice(2 + 4 * 64, 2 + 5 * 64)))] : 'unknown'; });
}
const picked = (t) => t.how === 'up' || t.how === 'down' || t.how === 'picked-indirect';
function score(list) {
  const d = list.filter((t) => t.status === 'won' || t.status === 'lost');
  const won = d.filter((t) => t.status === 'won').length;
  const upShare = list.length ? list.filter((t) => t.up).length / list.length : null;
  // "Always up" and "always down" on exactly the same decided tickets: did the side matter, or the market's drift?
  const upRight = d.filter((t) => (t.status === 'won') === t.up).length;
  return { tickets: list.length, decided: d.length, won, hitRate: d.length ? r4(won / d.length) : null, ci95: wilson(won, d.length),
    wallets: new Set(list.map((t) => t.holder)).size, upShare: upShare == null ? null : r4(upShare),
    alwaysUpSameTickets: d.length ? r4(upRight / d.length) : null };
}
const P = tix.filter(picked), A = tix.filter((t) => t.how === 'mint');
const byWallet = {};
for (const t of P) (byWallet[t.holder] ||= []).push(t);
const top = Object.entries(byWallet).map(([w, l]) => ({ wallet: w, ...score(l) })).sort((a, b) => b.decided - a.decided);
const topWallet = top[0]?.wallet;
const out = {
  name: 'Do AI agents call BTC, ETH and BNB better than a coin flip?',
  updated: new Date().toISOString().slice(0, 19) + 'Z',
  method: 'Every ticket seen in the picks ledger, re-read now with ticket(id) on its market contract; won and lost as the contract decides them from the Chainlink start and end prices it recorded. Picked = up() or down(), a side the agent chose. Assigned = mint(), a side the contract derives from the address and round, so its hit rate should sit near 0.5 and serves as the control. alwaysUpSameTickets is the hit rate "up" would have had on the same decided tickets: if a picked hit rate is close to it, the market drifted that way and the picks mostly followed. Intervals are Wilson 95%. The builder wallet is left out.',
  picked: score(P),
  pickedWithoutTopWallet: score(P.filter((t) => t.holder !== topWallet)),
  assigned: score(A),
  perMarket: Object.keys(ADDR).map((m) => ({ market: m, picked: score(P.filter((t) => t.m === m)), assigned: score(A.filter((t) => t.m === m)) })),
  topPickers: top.slice(0, 10),
  reading: null,
};
const p = out.picked, a = out.assigned;
out.reading = !p.decided ? 'No decided picked tickets yet.'
  : `Picked: ${p.won} of ${p.decided} right (${Math.round(p.hitRate * 100)}%, interval ${p.ci95.map((x) => Math.round(x * 100) + '%').join(' to ')}), from ${p.wallets} wallets. `
  + `Assigned control: ${a.won} of ${a.decided} (${a.hitRate == null ? 'n/a' : Math.round(a.hitRate * 100) + '%'}). `
  + `Without the most active picker: ${out.pickedWithoutTopWallet.won} of ${out.pickedWithoutTopWallet.decided}. `
  + (p.ci95[0] > 0.5 ? 'The picked interval sits above 0.5, ' : 'The picked interval still includes 0.5, ')
  + `and "always up" on the same tickets would have scored ${Math.round(p.alwaysUpSameTickets * 100)}%. Small sample; one wallet carries most of it.`;
writeFileSync('docs/api/findings.json', JSON.stringify(out, null, 1) + '\n');
console.log(out.reading);
