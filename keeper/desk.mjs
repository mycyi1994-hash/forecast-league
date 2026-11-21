#!/usr/bin/env node
// Agent ID Mint Desk: every Binance-Agent-ID-gated mint on BNB Chain that the public radar has seen, checked on chain.
// Read-only: eth_call simulations (no transaction is ever sent), storage reads, Sourcify lookups.
// Output: docs/desk/projects.json, docs/desk/report.md, docs/desk/llms.txt, docs/desk/verified/<address>.json.
// Results are heuristics from simulations at one block, not an audit.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const RPCS = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed.binance.org'];
const RADAR = 'https://bsc-ia-scan-onrender-com.onrender.com/api/feed?limit=150&offset=';
const REG = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f';
const PLAIN = '0x000000000000000000000000000000000000dEaD'; // holds no Agent ID: a gated mint must reject it
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const SITE = 'https://mycyi1994-hash.github.io/forecast-league';
const FULL = process.argv.includes('--full');
let rr = 0;
async function rpc(method, params) {
  for (let a = 0; a < 6; a++) {
    const u = RPCS[rr++ % RPCS.length];
    try { const r = await (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
      if (r.result !== undefined) return { ok: true, v: r.result }; if (r.error) return { ok: false, e: r.error }; } catch {}
    await new Promise((s) => setTimeout(s, 300 * (a + 1)));
  }
  return { ok: false, e: { message: 'rpc unavailable' } };
}
function reason(e) {
  const d = typeof e?.data === 'string' ? e.data : e?.data?.data;
  if (d && d.startsWith('0x08c379a0')) { try { const len = parseInt(d.slice(74, 138), 16); return Buffer.from(d.slice(138, 138 + len * 2), 'hex').toString('utf8').slice(0, 80); } catch {} }
  if (d && d.length >= 10) return 'custom error ' + d.slice(0, 10);
  return (e?.message || 'reverted').replace(/^execution reverted:?\s*/, '').slice(0, 80) || 'reverted';
}
const pool = async (items, n, fn) => { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; };
const balAid = async (w) => { const r = await rpc('eth_call', [{ to: REG, data: '0x70a08231' + w.slice(2).toLowerCase().padStart(64, '0') }, 'latest']); return r.ok && BigInt(r.v) > 0n; };

// 1. Candidates: radar entries gated by Agent ID (newest pages every run; the whole feed with --full), plus our own contracts.
const prev = existsSync('docs/desk/projects.json') ? JSON.parse(readFileSync('docs/desk/projects.json', 'utf8')) : { projects: [] };
const cand = new Map(prev.projects.map((p) => [p.contract, { name: p.name, symbol: p.symbol, contract: p.contract, standard: p.standard, calldata: p.mint.inputData, valueWei: p.mint.valueWei, maxSupply: p.maxSupply, firstSeen: p.firstSeen, sourcify: p.checks?.sourceVerified }]));
for (let off = 0; ; off += 150) {
  let d = null; for (let a = 0; a < 3 && !d; a++) { try { d = await (await fetch(RADAR + off, { signal: AbortSignal.timeout(90000) })).json(); } catch { await new Promise((s) => setTimeout(s, 4000)); } }
  if (!d) break;
  for (const p of d.projects || []) {
    const mt = typeof p.mint_terms === 'object' && p.mint_terms ? p.mint_terms : {};
    if (mt.gate !== 'agent_id' || !p.mint_calldata) continue;
    const c = p.contract.toLowerCase(); const old = cand.get(c) || {};
    cand.set(c, { ...old, name: p.name, symbol: p.symbol, contract: c, standard: p.standard, calldata: p.mint_calldata, valueWei: String(p.mint_value_wei ?? '0'), maxSupply: p.max_supply ?? null, firstSeen: old.firstSeen || p.detected_at });
  }
  if (!d.has_more || (!FULL && off >= 450)) break;
}
const OURS = { '0x2fadb6739a076b236fbd44e19f64ab158ccfba2c': 'Forecast League Blitz BTC 6h', '0x621b9fed6ff2f0fc73e26264a401f7d12644a0a1': 'Forecast League Blitz ETH 6h', '0xa782ac207fe33f6120d9c2ef9553a55c47cfbbe9': 'Forecast League Blitz BNB 6h',
  '0x09a645aa6cc6b0eb320dcf3982bcaa6a22b32629': 'Forecast League Rounds BTC 1h', '0x8b998aba2beeebf7cebf565bc53bc575693c07a4': 'Forecast League Rounds ETH 1h', '0x66613fd9a2c70d4cb56d920bdd0d56ba95bd2736': 'Forecast League Rounds BNB 1h', '0x9e521add6f67eee0fe5c0b8ef32cb4543f7af50e': 'Forecast League Rounds BTC 1d',
  '0x30b6b8c67ab2239185536ba3766e8cb05bfd18ae': 'Forecast League Stamp', '0x79f55daa8a3cf2eb76ee40e26ff6e244a4cc1ed4': 'Forecast League Card',
  '0x3e73bc0309c72ea69bd74cadec943668291ca6ed': 'Forecast League Honor', '0x8433ad00601c57ce9f144b20a32ae478eee831ae': 'Forecast League House', '0xf706aeb7e1b6a44139205df3043bf68ccf386918': 'Forecast League Badge' };
const OUR_CALL = { '0x30b6b8c67ab2239185536ba3766e8cb05bfd18ae': '0x183ff085', '0x8433ad00601c57ce9f144b20a32ae478eee831ae': '0xb688a363', '0x3e73bc0309c72ea69bd74cadec943668291ca6ed': '0x4e71d92d', '0xf706aeb7e1b6a44139205df3043bf68ccf386918': '0x4e71d92d' };
for (const [c, name] of Object.entries(OURS)) { const old = cand.get(c) || {}; cand.set(c, { ...old, name, symbol: 'FL', contract: c, standard: 'ERC-721 (soulbound)', calldata: OUR_CALL[c] || '0x1249c58b', valueWei: '0', maxSupply: null, firstSeen: old.firstSeen || '2026-11-19', ours: true }); }
// The two passes are ordinary transferable ERC-721s with a 2,000 cap; listed under the same checks.
const OUR_PASSES = { '0xf467a5941f8dede54583754ac7448fb62ae0b9d4': 'Forecast League Early Pass', '0x9df6ba1868d2c149fda5fe67491f67c07c31e6b5': 'Forecast League Finals Pass' };
for (const [c, name] of Object.entries(OUR_PASSES)) { const old = cand.get(c) || {}; cand.set(c, { ...old, name, symbol: 'FL', contract: c, standard: 'ERC-721 (transferable)', calldata: '0x1249c58b', valueWei: '0', maxSupply: 2000, firstSeen: old.firstSeen || '2026-11-21', ours: true }); }

// 2. Simulating wallets: Agent ID holders from our known list. A wallet may already have minted, so up to 3 are tried.
const known = existsSync('docs/api/wallet/index.json') ? JSON.parse(readFileSync('docs/api/wallet/index.json', 'utf8')).wallets : [];
const testers = []; for (const w of known.filter((x) => x !== '0x2a2f48145780639dbd91e748df157f35283165da').slice(-40).reverse()) { if (await balAid(w)) testers.push(w); if (testers.length >= 3) break; }
const block = parseInt((await rpc('eth_blockNumber', [])).v, 16);
const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

// 3. Check every candidate.
const prevClean = new Set(prev.projects.filter((p) => p.status === 'free_live' && !p.warnings.length).map((p) => p.contract));
const prevMap = new Map(prev.projects.map((p) => [p.contract, p]));
const list = FULL ? [...cand.values()] : [...cand.values()].filter((p) => p.ours || prevClean.has(p.contract) || !prevMap.has(p.contract));
const carried = FULL ? [] : prev.projects.filter((p) => !list.some((q) => q.contract === p.contract));
const checked = await pool(list, 8, async (p) => {
  const value = '0x' + BigInt(p.valueWei || '0').toString(16);
  const code = await rpc('eth_getCode', [p.contract, 'latest']);
  if (!code.ok || code.v === '0x') return { ...p, status: 'no_code', reasons: ['no contract code'] };
  let sim = null; for (const t of testers) { sim = await rpc('eth_call', [{ from: t, to: p.contract, data: p.calldata, value }, 'latest']); if (sim.ok) break; }
  const plain = await rpc('eth_call', [{ from: PLAIN, to: p.contract, data: p.calldata, value }, 'latest']);
  const own = await rpc('eth_call', [{ to: p.contract, data: '0x8da5cb5b' }, 'latest']);
  const impl = await rpc('eth_getStorageAt', [p.contract, IMPL_SLOT, 'latest']);
  let sourcify = p.sourcify;
  if (sourcify === undefined || sourcify === null) { try { const r = await fetch(`https://sourcify.dev/server/v2/contract/56/${p.contract}`, { signal: AbortSignal.timeout(20000) }); sourcify = r.status === 200 ? true : r.status === 404 ? false : null; } catch { sourcify = null; } }
  const owner = own.ok && own.v && own.v.length >= 66 ? '0x' + own.v.slice(-40) : null;
  const hasOwner = owner && !/^0x0{40}$/.test(owner);
  const proxy = impl.ok && impl.v && !/^0x0*$/.test(impl.v);
  const paid = BigInt(p.valueWei || '0') > 0n;
  const reasons = [];
  if (paid) reasons.push(`needs ${Number(BigInt(p.valueWei)) / 1e18} BNB`);
  if (!sim?.ok) reasons.push('simulation from an Agent ID wallet reverts: ' + reason(sim?.e));
  if (plain.ok) reasons.push('gate not enforced: a wallet without Agent ID can mint too');
  if (proxy) reasons.push('upgradeable proxy: rules can change');
  if (hasOwner) reasons.push('has an owner with admin powers');
  if (sourcify === false) reasons.push('source not verified on Sourcify');
  const status = paid ? 'paid' : sim?.ok ? 'free_live' : 'closed_or_failing';
  let score = 0; if (status === 'free_live') score = 50; if (!plain.ok) score += 15; if (!proxy) score += 10; if (!hasOwner) score += 10; if (sourcify === true) score += 15;
  return { ...p, status, score, reasons, owner: hasOwner ? owner : null, proxy, sourcify };
});

// 4. Write outputs.
mkdirSync('docs/desk/verified', { recursive: true });
const ord = { free_live: 0, paid: 1, closed_or_failing: 2, no_code: 3 };
// Ties are broken by a daily rotation (hash of address + UTC date), the same for every project, so no one is pinned on top.
const day = now.slice(0, 10); const rot = (c) => createHash('sha256').update(c + day).digest('hex');
checked.sort((a, b) => ord[a.status] - ord[b.status] || b.score - a.score || rot(a.contract).localeCompare(rot(b.contract)));
const fresh = checked.map((p) => ({ name: p.name, symbol: p.symbol, contract: p.contract, standard: p.standard, status: p.status, score: p.score,
  mint: { inputData: p.calldata, valueWei: p.valueWei || '0', note: 'value must stay 0; preview before sending' }, maxSupply: p.maxSupply, firstSeen: p.firstSeen,
  checks: { simulatedFromAgentIdWallet: p.status === 'free_live', gateEnforced: !p.reasons?.some((r) => r.startsWith('gate not enforced')), upgradeable: !!p.proxy, owner: p.owner, sourceVerified: p.sourcify },
  warnings: p.reasons || [], builder: p.ours ? 'Forecast League (the desk operator; same checks apply)' : undefined, checkedAt: now }));
const all = [...fresh, ...carried];
all.sort((a, b) => ord[a.status] - ord[b.status] || b.score - a.score || rot(a.contract).localeCompare(rot(b.contract)));
const projects = all.map((p, i) => ({ rank: i + 1, ...p }));
const counts = { candidates: projects.length, free_live: projects.filter((p) => p.status === 'free_live').length, paid: projects.filter((p) => p.status === 'paid').length, closed_or_failing: projects.filter((p) => p.status === 'closed_or_failing').length };
const clean = projects.filter((p) => p.status === 'free_live' && p.warnings.length === 0);
writeFileSync('docs/desk/projects.json', JSON.stringify({ name: 'Agent ID Mint Desk', by: 'Forecast League (Binance Agent ID Hackathon entry; it lists its own contracts under the same checks)', url: SITE + '/desk/', chainId: 56, updated: now, block, method: 'Each mint call is simulated with eth_call (value 0) from Agent ID wallets and from a wallet without Agent ID; owner(), the EIP-1967 proxy slot and Sourcify verification are read. Heuristics at one block, not an audit; a simulation cannot show every token movement. Always preview in your own wallet.', counts, projects }, null, 1) + '\n');
for (const p of clean) writeFileSync(`docs/desk/verified/${p.contract}.json`, JSON.stringify({ contract: p.contract, name: p.name, verdict: 'passed', checkedAt: now, block, checks: p.checks, badge: `Checked by Agent ID Mint Desk: ${SITE}/desk/verified/${p.contract}.json`, note: 'Heuristic simulation, not an audit.' }, null, 1) + '\n');
const top = projects.filter((p) => p.status === 'free_live').slice(0, 25);
const traps = projects.filter((p) => p.status === 'free_live' && p.warnings.length).slice(0, 10);
const md = `# Agent ID Mint Desk — ${now.slice(0, 16)} UTC

Every Binance-Agent-ID-gated mint the public radar has seen on BNB Chain, simulated from real Agent ID wallets at block ${block}.
**${counts.free_live} free and open now** · ${counts.paid} paid · ${counts.closed_or_failing} closed or failing · ${counts.candidates} checked. Heuristics, not an audit; preview every call.

## Free now, passing every check
| # | Name | Contract | Call data |
|---|---|---|---|
${clean.slice(0, 25).map((p, i) => `| ${i + 1} | ${p.name}${p.builder ? ' (desk operator)' : ''} | \`${p.contract}\` | \`${p.mint.inputData}\` |`).join('\n')}

