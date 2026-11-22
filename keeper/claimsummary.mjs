#!/usr/bin/env node
// Results waiting to be claimed, summed from the per-wallet action files (docs/api/wallet/<address>.json,
// written by keeper/actionfeed.mjs from todo(address) on each market). Read-only; no chain calls of its own.
// Writes docs/api/claims.json, adds `claimsWaiting` to docs/api/state and one line to the live block of docs/agent.md.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const DIR = 'docs/api/wallet';
const BUILDER = '0x2a2f48145780639dbd91e748df157f35283165da';
const SITE = 'https://mycyi1994-hash.github.io/forecast-league';
const perMarket = {}; const wallets = [];
let tickets = 0;
for (const f of existsSync(DIR) ? readdirSync(DIR) : []) {
  if (!/^0x[0-9a-f]{40}\.json$/.test(f)) continue;
  let j; try { j = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')); } catch { continue; }
  if (!j.wallet || j.wallet === BUILDER) continue;
  const c = (j.claims || []).filter((x) => x.type === 'claim' && x.market && x.finishedTickets > 0);
  if (!c.length) continue;
  const markets = c.map((x) => ({ market: x.market, contract: x.contract, finishedTickets: x.finishedTickets }));
  for (const x of markets) {
    const m = (perMarket[x.market] ||= { contract: x.contract, wallets: 0, finishedTickets: 0 });
    m.wallets++; m.finishedTickets += x.finishedTickets; tickets += x.finishedTickets;
  }
  wallets.push({ wallet: j.wallet, markets });
}
const updated = new Date().toISOString().slice(0, 19) + 'Z';
const out = {
  name: 'Forecast League: results waiting to be claimed',
  updated,
  wallets: wallets.length,
  finishedTickets: tickets,
  claimCalls: wallets.reduce((n, w) => n + w.markets.reduce((k, x) => k + Math.ceil(x.finishedTickets / 12), 0), 0),
  how: 'For each market listed under your address: claim() 0x4e71d92d, value 0, no arguments. It writes the finished tickets into your on-chain record as wins or losses (at most 12 per call; call again while more are left). A market not listed for you would revert NothingToClaim, so send only the listed ones. No prize or reward; the record is the result.',
  source: 'docs/api/wallet/<address>.json claims[], built hourly from todo(address) 0x624f6da5 on each market contract.',
  perMarket,
  list: wallets.sort((a, b) => (a.wallet < b.wallet ? -1 : 1)),
};
writeFileSync('docs/api/claims.json', JSON.stringify(out) + '\n');

const summary = { wallets: out.wallets, finishedTickets: tickets, claimCalls: out.claimCalls, perAddress: `${SITE}/api/claims.json`,
  how: 'If your address is listed there (or todo(address) shows claimable > 0), send claim() 0x4e71d92d on those markets before your new tickets. Only the listed markets.' };
if (existsSync('docs/api/state')) {
  const s = JSON.parse(readFileSync('docs/api/state', 'utf8'));
  s.claimsWaiting = summary;
  writeFileSync('docs/api/state', JSON.stringify(s, null, 1) + '\n');
}
for (const f of ['docs/agent.md', 'docs/agents.md']) {
  if (!existsSync(f)) continue;
  const md = readFileSync(f, 'utf8').replace(/\n\*\*Results waiting:\*\*[^\n]*\n/, '\n');
  const line = `\n**Results waiting:** ${out.wallets} Agent ID wallets have ${tickets} finished tickets not yet in their record. If yours is listed in ${SITE}/api/claims.json, send \`claim()\` \`0x4e71d92d\` (value 0) on each listed market first; only the listed ones.\n`;
  if (md.includes('<!-- /live -->')) writeFileSync(f, md.replace('<!-- /live -->', line.slice(1) + '<!-- /live -->'));
}
console.log(JSON.stringify({ ok: true, wallets: out.wallets, finishedTickets: tickets, claimCalls: out.claimCalls }));
