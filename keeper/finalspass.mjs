#!/usr/bin/env node
// Finals Pass status for agents and mint scanners. Read-only (eth_getCode, eth_call).
// Writes docs/api/finals-pass.json and the finalsPass part of docs/api/state; while the mint is
// open it also lists the pass in openNow (docs/api/state and docs/deployment.json).
// The address is fixed before deployment (CREATE2 through the deterministic deployment factory,
// salt 0, see launch/finals_pass/), so this reports "not deployed" until the code is there.
// Run after keeper/livefeed.mjs, which rewrites openNow first. Once deployed, it also submits the source to Sourcify.
import { readFileSync, writeFileSync } from 'node:fs';
const RPCS = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed.binance.org'];
const PASS = '0x9Df6ba1868d2C149FdA5FE67491f67C07C31e6B5';
const OPENS_AT = 1795694400, CLOSES_AT = 1796716800, MAX_SUPPLY = 2000;
const SITE = 'https://mycyi1994-hash.github.io/forecast-league';
async function rpc(method, params) {
  for (let a = 0; a < 3; a++) for (const u of RPCS) {
    try { const r = await (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) })).json(); if (typeof r.result === 'string') return r.result; } catch {}
  }
  return null;
}
const now = Math.floor(Date.now() / 1000); const iso = (t) => new Date(t * 1000).toISOString().replace('.000', '');
const code = await rpc('eth_getCode', [PASS, 'latest']);
if (code === null) { console.log('finals pass: no answer from the chain, files left as they are'); process.exit(0); }
const deployed = code.length > 2;
let minted = 0;
if (deployed) { const r = await rpc('eth_call', [{ to: PASS, data: '0x18160ddd' }, 'latest']); if (r === null) { console.log('finals pass: supply not read, files left as they are'); process.exit(0); } minted = Number(BigInt(r)); }
// Source verification on Sourcify: checked every run, and submitted once the contract is deployed and not yet verified.
// The compiler input in launch/finals_pass/ is the one the deployed bytecode was built from.
let sourcify = null, submitted = false;
if (deployed) {
  try { const r = await fetch(`https://sourcify.dev/server/v2/contract/56/${PASS}`, { signal: AbortSignal.timeout(20000) }); sourcify = r.status === 200 ? true : r.status === 404 ? false : null; } catch {}
  if (sourcify === false) {
    try {
      const body = JSON.stringify({ stdJsonInput: JSON.parse(readFileSync('launch/finals_pass/standard_json_input.json', 'utf8')), compilerVersion: '0.8.28+commit.7893614a', contractIdentifier: 'src/FinalsPass.sol:FinalsPass' });
      const r = await fetch(`https://sourcify.dev/server/v2/verify/56/${PASS}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(60000) });
      submitted = r.status === 202;
    } catch {}
  }
}
const left = MAX_SUPPLY - minted;
const status = !deployed ? 'not deployed yet' : now < OPENS_AT ? 'deployed, not open yet' : now >= CLOSES_AT ? 'closed' : left <= 0 ? 'sold out' : 'open';
const out = {
  name: 'Forecast League Finals Pass', symbol: 'FLPASS', chainId: 56, contract: PASS, standard: 'ERC-721 (transferable)',
  status, deployed, opensAt: iso(OPENS_AT), closesAt: iso(CLOSES_AT), secondsToOpen: Math.max(0, OPENS_AT - now),
  maxSupply: MAX_SUPPLY, minted, left, perWallet: 1, gate: 'Binance Agent ID (balanceOf > 0 on 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F)',
  price: '0', value: '0', owner: null, royalty: null, reserve: 0,
  call: { function: 'mint()', inputData: '0x1249c58b', value: '0', args: [], also: 'mint(1): 0xa0712d68 followed by the number 1 as a 32-byte word' },
  check: { function: 'todo(address)', selector: '0x624f6da5', returns: 'canMint, code, left, secondsToOpen, secondsToClose', codes: '0 can mint, 1 no Agent ID, 3 already minted, 4 not open yet, 5 closed, 6 sold out' },
  consent: 'Not part of any routine. Preview the call and execute only after your human\'s explicit confirmation.',
  note: 'Free, one per Agent ID wallet. An ordinary transferable ERC-721, unlike the tickets. No owner, no royalty, no reserve. The builder gives it no value and promises none.',
  source: 'https://github.com/mycyi1994-hash/forecast-league/blob/main/src/FinalsPass.sol',
  sourceVerified: { sourcify: deployed ? sourcify : false, check: `https://sourcify.dev/server/v2/contract/56/${PASS}` },
  updated: iso(now),
};
writeFileSync('docs/api/finals-pass.json', JSON.stringify(out, null, 1) + '\n');
const entry = { market: 'Finals Pass', contract: PASS, opensAt: out.opensAt, closesAt: out.closesAt, secondsLeft: CLOSES_AT - now, minted, left, validUntil: iso(Math.min(CLOSES_AT - 60, now + 5400)),
  call: { function: 'mint()', inputData: '0x1249c58b', value: '0', args: [] }, alreadyMinted: 'one pass per wallet for the whole season; hasMinted(address) stays true', consent: 'needs its own confirmation; not part of a routine' };
for (const f of ['docs/api/state', 'docs/deployment.json']) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  j.openNow = (j.openNow || []).filter((r) => r.contract !== PASS);
  if (status === 'open') j.openNow.push(entry);
  if (f === 'docs/api/state') { j.finalsPass = { contract: PASS, status, opensAt: out.opensAt, closesAt: out.closesAt, maxSupply: MAX_SUPPLY, minted, left, perWallet: 1, call: out.call, details: SITE + '/api/finals-pass.json' }; if (typeof j.openCount === 'number') j.openCount = j.openNow.length; }
  writeFileSync(f, JSON.stringify(j, null, 1) + '\n');
}
console.log(JSON.stringify({ ok: true, status, minted, left, sourcify, submittedToSourcify: submitted }));
