#!/usr/bin/env node
// Daily prize tally for Forecast League. Read-only: it prints who had the highest share of winning
// tickets (at least 5 decided) among rounds whose result time fell on one UTC day, over all round markets. It sends nothing.
//   node keeper/prize.mjs [--day YYYY-MM-DD]      (default: yesterday, UTC)
const RPC = process.env.LEAGUE_RPC || 'https://bsc-rpc.publicnode.com';
const MULTICALL = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MIN_TICKETS = 5; // decided tickets (won or lost) needed to be ranked
const BUILDER = '0x2a2f48145780639dbd91e748df157f35283165da'; // the builder's wallet is not eligible
const MARKETS = [
  ['Blitz BTC 6h', '0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C', 21600],
  ['Blitz ETH 6h', '0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1', 21600],
  ['Blitz BNB 6h', '0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9', 21600],
  ['Hourly BTC', '0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629', 3600],
  ['Hourly ETH', '0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4', 3600],
  ['Hourly BNB', '0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736', 3600],
  ['Daily BTC', '0x9e521add6F67EEe0Fe5c0b8ef32cb4543f7af50E', 86400],
];
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.slice(2).toLowerCase().padStart(64, '0');
const slot = (hex, i) => BigInt('0x' + (hex.slice(2 + i * 64, 2 + (i + 1) * 64) || '0'));
async function call(to, data) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) });
      const body = await res.json(); if (body.error) throw new Error(body.error.message); return body.result;
    } catch (e) { if (attempt >= 3) throw e; await new Promise((r) => setTimeout(r, 600 * (attempt + 1))); }
  }
}
function encode(calls) {
  const heads = []; const bodies = []; let offset = calls.length * 32;
  for (const c of calls) { const data = c.data.slice(2); const len = data.length / 2;
    const body = addrWord(c.to) + word(1) + word(0x60) + word(len) + data.padEnd(Math.ceil(len / 32) * 64, '0');
    heads.push(word(offset)); bodies.push(body); offset += body.length / 2; }
  return '0x82ad56cb' + word(0x20) + word(calls.length) + heads.join('') + bodies.join('');
}
function decode(hex) {
  const h = hex.slice(2); const at = (pos) => parseInt(h.substr(pos * 2, 64), 16);
  const base = at(0); const n = at(base); const start = base + 32; const out = [];
  for (let i = 0; i < n; i++) { const el = start + at(start + i * 32); const dataPos = el + at(el + 32);
    out.push(at(el) === 1 ? '0x' + h.substr((dataPos + 32) * 2, at(dataPos) * 2) : null); }
  return out;
}
async function multicall(calls) { const out = []; for (let i = 0; i < calls.length; i += 200) out.push(...decode(await call(MULTICALL, encode(calls.slice(i, i + 200))))); return out; }

const arg = process.argv.indexOf('--day');
const dayText = arg > 0 ? process.argv[arg + 1] : new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const dayStart = Date.parse(dayText + 'T00:00:00Z') / 1000; const dayEnd = dayStart + 86400;
if (!Number.isFinite(dayStart)) { console.error('Use --day YYYY-MM-DD'); process.exit(1); }

const players = new Map(); // wallet -> { wins, losses, first }
const unsettled = [];
for (const [label, market, length] of MARKETS) {
  const supply = Number(slot(await call(market, '0x18160ddd'), 0));
  if (!supply) continue;
  const ids = Array.from({ length: supply }, (_, i) => i + 1);
  const tickets = await multicall(ids.map((id) => ({ to: market, data: '0xc129ff32' + word(id) }))); // ticket(uint256)
  const rounds = new Set();
  tickets.forEach((t, i) => {
    if (!t) return;
    const holder = '0x' + t.slice(26, 66); const round = Number(slot(t, 1)); const status = Number(slot(t, 4));
    const target = (round + 2) * length; // the result time of the round
    if (target < dayStart || target >= dayEnd) return;
    if (status === 1) { rounds.add(round); return; } // finished, nobody settled it yet
    if (status !== 2 && status !== 3) return; // live, push or void: not counted
    if (holder === BUILDER) return;
    const p = players.get(holder) || { wins: 0, losses: 0, first: Infinity, markets: new Set() };
    if (status === 2) p.wins += 1; else p.losses += 1;
    p.first = Math.min(p.first, round * length * 1e6 + ids[i]); p.markets.add(label);
    players.set(holder, p);
  });
  for (const r of rounds) unsettled.push({ market: label, to: market, round: r, inputData: '0x61a6287f' + word(r) });
}
const table = [...players.entries()].map(([wallet, p]) => ({ wallet, wins: p.wins, losses: p.losses, rate: p.wins / (p.wins + p.losses), first: p.first, markets: p.markets.size }))
  .filter((r) => r.wins + r.losses >= MIN_TICKETS && r.wins > 0)
  .sort((a, b) => b.rate - a.rate || b.wins - a.wins || a.first - b.first);
console.log(JSON.stringify({
  ok: true, action: 'prize', day: dayText,
  rule: 'Highest share of winning tickets among rounds whose result time fell on this UTC day, over all round markets, with at least 5 decided tickets; ties by more wins, then by the earliest ticket. The builder\'s wallet is not eligible.',
  final: unsettled.length === 0,
  note: unsettled.length ? 'Some rounds of this day are not settled yet; settle them (calls below) and run again.' : undefined,
  winner: unsettled.length === 0 && table.length ? table[0].wallet : null,
  top: table.slice(0, 10).map(({ wallet, wins, losses, markets }) => ({ wallet, wins, losses, markets })),
  unsettledRounds: unsettled,
}, null, 2));
