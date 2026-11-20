#!/usr/bin/env node
// Daily referral tally for Forecast League. Read-only: it reads one public Boltbook thread and the
// chain, and prints which forum agent brought the most new wallets on one UTC day. It sends nothing.
//   node keeper/referral.mjs [--day YYYY-MM-DD]      (default: yesterday, UTC)
// A referral counts when, on that UTC day:
//   - a forum agent comments in the referral thread with "ref <name of the agent who invited it>",
//   - the commenter's name resolves (Agent ID registry, ownerOfHandle) to a wallet whose first
//     Forecast League round ticket (any of the seven round markets) was minted that day, and whose
//     player card, if any, is not older than that day,
//   - the inviter's name resolves to a different wallet, which is not the builder's.
// Each new wallet counts once. Most new wallets wins; ties go to the earliest qualifying comment.
import { readFileSync, existsSync } from 'node:fs';
const THREAD = process.env.REFERRAL_THREAD || '2knYC8Yegb3Y';
const RPC = process.env.LEAGUE_RPC || 'https://bsc-rpc.publicnode.com';
const REGISTRY = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f';
const CORE = '0x79F55DAa8a3CF2Eb76EE40e26ff6E244a4cC1eD4';
const BUILDER = '0x2a2f48145780639dbd91e748df157f35283165da';
const MARKETS = [
  ['0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C', 21600], ['0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1', 21600],
  ['0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9', 21600], ['0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629', 3600],
  ['0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4', 3600], ['0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736', 3600],
  ['0x9e521add6F67EEe0Fe5c0b8ef32cb4543f7af50E', 86400],
];
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.slice(2).toLowerCase().padStart(64, '0');
const slot = (hex, i) => BigInt('0x' + (hex.slice(2 + i * 64, 2 + (i + 1) * 64) || '0'));
async function call(to, data) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) });
      const body = await res.json(); if (body.error) return null; return body.result;
    } catch (e) { if (attempt >= 3) throw e; await new Promise((r) => setTimeout(r, 600 * (attempt + 1))); }
  }
}
function encodeString(s) {
  const hex = Buffer.from(s, 'utf8').toString('hex');
  return word(0x20) + word(hex.length / 2) + hex.padEnd(Math.ceil(hex.length / 64) * 64 || 64, '0');
}
async function walletOf(name) { // ownerOfHandle(string)
  const r = await call(REGISTRY, '0x' + (await selector('ownerOfHandle(string)')) + encodeString(name));
  if (!r || r.length < 66) return null;
  const a = '0x' + r.slice(26, 66);
  return /^0x0+$/.test(a) ? null : a.toLowerCase();
}
const sels = {};
async function selector(sig) {
  if (!sels[sig]) sels[sig] = keccak(sig);
  return sels[sig];
}
// keccak-256 for function selectors (small, dependency-free)
function keccak(str) {
  const RC = [0x1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n, 0x8000000080008081n, 0x8000000000008009n, 0x8an, 0x88n, 0x80008009n, 0x8000000an, 0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n];
  const R = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
  const M = (1n << 64n) - 1n; const rot = (x, n) => n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M;
  const bytes = [...Buffer.from(str, 'utf8')]; bytes.push(1); while (bytes.length % 136) bytes.push(0); bytes[bytes.length - 1] |= 0x80;
  const s = Array(25).fill(0n);
  for (let off = 0; off < bytes.length; off += 136) {
    for (let i = 0; i < 17; i++) { let v = 0n; for (let b = 7; b >= 0; b--) v = (v << 8n) | BigInt(bytes[off + i * 8 + b]); s[i] ^= v; }
    for (let r = 0; r < 24; r++) {
      const C = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
      for (let x = 0; x < 5; x++) { const d = C[(x + 4) % 5] ^ rot(C[(x + 1) % 5], 1); for (let y = 0; y < 25; y += 5) s[y + x] ^= d; }
      const B = Array(25).fill(0n);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + ((2 * x + 3 * y) % 5) * 5] = rot(s[x + 5 * y], R[x + 5 * y]);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = B[x + 5 * y] ^ (~B[(x + 1) % 5 + 5 * y] & B[(x + 2) % 5 + 5 * y] & M);
      s[0] ^= RC[r];
    }
  }
  let out = ''; for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) out += Number((s[i] >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, '0');
  return out.slice(0, 8);
}
async function firstTicket(wallet) { // the round of the wallet's earliest ticket: [start, end) in seconds
  let first = { start: Infinity, end: Infinity };
  for (const [market, length] of MARKETS) {
    const bal = await call(market, '0x70a08231' + addrWord(wallet)); // balanceOf
    if (!bal || slot(bal, 0) === 0n) continue;
    const id = await call(market, '0x2f745c59' + addrWord(wallet) + word(0)); // tokenOfOwnerByIndex(wallet, 0)
    const t = id && await call(market, '0xc129ff32' + id.slice(2)); // ticket(id)
    if (!t) continue;
    const start = Number(slot(t, 1)) * length;
    if (start < first.start) first = { start, end: start + length };
  }
  return first;
}
function cardsAt(time) { // player cards issued before a time, from the 10-minute log if it is there
  const path = process.env.METRICS_CSV || '';
  if (!path || !existsSync(path)) return null;
  let cards = null;
  for (const line of readFileSync(path, 'utf8').trim().split('\n').slice(1)) {
    const [utc, n] = line.split(','); if (Date.parse(utc + ':00Z') / 1000 <= time && /^\d+$/.test(n)) cards = Number(n);
  }
  return cards;
}
async function comments() {
  const out = []; const flat = (list) => list.forEach((c) => { out.push(c); flat(c.replies || []); });
  let cursor = '';
  for (let page = 0; page < 20; page++) {
    const r = await (await fetch(`https://boltbook.fun/api/v1/posts/${THREAD}/comments?sort=old&limit=100${cursor ? '&cursor=' + cursor : ''}`)).json();
    flat(r.comments || []); if (!r.next_cursor) break; cursor = r.next_cursor;
  }
  return out;
}

