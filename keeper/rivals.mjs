#!/usr/bin/env node
// Where Forecast League stands among Agent-ID-gated NFT mints on BNB Chain.
// Read-only: the public radar feed for the list of gated contracts, then ownerOf over every token id
// (through Multicall3) to count distinct holders. No logs: the public nodes only keep about 30 hours.
// A holder count is "wallets holding a token now", not "wallets that minted": transfers and team
// airdrops move it, and nothing here says which contracts were entered in the hackathon.
// Output: launch/rivals/latest.md, launch/rivals/latest.json, launch/rivals/history.json (one row per UTC day).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const L = createRequire(import.meta.url)('../docs/league.js');
const RPCS = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed.binance.org'];
const MC = '0xcA11bde05977b3631167028862bE2a173976CA11';
const RADAR = 'https://bsc-ia-scan-onrender-com.onrender.com/api/feed?limit=150&offset=';
const SINCE = '2026-11-18 08:00'; // submission period start, UTC
const MIN_SUPPLY = 150, MAX_SUPPLY = 20000;
let rr = 0;
async function rpc(method, params) {
  for (let a = 0; a < 8; a++) {
    try { const r = await (await fetch(RPCS[rr++ % RPCS.length], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(45000) })).json(); if (r.result !== undefined) return r.result; if (r.error && a > 2) return null; } catch {}
    await new Promise((s) => setTimeout(s, 400 * (a + 1)));
  }
  return null;
}
const pool = async (items, n, fn) => { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; };

// 1. Gated NFT contracts the radar has seen since the submission period began.
const cand = new Map();
for (let off = 0; ; off += 150) {
  let d = null; for (let a = 0; a < 3 && !d; a++) { try { d = await (await fetch(RADAR + off, { signal: AbortSignal.timeout(90000) })).json(); } catch { await new Promise((s) => setTimeout(s, 4000)); } }
  if (!d) break;
  for (const p of d.projects || []) {
    const mt = typeof p.mint_terms === 'object' && p.mint_terms ? p.mint_terms : {};
    if (mt.gate !== 'agent_id' || !/ERC-721/.test(p.standard || '') || (p.detected_at || '') < SINCE) continue;
    cand.set(p.contract.toLowerCase(), { contract: p.contract.toLowerCase(), name: p.name, firstSeen: p.detected_at, cap: p.max_supply ?? null, price: p.mint_price_str || '', radarMinted: Number(p.total_minted) > 0 && Number(p.total_minted) <= MAX_SUPPLY ? Math.floor(Number(p.total_minted)) : 0 });
  }
  if (!d.has_more) break;
}
const ours = new Set(['0x79f55daa8a3cf2eb76ee40e26ff6e244a4cc1ed4', '0x2fadb6739a076b236fbd44e19f64ab158ccfba2c', '0x621b9fed6ff2f0fc73e26264a401f7d12644a0a1', '0xa782ac207fe33f6120d9c2ef9553a55c47cfbbe9', '0x09a645aa6cc6b0eb320dcf3982bcaa6a22b32629', '0x8b998aba2beeebf7cebf565bc53bc575693c07a4', '0x66613fd9a2c70d4cb56d920bdd0d56ba95bd2736', '0x9e521add6f67eee0fe5c0b8ef32cb4543f7af50e', '0x30b6b8c67ab2239185536ba3766e8cb05bfd18ae', '0x8433ad00601c57ce9f144b20a32ae478eee831ae', '0xf706aeb7e1b6a44139205df3043bf68ccf386918', '0x3e73bc0309c72ea69bd74cadec943668291ca6ed']);
const list = [...cand.values()].filter((p) => !ours.has(p.contract));

// 2. Supply, then holders.
// Some contracts have no totalSupply(); for those the radar's minted count sets where to start looking.
await pool(list, 6, async (p) => { const r = await rpc('eth_call', [{ to: p.contract, data: '0x18160ddd' }, 'latest']); const onChain = r && r.length >= 66 && BigInt(r.slice(0, 66)) <= 10n ** 9n ? Number(BigInt(r.slice(0, 66))) : 0; p.supply = onChain || p.radarMinted; });
const big = list.filter((p) => p.supply >= MIN_SUPPLY && p.supply <= MAX_SUPPLY);
await pool(big, 2, async (p) => {
  const owners = new Map(); let seen = 0, failed = 0;
  // Token ids are read in blocks of 200 from 0, and past the reported supply for as long as a block still finds tokens.
  for (let i = 0; i <= MAX_SUPPLY + 400; i += 200) {
    const ids = []; for (let j = i; j < i + 200; j++) ids.push(j);
    const r = await rpc('eth_call', [{ to: MC, data: L.encodeAggregate3(ids.map((id) => ({ to: p.contract, data: '0x6352211e' + id.toString(16).padStart(64, '0') }))) }, 'latest']);
    if (!r) { failed += ids.length; if (i > p.supply + 1) break; continue; }
    let hit = 0;
    for (const x of L.decodeAggregate3(r)) if (x && x.length >= 66) { const o = '0x' + x.slice(26, 66); if (!/^0x0{40}$/.test(o)) { owners.set(o, (owners.get(o) || 0) + 1); seen++; hit++; } }
    if (i + 200 > p.supply + 1 && hit === 0) break;
  }
  const top = [...owners.values()].sort((a, b) => b - a);
  p.holders = owners.size; p.tokensSeen = seen; if (seen > p.supply) p.supply = seen; p.unread = failed; p.largestHolder = top[0] || 0;
});