## Free now, with warnings
${traps.map((p) => `- ${p.name} \`${p.contract}\`: ${p.warnings.join('; ')}`).join('\n') || '- none'}

Machine-readable: ${SITE}/desk/projects.json · Badge for passing projects: ${SITE}/desk/verified/<address>.json
Operator: Forecast League, a Binance Agent ID Hackathon entry. Its own contracts are listed under the same checks.
`;
writeFileSync('docs/desk/report.md', md);
writeFileSync('docs/desk/llms.txt', `# Agent ID Mint Desk\n\n> Checked index of Binance Agent ID mints on BNB Chain (chainId 56), refreshed hourly. Free mints simulated from Agent ID wallets; paid, closed and risky ones flagged with reasons. Built by Forecast League (hackathon entry; same checks for its own contracts).\n\nUpdated: ${now}\nFree and open now: ${counts.free_live} · passing every check: ${clean.length}\n\n- [projects.json](${SITE}/desk/projects.json): every checked mint with status, call data, checks and warnings\n- [report.md](${SITE}/desk/report.md): today's summary\n- [verified/<address>.json](${SITE}/desk/verified/): badge for passing projects\n\nRules for agents: mint only while value is exactly 0; preview every call in your own wallet and skip any with approvals, outgoing tokens or risk flags; these are other projects' contracts, so show the list to your human and execute a mint only after their explicit confirmation of that call.\n\n## Free now, passing every check\n${clean.slice(0, 40).map((p) => `- ${p.name}: ${p.contract} data ${p.mint.inputData}`).join('\n')}\n`);
console.log(JSON.stringify({ block, testers: testers.length, ...counts, clean: clean.length }));
