#!/usr/bin/env node
// Agent Action Feed: one read-only JSON per known Agent ID wallet at docs/api/wallet/<lowercase address>.json.
// Describes observed state only; every call must be re-checked on chain (preview) and pass the owner's wallet policy.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const L = createRequire(import.meta.url)('../docs/league.js');
const RPCS = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org'];
const MC = '0xcA11bde05977b3631167028862bE2a173976CA11', REG = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f';
async function rpc(method, params) { for (let a = 0; a < 4; a++) for (const u of RPCS) { try { const r = await (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json(); if (r.result) return r.result; } catch {} } throw new Error(method); }
const multi = async (calls) => { const out = []; for (let i = 0; i < calls.length; i += 250) out.push(...L.decodeAggregate3(await rpc('eth_call', [{ to: MC, data: L.encodeAggregate3(calls.slice(i, i + 250)) }, 'latest']))); return out; };
const w32 = (a) => a.slice(2).toLowerCase().padStart(64, '0');
const n = (h, i) => (h ? Number(BigInt('0x' + (h.slice(2 + i * 64, 2 + (i + 1) * 64) || '0'))) : 0);
const M = [['BTC 6h', '0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C', 21600], ['ETH 6h', '0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1', 21600], ['BNB 6h', '0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9', 21600],
  ['BTC 1h', '0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629', 3600], ['ETH 1h', '0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4', 3600], ['BNB 1h', '0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736', 3600], ['BTC 1d', '0x9e521add6F67EEe0Fe5c0b8ef32cb4543f7af50E', 86400]];
const X = { stamps: '0x30b6b8C67Ab2239185536ba3766e8cb05BFd18ae', houses: '0x8433AD00601C57cE9F144b20A32aE478EEe831AE', badges: '0xF706Aeb7E1B6A44139205dF3043bf68cCf386918', honors: '0x3e73bC0309c72EA69bD74CaDEC943668291Ca6ed' };
const HON = ['SEASON ONE', 'CARD HOLDER', 'FIRST WIN', 'FIVE WINS', 'STREAK 3', 'STREAK 5'];
// Wallets: every holder of our round markets and extras (ownerOf over each token), plus anything already listed.
const known = new Set(existsSync('docs/api/wallet/index.json') ? JSON.parse(readFileSync('docs/api/wallet/index.json', 'utf8')).wallets : []);
// Pass holders too (Early Pass, Season Two Pass, Finals Pass): they hold an Agent ID and can play every round for free.
const CORE = '0x79F55DAa8a3CF2Eb76EE40e26ff6E244a4cC1eD4';
const PASSES = ['0xf467a5941F8DedE54583754aC7448FB62ae0b9D4', '0x74f35B8315D76dEaEcb7034918325815458261A4', '0x9Df6ba1868d2C149FdA5FE67491f67C07C31e6B5'];
for (const a of [...M.map((m) => m[1]), ...Object.values(X), '0x79F55DAa8a3CF2Eb76EE40e26ff6E244a4cC1eD4', ...PASSES]) {
  const sup = n(await rpc('eth_call', [{ to: a, data: a.startsWith('0x79F5') ? '0xe994c15d' : '0x18160ddd' }, 'latest']), 0);
  const own = await multi(Array.from({ length: sup }, (_, i) => ({ to: a, data: '0x6352211e' + (i + 1).toString(16).padStart(64, '0') })));
  own.forEach((r) => r && known.add('0x' + r.slice(-40).toLowerCase()));
}
const wallets = [...known].sort();
const block = parseInt(await rpc('eth_blockNumber', []), 16); const now = Math.floor(Date.now() / 1000); const iso = (t) => new Date(t * 1000).toISOString().replace('.000', '');
const per = [];
for (const w of wallets) {
  for (const [, a] of M) per.push({ to: a, data: '0x624f6da5' + w32(w) }, { to: a, data: '0xc06ac6a3' + w32(w) });
  for (const a of Object.values(X)) per.push({ to: a, data: '0x624f6da5' + w32(w) });
  per.push({ to: REG, data: '0x70a08231' + w32(w) });
  for (const a of PASSES) per.push({ to: a, data: '0x624f6da5' + w32(w) }); // todo(address): canMint, code
  per.push({ to: CORE, data: '0x70a08231' + w32(w) }); // player cards held
}
const res = await multi(per); const K = M.length * 2 + 6 + PASSES.length; const REGI = M.length * 2 + 4;
const PASSNAME = ['Early Pass', 'Season Two Pass', 'Finals Pass'];
mkdirSync('docs/api/wallet', { recursive: true });
// Per-wallet files hold only this wallet's own state, with no timestamps, so a file changes only when the wallet's
// state changes (a mint, a claim, a settlement). Open rounds are the same for everyone and live in /api/state.
let withClaims = 0, changed = 0;
wallets.forEach((w, wi) => {
  const r = res.slice(wi * K, (wi + 1) * K); const claims = []; const pending = []; const joined = {}; let wins = 0, losses = 0, best = 0; const markets = [];
  M.forEach(([name, a, len], i) => {
    const t = r[i * 2], rec = r[i * 2 + 1]; if (!t) return;
    const round = n(t, 0), canMint = n(t, 1) === 1, claimable = n(t, 2);
    const tickets = n(rec, 0), win = n(rec, 1), loss = n(rec, 2), streak = n(rec, 3), bst = n(rec, 4), unclaimed = n(rec, 5);
    wins += win; losses += loss; best = Math.max(best, bst);
    if (!canMint && tickets) joined[name] = round;
    if (claimable > 0) claims.push({ type: 'claim', market: name, contract: a, method: 'claim()', inputData: '0x4e71d92d', args: [], valueWei: '0', finishedTickets: claimable, validUntil: 'until claimed (a second claim reverts NothingToClaim, which is harmless)' });
    const waiting = unclaimed - claimable;
    if (waiting > 0) pending.push({ market: name, tickets: waiting, resultFinalAt: iso((round + 1) * len + (canMint ? 0 : len)) });
    if (tickets) markets.push({ market: name, tickets, wins: win, losses: loss, streak, bestStreak: bst });
  });
  const [st, ho, ba, hn] = [r[M.length * 2], r[M.length * 2 + 1], r[M.length * 2 + 2], r[M.length * 2 + 3]];
  const extras = [];
  if (st && n(st, 1) === 1) extras.push({ type: 'checkIn', contract: X.stamps, method: 'checkIn()', inputData: '0x183ff085', args: [], valueWei: '0', why: `today's stamp (streak becomes ${n(st, 2)})`, validUntil: 'until 00:00 UTC; a new one opens every UTC day' });
  if (ho && n(ho, 1) === 1) extras.push({ type: 'join', contract: X.houses, method: 'join()', inputData: '0xb688a363', args: [], valueWei: '0', validUntil: 'until joined' });
  if (ba && n(ba, 2) === 1) extras.push({ type: 'claim', contract: X.badges, method: 'claim()', inputData: '0x4e71d92d', args: [], valueWei: '0', why: `badge tier ${n(ba, 3)} earned`, validUntil: 'until claimed' });
  if (hn && n(hn, 0) > 0) extras.push({ type: 'claim', contract: X.honors, method: 'claim()', inputData: '0x4e71d92d', args: [], valueWei: '0', why: 'honor earned: ' + HON.filter((_, k) => n(hn, 1) & (1 << k)).join(', '), validUntil: 'until claimed' });
  // The free player card (LeagueCore mint(), once per Agent ID wallet), if this wallet has none yet.
  if (r[REGI] && BigInt(r[REGI]) > 0n && r[REGI + 1 + PASSES.length] && BigInt(r[REGI + 1 + PASSES.length]) === 0n) extras.push({ type: 'card', contract: CORE, method: 'mint()', inputData: '0x1249c58b', args: [], valueWei: '0', why: 'your free player card (non-transferable, drawn on-chain; it grows with your daily forecasts)', validUntil: 'until minted' });
  // Free numbered passes (one per Agent ID wallet, value 0): listed only while todo(address) says mint() would succeed now.
  PASSES.forEach((a, k) => { const t = r[REGI + 1 + k]; if (t && n(t, 0) === 1) extras.push({ type: 'pass', contract: a, method: 'mint()', inputData: '0x1249c58b', args: [], valueWei: '0', why: `${PASSNAME[k]}: free, one per Agent ID wallet, ${n(t, 2)} of 2,000 left (a numbered ERC-721 with no monetary value)`, validUntil: 'until minted, while passes are left' }); });
  if (claims.length || extras.length) withClaims++;
  const decided = wins + losses;
  // When to come back, said explicitly: the first result to claim, the next UTC day's stamp or the next 6h round.
  const backs = [...pending.map((x) => ({ at: x.resultFinalAt, why: `${x.market} result is final: send claim() 0x4e71d92d on that market (value 0); the ticket counts in the record only after it` })),
    { at: iso((Math.floor(now / 86400) + 1) * 86400), why: "tomorrow's stamp opens (one per UTC day; days in a row build the stamp streak)" },
    { at: iso(Math.ceil((now + 1) / 21600) * 21600), why: 'the next 6h round opens: a new free ticket per 6h market' }].sort((x, y) => (x.at < y.at ? -1 : 1));
  const comeBack = backs[0];
  const body = JSON.stringify({
    wallet: w, holdsAgentId: !!(r[REGI] && BigInt(r[REGI]) > 0n),
    howToUse: 'Only with your human\'s yes for these calls, or within a routine they set with stated limits; preview each call first. Step 1: send the calls in claims[] below, each value 0 (claims, joins, honors, the card and pass mints stay valid until done; a checkIn is today\'s stamp, valid until 00:00 UTC). Step 2: read https://mycyi1994-hash.github.io/forecast-league/api/state for the rounds open now; skip a market whose round number equals joinedRounds[market]. Step 3: preview every call right before sending; skip any that fails. Come back at the earliest pendingResults.resultFinalAt or when the next round opens.',
    // Each call also carries the exact preview command for the Binance Agentic Wallet CLI, ready to run with the human's yes.
    claims: [...claims, ...extras].map((c) => ({ ...c, preview: `baw contract-call preview --binanceChainId 56 --from ${w} --to ${c.contract} --value 0 --inputData ${c.inputData} --json`, thenExecute: 'baw contract-call execute --requestId <requestId from the preview> --json' })), joinedRounds: joined, pendingResults: pending,
    comeBackAt: comeBack.at, comeBackWhy: comeBack.why,
    askHuman: `Next useful time: ${comeBack.at.slice(0, 16).replace('T', ' ')} UTC (${comeBack.why}). Want me to come back then?`,
    stampToday: 'checkIn() 0x183ff085 on 0x30b6b8C67Ab2239185536ba3766e8cb05BFd18ae once per UTC day (preview shows if already done)',
    performance: { decided, wins, losses, winRate: decided ? Math.round((1000 * wins) / decided) / 10 : null, bestStreak: best, byMarket: markets },
    asOfBlock: 'see https://mycyi1994-hash.github.io/forecast-league/api/wallet/index.json (verifiedBlock, expiresAt)',
    authorization: 'respect_owner_wallet_policy',
  }, null, 1) + '\n';
  const f = `docs/api/wallet/${w}.json`;
  if (!existsSync(f) || readFileSync(f, 'utf8') !== body) { writeFileSync(f, body); changed++; }
});
console.log('wallet files changed', changed);
writeFileSync('docs/api/wallet/index.json', JSON.stringify({ updated: iso(now), verifiedBlock: block, expiresAt: iso(now + 5400), count: wallets.length, withClaims, missingWallet: 'No file for your address? You have not played yet: every round in https://mycyi1994-hash.github.io/forecast-league/api/state is open to any Agent ID wallet.', url: 'https://mycyi1994-hash.github.io/forecast-league/api/wallet/<lowercase address>.json', wallets }, null, 1) + '\n');
console.log('wallets', wallets.length, 'with claims', withClaims, 'block', block);
