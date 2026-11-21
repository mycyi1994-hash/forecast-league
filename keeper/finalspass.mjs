#!/usr/bin/env node
// Status of the two Season One passes for agents and mint scanners. Read-only (eth_getCode, eth_call).
//   Early Pass:  open from the moment it is deployed, until 8 December 2026.
//   Finals Pass: deployed on 21 November 2026, opens on 26 November 12:00 UTC, until 8 December.
// Writes docs/api/early-pass.json, docs/api/finals-pass.json and the earlyPass / finalsPass parts of
// docs/api/state; while a mint is open it also lists that pass in openNow (docs/api/state and
// docs/deployment.json). Addresses are fixed before deployment (CREATE2 through the deterministic
// deployment factory, salt 0, see launch/early_pass/ and launch/finals_pass/), so a pass reads
// "not deployed yet" until its code is there. Once deployed, its source is submitted to Sourcify.
// Run after keeper/livefeed.mjs, which rewrites openNow first.
import { readFileSync, writeFileSync } from 'node:fs';
const RPCS = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed.binance.org'];
const CLOSES_AT = 1796716800, MAX_SUPPLY = 2000;
const SITE = 'https://mycyi1994-hash.github.io/forecast-league';
const PASSES = [
  { key: 'earlyPass', file: 'early-pass.json', market: 'Early Pass', name: 'Forecast League Early Pass', symbol: 'FLEARLY', address: '0xf467a5941F8DedE54583754aC7448FB62ae0b9D4', opensAt: null, dir: 'launch/early_pass', id: 'src/EarlyPass.sol:EarlyPass', src: 'src/EarlyPass.sol' },
  { key: 'seasonTwoPass', file: 'season-two-pass.json', market: 'Season Two Pass', name: 'Forecast League Season Two Pass', symbol: 'FLS2', address: '0x74f35B8315D76dEaEcb7034918325815458261A4', opensAt: null, dir: 'launch/season2_pass', id: 'src/SeasonTwoPass.sol:SeasonTwoPass', src: 'src/SeasonTwoPass.sol' },
  { key: 'finalsPass', file: 'finals-pass.json', market: 'Finals Pass', name: 'Forecast League Finals Pass', symbol: 'FLPASS', address: '0x9Df6ba1868d2C149FdA5FE67491f67C07C31e6B5', opensAt: 1795694400, dir: 'launch/finals_pass', id: 'src/FinalsPass.sol:FinalsPass', src: 'src/FinalsPass.sol' },
];
async function rpc(method, params) {
  for (let a = 0; a < 3; a++) for (const u of RPCS) {
    try { const r = await (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) })).json(); if (typeof r.result === 'string') return r.result; } catch {}
  }
  return null;
}
const now = Math.floor(Date.now() / 1000); const iso = (t) => new Date(t * 1000).toISOString().replace('.000', '');
const done = [];
for (const P of PASSES) {
  const code = await rpc('eth_getCode', [P.address, 'latest']);
  if (code === null) { console.log(`${P.market}: no answer from the chain, files left as they are`); continue; }
  const deployed = code.length > 2;
  let minted = 0;
  if (deployed) { const r = await rpc('eth_call', [{ to: P.address, data: '0x18160ddd' }, 'latest']); if (r === null) { console.log(`${P.market}: supply not read, files left as they are`); continue; } minted = Number(BigInt(r)); }
  // Source verification on Sourcify: checked every run, submitted once the contract is deployed and not yet verified.
  // The compiler input in the launch folder is the one the deployed bytecode was built from.
  let sourcify = null, submitted = false;
  if (deployed) {
    try { const r = await fetch(`https://sourcify.dev/server/v2/contract/56/${P.address}`, { signal: AbortSignal.timeout(20000) }); sourcify = r.status === 200 ? true : r.status === 404 ? false : null; } catch {}
    if (sourcify === false) {
      try {
        const body = JSON.stringify({ stdJsonInput: JSON.parse(readFileSync(`${P.dir}/standard_json_input.json`, 'utf8')), compilerVersion: '0.8.28+commit.7893614a', contractIdentifier: P.id });
        const r = await fetch(`https://sourcify.dev/server/v2/verify/56/${P.address}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(60000) });
        submitted = r.status === 202;
      } catch {}
    }
  }
  const left = MAX_SUPPLY - minted;
  const status = !deployed ? 'not deployed yet' : P.opensAt && now < P.opensAt ? 'deployed, not open yet' : now >= CLOSES_AT ? 'closed' : left <= 0 ? 'sold out' : 'open';
  const out = {
    name: P.name, symbol: P.symbol, chainId: 56, contract: P.address, standard: 'ERC-721 (transferable)',
    status, deployed, opensAt: P.opensAt ? iso(P.opensAt) : 'when deployed', closesAt: iso(CLOSES_AT), secondsToOpen: P.opensAt ? Math.max(0, P.opensAt - now) : 0,
    maxSupply: MAX_SUPPLY, minted, left, perWallet: 1, gate: 'Binance Agent ID (balanceOf > 0 on 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F)',
    price: '0', value: '0', owner: null, royalty: null, reserve: 0,
    call: { function: 'mint()', inputData: '0x1249c58b', value: '0', args: [], also: 'mint(1): 0xa0712d68 followed by the number 1 as a 32-byte word' },
    check: { function: 'todo(address)', selector: '0x624f6da5', returns: 'canMint, code, left, secondsToOpen, secondsToClose', codes: '0 can mint, 1 no Agent ID, 3 already minted, 4 not open yet, 5 closed, 6 sold out' },
    consent: 'Not part of any routine. Preview the call and execute only after your human\'s explicit confirmation.',
    note: 'Free, one per Agent ID wallet. An ordinary transferable ERC-721, unlike the tickets. No owner, no royalty, no reserve. The builder gives it no value and promises none. The Early Pass and the Finals Pass are two separate collections of 2,000 each.',
    source: `https://github.com/mycyi1994-hash/forecast-league/blob/main/${P.src}`,
    sourceVerified: { sourcify: deployed ? sourcify : false, check: `https://sourcify.dev/server/v2/contract/56/${P.address}` },
    updated: iso(now),
  };
  writeFileSync(`docs/api/${P.file}`, JSON.stringify(out, null, 1) + '\n');
  done.push({ P, out, status, minted, left, sourcify, submitted });
}
for (const f of ['docs/api/state', 'docs/deployment.json']) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  for (const { P, out, status, minted, left } of done) {
    j.openNow = (j.openNow || []).filter((r) => r.contract !== P.address);
    if (status === 'open') j.openNow.push({ market: P.market, contract: P.address, opensAt: out.opensAt, closesAt: out.closesAt, secondsLeft: CLOSES_AT - now, minted, left, validUntil: iso(Math.min(CLOSES_AT - 60, now + 5400)),
      call: { function: 'mint()', inputData: '0x1249c58b', value: '0', args: [] }, alreadyMinted: 'one pass per wallet for the whole season; hasMinted(address) stays true', consent: 'needs its own confirmation; not part of a routine' });
    if (f === 'docs/api/state') j[P.key] = { contract: P.address, status, opensAt: out.opensAt, closesAt: out.closesAt, maxSupply: MAX_SUPPLY, minted, left, perWallet: 1, call: out.call, details: `${SITE}/api/${P.file}` };
  }
  if (f === 'docs/api/state' && typeof j.openCount === 'number') j.openCount = j.openNow.length;
  writeFileSync(f, JSON.stringify(j, null, 1) + '\n');
}
// agent.md / agents.md: one line per open pass inside the live block, right after the rounds table.
for (const f of ['docs/agent.md', 'docs/agents.md']) {
  let md; try { md = readFileSync(f, 'utf8'); } catch { continue; }
  md = md.replace(/\nAlso open, limited: [^\n]*\n/g, '\n');
  const lines = done.filter(({ status }) => status === 'open').map(({ P, minted, left }) =>
    `Also open, limited: ${P.market} \`${P.address}\`, a free numbered pass, 2,000 only, one per Agent ID wallet, \`mint()\` \`0x1249c58b\`, value 0, no arguments. ${minted} minted, ${left} left. Closes ${iso(CLOSES_AT)}. Needs its own confirmation.`);
  if (lines.length && md.includes('<!-- /live -->')) md = md.replace('<!-- /live -->', `${lines.join('\n')}\n<!-- /live -->`);
  writeFileSync(f, md);
}
console.log(JSON.stringify({ ok: true, passes: done.map(({ P, status, minted, left, sourcify, submitted }) => ({ pass: P.market, status, minted, left, sourcify, submittedToSourcify: submitted })) }));
