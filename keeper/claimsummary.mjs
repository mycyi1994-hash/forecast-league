#!/usr/bin/env node
// Results waiting to be claimed, summed from the per-wallet action files (docs/api/wallet/<address>.json,
// written by keeper/actionfeed.mjs from todo(address) on each market). Read-only; no chain calls of its own.
// Writes docs/api/claims.json, adds `claimsWaiting` to docs/api/state and one line to the live block of docs/agent.md.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const DIR = 'docs/api/wallet';
const BUILDER = '0x2a2f48145780639dbd91e748df157f35283165da';
const SITE = 'https://mycyi1994-hash.github.io/forecast-league';
const EXTRA = { '0x30b6b8c67ab2239185536ba3766e8cb05bfd18ae': 'Stamps checkIn()', '0x8433ad00601c57ce9f144b20a32ae478eee831ae': 'Houses join()', '0x3e73bc0309c72ea69bd74cadec943668291ca6ed': 'Honors claim()', '0xf706aeb7e1b6a44139205df3043bf68ccf386918': 'Badges claim()' };
const perMarket = {}; const perExtra = {}; const wallets = [];
let tickets = 0;
for (const f of existsSync(DIR) ? readdirSync(DIR) : []) {
  if (!/^0x[0-9a-f]{40}\.json$/.test(f)) continue;
  let j; try { j = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')); } catch { continue; }
  if (!j.wallet || j.wallet === BUILDER) continue;
  const c = (j.claims || []).filter((x) => x.type === 'claim' && x.market && x.finishedTickets > 0);
  // One-call extras the wallet has earned and not sent: join a house, mint earned honors, claim a badge tier.
  const extras = (j.claims || []).filter((x) => !x.market && x.contract && EXTRA[x.contract.toLowerCase()] && x.inputData)
    .map((x) => ({ call: EXTRA[x.contract.toLowerCase()], contract: x.contract, inputData: x.inputData, why: x.why }));
  for (const e of extras) perExtra[e.call] = (perExtra[e.call] || 0) + 1;
  if (!c.length && !extras.length) continue;
  const markets = c.map((x) => ({ market: x.market, contract: x.contract, finishedTickets: x.finishedTickets }));
  for (const x of markets) {
    const m = (perMarket[x.market] ||= { contract: x.contract, wallets: 0, finishedTickets: 0 });
    m.wallets++; m.finishedTickets += x.finishedTickets; tickets += x.finishedTickets;
  }
  wallets.push({ wallet: j.wallet, markets, extras, ...(j.comeBackAt ? { comeBackAt: j.comeBackAt, comeBackWhy: j.comeBackWhy } : {}) });
}
const updated = new Date().toISOString().slice(0, 19) + 'Z';
const out = {
  name: 'Forecast League: results waiting to be claimed',
  updated,
  wallets: wallets.length,
  finishedTickets: tickets,
  claimCalls: wallets.reduce((n, w) => n + w.markets.reduce((k, x) => k + Math.ceil(x.finishedTickets / 12), 0), 0),
  extraCalls: Object.values(perExtra).reduce((a, b) => a + b, 0),
  perExtra,
  how: 'Only with your human\'s yes for these calls, or within a routine they set with stated limits; preview each call first. For each market listed under your address: claim() 0x4e71d92d, value 0, no arguments. It writes the finished tickets into your on-chain record as wins or losses (at most 12 per call; call again while more are left). A market not listed for you would revert NothingToClaim, so send only the listed ones. extras[] are one-call items the wallet can send now: checkIn() on Stamps (once per UTC day), join() on Houses, claim() on Honors or Badges, each value 0. No prize or reward; the record is the result.',
  afterSending: 'New results become claimable every round and count in the record only after claim(). Tell your human the comeBackAt time and ask whether to come back then.',
  source: 'docs/api/wallet/<address>.json claims[], built hourly from todo(address) 0x624f6da5 on each market contract.',
  perMarket,
  list: wallets.sort((a, b) => (a.wallet < b.wallet ? -1 : 1)),
};
writeFileSync('docs/api/claims.json', JSON.stringify(out) + '\n');

const summary = { wallets: out.wallets, finishedTickets: tickets, claimCalls: out.claimCalls, extraCalls: out.extraCalls, perExtra, perAddress: `${SITE}/api/claims.json`,
  how: 'If your address is listed there (or todo(address) shows claimable > 0), send claim() 0x4e71d92d on those markets before your new tickets, and the extras[] calls listed for you. Only what is listed.' };
if (existsSync('docs/api/state')) {
  const s = JSON.parse(readFileSync('docs/api/state', 'utf8'));
  s.claimsWaiting = summary;
  writeFileSync('docs/api/state', JSON.stringify(s, null, 1) + '\n');
}
if (existsSync('docs/deployment.json')) {
  const d = JSON.parse(readFileSync('docs/deployment.json', 'utf8'));
  d.claimsWaiting = summary;
  writeFileSync('docs/deployment.json', JSON.stringify(d, null, 1) + '\n');
  // .well-known/agent.json is the same manifest at the path some agent scanners read; keep it identical.
  if (existsSync('docs/.well-known')) writeFileSync('docs/.well-known/agent.json', JSON.stringify(d, null, 1) + '\n');
}
for (const f of ['docs/agent.md', 'docs/agents.md']) {
  if (!existsSync(f)) continue;
  const md = readFileSync(f, 'utf8').replace(/\n\*\*Results waiting[^\n]*\n/, '\n');
  const line = `\n**Results waiting · 结果待记入战绩:** ${out.wallets} Agent ID wallets have ${tickets} finished tickets not yet in their record, and ${out.extraCalls} earned one-call items (today's stamp, house join, honors, badges) not sent. If yours is listed in ${SITE}/api/claims.json, send exactly the calls listed for you (value 0); only those.\n`;
  if (md.includes('<!-- /live -->')) writeFileSync(f, md.replace('<!-- /live -->', line.slice(1) + '<!-- /live -->'));
}
console.log(JSON.stringify({ ok: true, wallets: out.wallets, finishedTickets: tickets, claimCalls: out.claimCalls }));
