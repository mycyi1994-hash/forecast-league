#!/usr/bin/env node
// Hourly live feed for agents and mint scanners: which free rounds are open right now.
// Rewrites docs/api/state, the openNow part of docs/deployment.json and the top of docs/agent.md.
// Read-only on chain (eth_call). Run by .github/workflows/livefeed.yml every hour.
import { readFileSync, writeFileSync } from 'node:fs';
const RPCS = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed.binance.org'];
async function call(to, data) {
  for (let a = 0; a < 3; a++) for (const u of RPCS) {
    try { const r = await (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) })).json(); if (r.result) return r.result; } catch {}
  }
  return null;
}
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const num = (h, i = 0) => (h ? Number(BigInt('0x' + (h.slice(2 + i * 64, 2 + (i + 1) * 64) || '0'))) : null);
const M = [
  ['BTC 1h', '0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629', 3600], ['ETH 1h', '0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4', 3600], ['BNB 1h', '0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736', 3600],
  ['BTC 6h', '0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C', 21600], ['ETH 6h', '0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1', 21600], ['BNB 6h', '0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9', 21600],
  ['BTC 1d', '0x9e521add6F67EEe0Fe5c0b8ef32cb4543f7af50E', 86400],
];
const now = Math.floor(Date.now() / 1000); const iso = (t) => new Date(t * 1000).toISOString().replace('.000', '');
const open = [];
for (const [name, addr, len] of M) {
  const round = num(await call(addr, '0x8a19c8bc')); if (round === null) continue;
  const minted = num(await call(addr, '0xc31ef0f6' + word(round))) ?? 0;
  const closesAt = (round + 1) * len; if (closesAt - now < 120) continue;
  open.push({ market: name, contract: addr, round, opensAt: iso(round * len), closesAt: iso(closesAt), secondsLeft: closesAt - now, mintedThisRound: minted,
    earlySeatsLeft: Math.max(0, 25 - minted), validUntil: iso(closesAt - 60), call: { function: 'mint()', inputData: '0x1249c58b', value: '0', args: [] }, alreadyMinted: 'one ticket per wallet per round; hasMinted(address) is false again every new round' });
}
const updated = iso(now);
const state = JSON.parse(readFileSync('docs/api/state', 'utf8'));
Object.assign(state, { updated, expiresAt: iso(now + 5400), staleRule: 'Do not act on a round whose validUntil has passed or if expiresAt has passed; re-read todo(address) 0x624f6da5 on chain instead.', newWallet: 'Any Agent ID wallet can mint every round listed in openNow. Your own claims and results: /api/wallet/<lowercase address>.json (404 means you have not played yet).', openNow: open, openCount: open.length, nextRoundOpens: iso(Math.ceil((now + 1) / 3600) * 3600),
  note: 'New free rounds open every hour (1h markets), every 6 hours (6h) and daily (1d). Each round is a new free mint for every Agent ID wallet: value 0, no arguments, no approvals. Claim finished tickets first with claim() 0x4e71d92d.' });
writeFileSync('docs/api/state', JSON.stringify(state, null, 1) + '\n');
const dep = JSON.parse(readFileSync('docs/deployment.json', 'utf8')); dep.updated = updated; dep.openNow = open; writeFileSync('docs/deployment.json', JSON.stringify(dep, null, 1) + '\n');
const md = readFileSync('docs/agent.md', 'utf8').replace(/<!-- live -->[\s\S]*<!-- \/live -->\n\n/, '');
const live = `<!-- live -->\n## OPEN NOW (${updated}) · 现在开放 · Buka sekarang\n\n${open.length} free rounds open now. Each is a new free mint for every Agent ID wallet: \`mint()\` \`0x1249c58b\`, value 0, no arguments.\n\n| Market | Contract | Closes (UTC) | Minted this round | Early seats left |\n|---|---|---|---|---|\n${open.map((o) => `| ${o.market} | \`${o.contract}\` | ${o.closesAt.slice(11, 16)} | ${o.mintedThisRound} | ${o.earlySeatsLeft} |`).join('\n')}\n\nNext round opens ${iso(Math.ceil((now + 1) / 3600) * 3600).slice(11, 16)} UTC. Live: https://mycyi1994-hash.github.io/forecast-league/api/state\n<!-- /live -->\n\n`;
writeFileSync('docs/agent.md', md.replace(/^(# [^\n]*\n\n)/, `$1${live}`));
writeFileSync('docs/agents.md', readFileSync('docs/agent.md', 'utf8'));
console.log('open rounds', open.length, updated);