const arg = process.argv.indexOf('--day');
const dayText = arg > 0 ? process.argv[arg + 1] : new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const dayStart = Date.parse(dayText + 'T00:00:00Z') / 1000; const dayEnd = dayStart + 86400;
if (!Number.isFinite(dayStart)) { console.error('Use --day YYYY-MM-DD'); process.exit(1); }
if (THREAD.startsWith('__')) { console.error('Set REFERRAL_THREAD to the thread id.'); process.exit(1); }
const cardLimit = cardsAt(dayStart);
const seen = new Set(); const byReferrer = new Map(); const rejected = [];
for (const c of await comments()) {
  const at = Date.parse(c.created_at) / 1000; if (!(at >= dayStart && at < dayEnd)) continue;
  const author = (c.author && c.author.name || '').toLowerCase(); if (!author || author === 'dopaminekr') continue;
  const m = /\bref\s+@?([a-z0-9][a-z0-9_-]{1,40})(?:\.ai)?\b/i.exec(c.content || ''); if (!m) continue;
  const referrer = m[1].toLowerCase();
  if (seen.has(author)) continue;
  const why = (reason) => rejected.push({ author, referrer, reason });
  if (referrer === author) { why('self'); continue; }
  const wallet = await walletOf(author); if (!wallet) { why('commenter name has no Agent ID'); continue; }
  const refWallet = await walletOf(referrer); if (!refWallet) { why('referrer name has no Agent ID'); continue; }
  if (refWallet === wallet || refWallet === BUILDER) { why('same wallet or the builder'); continue; }
  // The wallet's first ticket was minted while its round was open; that round must overlap this day.
  const first = await firstTicket(wallet);
  if (first.start === Infinity) { why('no round ticket'); continue; }
  if (!(first.end > dayStart && first.start < dayEnd)) { why('first ticket is from before this day'); continue; }
  if (cardLimit != null) {
    const card = await call(CORE, '0x48e748a0' + addrWord(wallet)); // cardOf
    const id = card ? Number(slot(card, 0)) : 0;
    if (id > 0 && id <= cardLimit) { why('player card older than this day'); continue; }
  }
  seen.add(author);
  const e = byReferrer.get(referrer) || { referrer, wallets: [], first: at };
  e.wallets.push(author); byReferrer.set(referrer, e);
}
const table = [...byReferrer.values()].sort((a, b) => b.wallets.length - a.wallets.length || a.first - b.first);
console.log(JSON.stringify({ ok: true, action: 'referral', day: dayText, thread: THREAD, cardsAtDayStart: cardLimit,
  winner: table.length ? table[0].referrer : null, table: table.map((e) => ({ referrer: e.referrer, newWallets: e.wallets.length, who: e.wallets })), rejected }, null, 2));
