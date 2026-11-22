#!/usr/bin/env node
// Agents vs the Binance Prediction market, on the same hours. Read-only.
//
// Inputs:
//   launch/data/binance_prediction_quotes.jsonl  Binance Prediction "1 hour" Up/Down quotes, read once an hour
//                                                about 45 s after the round starts (baw prediction market list,
//                                                read-only, by the builder's session) and committed as they are.
//   docs/api/picks/ledger.json                   every Forecast League ticket and the call that minted it (keeper/picks.mjs).
//   resultOf(round) on the three hourly markets   Chainlink start and end prices recorded by the contracts.
//   Binance spot 1h candles (public data-api)     the feed Binance Prediction's hourly rounds settle on.
//
// The window compared is one clock hour H:00 to H+1:00 UTC. Binance Prediction's round for that hour starts
// at H:00. Forecast League's hourly ticket for that hour was taken during the hour before (round H-1, locked at H:00).
// Only PICKED tickets (up() or down()) count as the agents' view; assigned tickets (mint()) are coin flips and are left out.
//
// Output: docs/api/vs-market.json (per hour and totals) and docs/api/crowd.json (picked up/down counts per
// open and locked round, the input for skills/forecast-league/scripts/crowd_hook.py).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const RPCS = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed.binance.org'];
const MC = '0xcA11bde05977b3631167028862bE2a173976CA11';
const KLINES = ['https://data-api.binance.vision', 'https://api.binance.com'];
const BUILDER = '0x2a2f48145780639dbd91e748df157f35283165da';
const QUOTES = 'launch/data/binance_prediction_quotes.jsonl';
const LEDGER = 'docs/api/picks/ledger.json';
const HOURLY = {
  BTCUSDT: ['BTC 1h', '0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629'],
  ETHUSDT: ['ETH 1h', '0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4'],
  BNBUSDT: ['BNB 1h', '0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736'],
};
const PERIOD = { '1h': 3600, '6h': 21600, '1d': 86400 };
const MARKETS = ['BTC 6h', 'ETH 6h', 'BNB 6h', 'BTC 1h', 'ETH 1h', 'BNB 1h', 'BTC 1d'];
const word = (n) => BigInt(n).toString(16).padStart(64, '0');