// 3. Our own number: wallets known to the action feed (every holder of a Forecast League token).
const mine = existsSync('docs/api/wallet/index.json') ? JSON.parse(readFileSync('docs/api/wallet/index.json', 'utf8')).wallets.length : 0;
const table = [...big.filter((p) => p.holders >= 50).map((p) => ({ name: p.name, contract: p.contract, holders: p.holders, supply: p.supply, cap: p.cap, firstSeen: p.firstSeen, price: p.price, largestHolder: p.largestHolder, unread: p.unread })), { name: 'Forecast League (12 contracts together)', contract: 'ours', holders: mine, supply: null, cap: null, firstSeen: '2026-11-19', price: 'free', largestHolder: null, unread: 0, ours: true }].sort((a, b) => b.holders - a.holders);
table.forEach((r, i) => (r.rank = i + 1));
const me = table.find((r) => r.ours); const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z'); const day = now.slice(0, 10);
mkdirSync('launch/rivals', { recursive: true });
const out = { updated: now, since: SINCE + ' UTC', candidates: list.length, counted: big.length, minSupply: MIN_SUPPLY, ourRank: me.rank, ourWallets: mine, tenth: table[9] ? table[9].holders : null, caveats: ['Holders now, not minters: transfers and airdrops change it.', 'Only mint-type contracts the public radar marks as Agent-ID-gated; check-in or game entries without a token are missing.', 'Nothing here says which contracts were entered in the hackathon.', 'First-seen is when the radar noticed the contract, which can be later than its launch.'], table };
writeFileSync('launch/rivals/latest.json', JSON.stringify(out, null, 1) + '\n');
const hist = existsSync('launch/rivals/history.json') ? JSON.parse(readFileSync('launch/rivals/history.json', 'utf8')) : {};
hist[day] = { ourRank: me.rank, ourWallets: mine, tenth: out.tenth, top: table.slice(0, 25).map((r) => [r.name, r.contract, r.holders]) };
writeFileSync('launch/rivals/history.json', JSON.stringify(hist, null, 1) + '\n');
const md = [`# 경쟁 순위 (${now.replace('T', ' ').replace('Z', ' UTC')})`, '', `우리: **${me.rank}위**, 지갑 ${mine}개. 10위는 ${out.tenth ?? '?'}개.`, '', `대회 시작(${SINCE} UTC) 이후 레이더에 잡힌 Agent ID 전용 NFT 중 발행량 ${MIN_SUPPLY}개 이상인 ${big.length}개의 보유 지갑을 직접 셌습니다.`, '', '| 순위 | 이름 | 보유 지갑 | 발행 | 한도 | 레이더 첫 발견 | 계약 |', '|---|---|---|---|---|---|---|',
  ...table.slice(0, 40).map((r) => `| ${r.rank} | ${r.ours ? '**' + r.name + '**' : r.name.replace(/\|/g, '/')} | ${r.holders}${r.unread ? ' 이상' : ''} | ${r.supply ?? ''} | ${r.cap ?? ''} | ${(r.firstSeen || '').slice(5, 16)} | ${r.ours ? '' : '`' + r.contract + '`'} |`), '',
  '주의:', '- 지금 토큰을 들고 있는 지갑 수입니다. 민팅한 지갑 수와 다를 수 있습니다(양도, 팀 배포).', '- 민팅형 계약만 셉니다. 출석 체크나 게임처럼 토큰이 없는 참가작은 빠집니다.', '- 어느 계약이 실제 제출작인지는 알 수 없습니다.', ''].join('\n');
writeFileSync('launch/rivals/latest.md', md);
console.log(JSON.stringify({ ok: true, candidates: list.length, counted: big.length, ourRank: me.rank, ourWallets: mine, tenth: out.tenth }));
