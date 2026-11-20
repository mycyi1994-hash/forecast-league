#!/usr/bin/env node
// Transparency numbers: how Forecast League activity is spread over wallets.
// Read-only and repeatable: one balanceOf per wallet per contract (no logs, no indexer, nothing sent).
// Every Forecast League token is non-transferable, so a wallet's balance in a contract is the number
// of mints it sent there. Claims and squad calls leave no token and are not counted here.
// Output: docs/api/transparency.json (shown by docs/transparency.html).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const L = createRequire(import.meta.url)('../docs/league.js');
const RPCS = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org'];
const MC = '0xcA11bde05977b3631167028862bE2a173976CA11';
const BUILDER = '0x2a2f48145780639dbd91e748df157f35283165da';
const C = [
  ['card', 'Card', '0x79F55DAa8a3CF2Eb76EE40e26ff6E244a4cC1eD4', 'card'],
  ['btc-6h', 'BTC 6h', '0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C', 'sixHour'],
  ['eth-6h', 'ETH 6h', '0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1', 'sixHour'],
  ['bnb-6h', 'BNB 6h', '0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9', 'sixHour'],
  ['btc-1h', 'BTC 1h', '0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629', 'hourly'],
  ['eth-1h', 'ETH 1h', '0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4', 'hourly'],
  ['bnb-1h', 'BNB 1h', '0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736', 'hourly'],
  ['btc-1d', 'BTC 1d', '0x9e521add6F67EEe0Fe5c0b8ef32cb4543f7af50E', 'daily'],
  ['stamps', 'Stamps', '0x30b6b8C67Ab2239185536ba3766e8cb05BFd18ae', 'extras'],
  ['houses', 'Houses', '0x8433AD00601C57cE9F144b20A32aE478EEe831AE', 'extras'],
  ['badges', 'Badges', '0xF706Aeb7E1B6A44139205dF3043bf68cCf386918', 'extras'],
  ['honors', 'Honors', '0x3e73bC0309c72EA69bD74CaDEC943668291Ca6ed', 'extras'],
];
async function rpc(method, params) {
  for (let a = 0; a < 4; a++) for (const u of RPCS) {
    try { const r = await (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30000) })).json(); if (r.result) return r.result; } catch {}
  }
  throw new Error(method);
}
const multi = async (calls) => { const out = []; for (let i = 0; i < calls.length; i += 250) out.push(...L.decodeAggregate3(await rpc('eth_call', [{ to: MC, data: L.encodeAggregate3(calls.slice(i, i + 250)) }, 'latest']))); return out; };
const w32 = (a) => a.slice(2).toLowerCase().padStart(64, '0');
const num = (h) => (h ? Number(BigInt(h.slice(0, 66))) : 0);
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 0);

const all = JSON.parse(readFileSync('docs/api/wallet/index.json', 'utf8')).wallets.map((w) => w.toLowerCase());
const block = parseInt(await rpc('eth_blockNumber', []), 16);
const res = await multi(all.flatMap((w) => C.map(([, , a]) => ({ to: a, data: '0x70a08231' + w32(w) }))));
const rows = all.map((w, i) => { const per = C.map((_, k) => num(res[i * C.length + k])); return { wallet: w, per, tokens: per.reduce((s, v) => s + v, 0), used: per.filter((v) => v > 0).length }; });
const builder = rows.find((r) => r.wallet === BUILDER) || { tokens: 0, used: 0 };
const users = rows.filter((r) => r.wallet !== BUILDER && r.tokens > 0).sort((a, b) => b.tokens - a.tokens);
const total = users.reduce((s, r) => s + r.tokens, 0);
const sorted = users.map((r) => r.tokens).sort((a, b) => a - b);
const bucket = (list, key, edges) => edges.map(([label, lo, hi]) => { const m = list.filter((r) => key(r) >= lo && key(r) <= hi); return { range: label, wallets: m.length, walletsPct: pct(m.length, list.length), tokens: m.reduce((s, r) => s + r.tokens, 0), tokensPct: pct(m.reduce((s, r) => s + r.tokens, 0), total) }; });
const share = (list, n) => pct(list.slice(0, n).reduce((s, v) => s + v, 0), list.reduce((s, v) => s + v, 0));
const group = (name) => { const idx = C.map((c, k) => (c[3] === name ? k : -1)).filter((k) => k >= 0); const per = users.map((r) => idx.reduce((s, k) => s + r.per[k], 0)).filter((v) => v > 0).sort((a, b) => b - a); return { tokens: per.reduce((s, v) => s + v, 0), wallets: per.length, top10SharePct: share(per, 10), top15SharePct: share(per, 15), mostByOneWallet: per[0] || 0 }; };

const out = {
  name: 'Forecast League transparency numbers',
  updated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  block,
  method: 'For every wallet in api/wallet/index.json, balanceOf(wallet) on each of the 12 Forecast League token contracts. The tokens cannot be transferred, so a balance is the number of mints that wallet sent to that contract. Anyone can repeat each read.',
  notCounted: 'Claims, squad calls and the daily price forecast leave no token and are not in these numbers, so real transaction counts are higher.',
  builderWallet: { address: BUILDER, tokens: builder.tokens, contractsUsed: builder.used, note: 'The one wallet the builder uses. It is left out of every number below.' },
  wallets: users.length,
  tokens: total,
  tokensPerWallet: { median: sorted[Math.floor((sorted.length - 1) / 2)] || 0, mean: users.length ? Math.round((10 * total) / users.length) / 10 : 0, most: sorted[sorted.length - 1] || 0 },
  distribution: bucket(users, (r) => r.tokens, [['1', 1, 1], ['2-3', 2, 3], ['4-9', 4, 9], ['10-19', 10, 19], ['20-49', 20, 49], ['50 or more', 50, 1e9]]),
  concentration: { top10SharePct: share(users.map((r) => r.tokens), 10), top15SharePct: share(users.map((r) => r.tokens), 15), top10: users.slice(0, 10).map((r) => ({ wallet: r.wallet, tokens: r.tokens, contractsUsed: r.used })) },
  contractsUsed: bucket(users, (r) => r.used, [['1', 1, 1], ['2-3', 2, 3], ['4-7', 4, 7], ['8 or more', 8, 99]]).map(({ range, wallets, walletsPct }) => ({ range, wallets, walletsPct })),
  groups: { hourly: group('hourly'), sixHour: group('sixHour'), daily: group('daily'), card: group('card'), extras: group('extras') },
  byContract: C.map(([id, label, contract], k) => { const per = users.map((r) => r.per[k]).filter((v) => v > 0).sort((a, b) => b - a); return { id, label, contract, wallets: per.length, tokens: per.reduce((s, v) => s + v, 0), top15SharePct: share(per, 15) }; }),
};
writeFileSync('docs/api/transparency.json', JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ ok: true, wallets: out.wallets, tokens: out.tokens, top10SharePct: out.concentration.top10SharePct, hourlyTop15SharePct: out.groups.hourly.top15SharePct, builderTokens: builder.tokens }));