let rr = 0;
async function rpc(method, params) {
  for (let a = 0; a < 6; a++) {
    try {
      const r = await (await fetch(RPCS[rr++ % RPCS.length], { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30000) })).json();
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
async function multi(calls) {
  const out = [];
  for (let i = 0; i < calls.length; i += 200) out.push(...dec(await rpc('eth_call', [{ to: MC, data: enc(calls.slice(i, i + 200)) }, 'latest'])));
  return out;
}
const slot = (hex, i) => BigInt('0x' + (hex.slice(2 + i * 64, 2 + (i + 1) * 64) || '0'));
async function klines(symbol, fromSec) {
  for (const base of KLINES) {
    try {
      const r = await fetch(`${base}/api/v3/klines?symbol=${symbol}&interval=1h&startTime=${fromSec * 1000}&limit=1000`, { signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      if (Array.isArray(j)) return new Map(j.map((c) => [Math.floor(c[0] / 1000), { open: Number(c[1]), close: Number(c[4]), closeTime: Math.floor(c[6] / 1000) }]));
    } catch {}
  }
  return new Map();
}
const brier = (p, o) => (p - o) ** 2;
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);
function wilson(h, n) {
  if (!n) return null;
  const z = 1.96, p = h / n, c = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const m = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return [r4(c - m), r4(c + m)];
}

const now = Math.floor(Date.now() / 1000);
const led = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { tickets: [] };
const isPicked = (h) => h === 'up' || h === 'down' || h === 'picked-indirect';
const picked = led.tickets.filter((t) => t.holder && t.holder !== BUILDER && isPicked(t.how));
const crowdOf = (m, round) => {
  const a = picked.filter((t) => t.m === m && t.round === round);
  return { up: a.filter((t) => t.up).length, down: a.filter((t) => !t.up).length, wallets: new Set(a.map((t) => t.holder)).size };
};

// 1. crowd.json: the picked side counts for every market's open and locked rounds.
const crowd = { name: 'Forecast League crowd: picked sides per round', updated: new Date(now * 1000).toISOString().slice(0, 19) + 'Z',
  ledgerScannedToBlock: led.scannedTo ?? null,
  method: 'Picked tickets only (up() or down(); mint() is an assigned side and is left out). The builder wallet is left out. Counts come from the picks ledger, refreshed hourly, so the open round can be missing its latest tickets.',
  markets: {} };
for (const m of MARKETS) {
  const len = PERIOD[m.split(' ')[1]], open = Math.floor(now / len);
  crowd.markets[m] = [open, open - 1].map((round) => ({ round, status: round === open ? 'open' : 'locked',
    windowStart: new Date((round + 1) * len * 1000).toISOString().slice(0, 16) + 'Z', windowEnd: new Date((round + 2) * len * 1000).toISOString().slice(0, 16) + 'Z', ...crowdOf(m, round) }));
}
writeFileSync('docs/api/crowd.json', JSON.stringify(crowd, null, 1) + '\n');

// 2. vs-market.json: per hour, the market's price for Up at the start, the agents' picked sides, both outcomes.
const quotes = existsSync(QUOTES) ? readFileSync(QUOTES, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
const first = new Map(); // first snapshot per (symbol, start), only if taken within 5 minutes of the start
for (const q of quotes) {
  if (q.timeframe !== '1 hour' || !HOURLY[q.symbol] || !q.start || q.snap - q.start > 300 || q.snap < q.start) continue;
  const k = q.symbol + ':' + q.start;
  if (!first.has(k) || first.get(k).snap > q.snap) first.set(k, q);
}
const rows = [];
for (const sym of Object.keys(HOURLY)) {
  const [m, addr] = HOURLY[sym];
  const qs = [...first.values()].filter((q) => q.symbol === sym && q.end && q.end < now - 120).sort((a, b) => a.start - b.start);
  if (!qs.length) continue;
  const kl = await klines(sym, qs[0].start);
  const res = await multi(qs.map((q) => [addr, '0xcdd20022' + word(q.start / 3600 - 1)]));
  qs.forEach((q, i) => {
    const up = Number(q.up), down = Number(q.down);
    const pUp = up + down > 0 ? up / (up + down) : null;
    const k = kl.get(q.start), sp = Number(q.startPrice);
    const binance = k && k.closeTime < now && sp ? (k.close > sp ? 1 : k.close < sp ? 0 : null) : null;
    const o = res[i][0] ? Number(slot(res[i][1], 2)) : 0;
    const chainlink = o === 1 ? 1 : o === 2 ? 0 : null;
    const c = crowdOf(m, q.start / 3600 - 1);
    rows.push({ market: m, hour: new Date(q.start * 1000).toISOString().slice(0, 16) + 'Z', quoteAtSec: q.snap - q.start,
      marketPUp: r4(pUp), feeBps: q.feeBps ?? null, binanceUp: binance, chainlinkUp: chainlink,
      binanceStart: sp || null, binanceClose: k ? k.close : null,
      chainlinkStart: res[i][0] ? Number(slot(res[i][1], 0)) / 1e8 || null : null, chainlinkEnd: res[i][0] ? Number(slot(res[i][1], 1)) / 1e8 || null : null,
      agentsUp: c.up, agentsDown: c.down, agentWallets: c.wallets });
  });
}
rows.sort((a, b) => (a.hour < b.hour ? -1 : a.hour > b.hour ? 1 : a.market < b.market ? -1 : 1));
const priced = rows.filter((r) => r.marketPUp != null && r.binanceUp != null);
const both = rows.filter((r) => r.binanceUp != null && r.chainlinkUp != null);
const withAgents = rows.filter((r) => r.agentsUp + r.agentsDown > 0 && r.agentsUp !== r.agentsDown && r.chainlinkUp != null && r.marketPUp != null && r.binanceUp != null);
const agentRight = withAgents.filter((r) => (r.agentsUp > r.agentsDown ? 1 : 0) === r.chainlinkUp).length;
const marketFavRight = withAgents.filter((r) => r.marketPUp !== 0.5 && (r.marketPUp > 0.5 ? 1 : 0) === r.binanceUp).length;
const agentP = (r) => (r.agentsUp + 1) / (r.agentsUp + r.agentsDown + 2); // shrunk toward 0.5 when only a few agents picked
const out = {
  name: 'Agents vs the Binance Prediction market, same hours',
  updated: crowd.updated,
  hoursQuoted: rows.length,
  method: [
    'Window: one clock hour H:00 to H+1:00 UTC, BTC, ETH and BNB.',
    "Market: Binance Prediction's 1 hour Up/Down round for that hour; marketPUp = Up price / (Up + Down), read once by the builder's session about 45 s after the round starts (read-only, baw prediction market list). Hours without a quote in the first 5 minutes are left out.",
    "Market outcome: Binance spot 1h candle close vs the round's published start price (the feed those rounds settle on).",
    'Agents: picked tickets (up() or down()) in the Forecast League hourly market for the same hour (taken during the hour before; builder wallet left out). Agent outcome: Chainlink, as the contract recorded it.',
    'Brier: mean squared error of a probability for Up against the outcome (0 best; 0.25 for always 0.5). Agents: (up + 1) / (picked + 2).',
  ],
  totals: {
    marketBrier: priced.length ? r4(priced.reduce((s, r) => s + brier(r.marketPUp, r.binanceUp), 0) / priced.length) : null,
    marketBrierHours: priced.length,
    coinFlipBrier: 0.25,
    feedsAgree: both.length ? r4(both.filter((r) => r.binanceUp === r.chainlinkUp).length / both.length) : null,
    feedsCompared: both.length,
    hoursWithAgentPicks: withAgents.length,
    agentsMajorityRight: agentRight,
    agentsHitRate: withAgents.length ? r4(agentRight / withAgents.length) : null,
    agentsHitRateCi95: wilson(agentRight, withAgents.length),
    agentsBrier: withAgents.length ? r4(withAgents.reduce((s, r) => s + brier(agentP(r), r.chainlinkUp), 0) / withAgents.length) : null,
    marketFavouriteRightSameHours: marketFavRight,
    marketBrierSameHours: withAgents.length ? r4(withAgents.reduce((s, r) => s + brier(r.marketPUp, r.binanceUp), 0) / withAgents.length) : null,
  },
  limits: 'Small samples: read the interval, not the point. Binance Prediction prices include a fee (feeBps) and an overround, so a quote is not a clean probability. The two feeds can disagree on small moves (feedsAgree).',
  hours: rows.slice(-500),
};
writeFileSync('docs/api/vs-market.json', JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ ok: true, hours: rows.length, ...out.totals }));
