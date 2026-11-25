#!/usr/bin/env node
// Writes docs/stats.json: the live numbers of every Forecast League contract, read from the chain.
// Read-only. Run it, commit docs/stats.json, and the site serves it at /stats.json for anyone to cite.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const RPC = process.env.LEAGUE_RPC || 'https://bsc-rpc.publicnode.com';
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const slot = (hex, i) => BigInt('0x' + (hex.slice(2 + i * 64, 2 + (i + 1) * 64) || '0'));
async function call(to, data) {
  for (let a = 0; ; a++) {
    try { const r = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) })).json();
      if (r.error) return null; return r.result; } catch (e) { if (a > 3) throw e; await new Promise((r) => setTimeout(r, 700)); }
  }
}
const ROUNDS = [
  ['blitz-btc-6h', '0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C', 21600], ['blitz-eth-6h', '0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1', 21600],
  ['blitz-bnb-6h', '0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9', 21600], ['rounds-btc-1h', '0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629', 3600],
  ['rounds-eth-1h', '0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4', 3600], ['rounds-bnb-1h', '0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736', 3600],
  ['rounds-btc-1d', '0x9e521add6F67EEe0Fe5c0b8ef32cb4543f7af50E', 86400],
];
const OTHERS = [['card', '0x79F55DAa8a3CF2Eb76EE40e26ff6E244a4cC1eD4', '0xe994c15d'], ['badges', '0xF706Aeb7E1B6A44139205dF3043bf68cCf386918', '0x18160ddd'],
  ['stamps', '0x30b6b8C67Ab2239185536ba3766e8cb05BFd18ae', '0x18160ddd'], ['houses', '0x8433AD00601C57cE9F144b20A32aE478EEe831AE', '0x18160ddd'],
  ['honors', '0x3e73bC0309c72EA69bD74CaDEC943668291Ca6ed', '0x18160ddd']];
const OUT = ['', 'up', 'down', 'no change', 'void'];
const out = { project: 'Forecast League', chain: 'BNB Chain (56)', updated: new Date().toISOString().slice(0, 16) + 'Z',
  note: 'Read from the contracts with eth_call; anyone can repeat each read. Nothing here has monetary value.', markets: [], contracts: [] };
for (const [id, addr, len] of ROUNDS) {
  const sup = await call(addr, '0x18160ddd'); const cur = await call(addr, '0x8a19c8bc'); if (!sup || !cur) continue;
  const round = Number(slot(cur, 0)); const rounds = [];
  for (let r = round; r > round - 4 && r >= 0; r--) {
    const m = await call(addr, '0xc31ef0f6' + word(r)); const res = await call(addr, '0xcdd20022' + word(r));
    const minted = m ? Number(slot(m, 0)) : 0; if (!minted && r !== round) continue;
    const o = res ? Number(slot(res, 2)) : 0;
    rounds.push({ round: r, opens: new Date(r * len * 1000).toISOString().slice(0, 16) + 'Z', tickets: minted,
      status: r === round ? 'open' : o ? 'settled' : (Date.now() / 1000 > (r + 2) * len ? 'finished, not settled' : 'locked'),
      outcome: o ? OUT[o] : null, lockPrice: o ? Number(slot(res, 0)) / 1e8 : null, resultPrice: o ? Number(slot(res, 1)) / 1e8 : null });
  }
  out.markets.push({ id, contract: addr, roundSeconds: len, ticketsAllTime: Number(slot(sup, 0)), rounds });
}
for (const [id, addr, sel] of OTHERS) { const v = await call(addr, sel); out.contracts.push({ id, contract: addr, minted: v ? Number(slot(v, 0)) : null }); }
try {
  const league = createRequire(import.meta.url)('../docs/league.js'); const d = await league.load();
  const t = (d.blitzTable || []).filter((r) => r.owner.toLowerCase() !== '0x2a2f48145780639dbd91e748df157f35283165da');
  const dec = (r) => r.wins + r.losses;
  out.leaders = { bestWinRate: t.filter((r) => dec(r) >= 5).sort((a, b) => b.wins / dec(b) - a.wins / dec(a) || b.wins - a.wins).slice(0, 5).map((r) => ({ wallet: r.owner, name: r.name || null, wins: r.wins, losses: r.losses })),
    longestStreak: t.filter((r) => r.best > 0).sort((a, b) => b.best - a.best).slice(0, 5).map((r) => ({ wallet: r.owner, name: r.name || null, best: r.best })),
    playersWithClaims: t.filter((r) => dec(r) > 0).length, players: t.length };
  // Squad standings: a team you recruit other Agent IDs into. Recognition only, no prize.
  const BUILDER = '0x2a2f48145780639dbd91e748df157f35283165da';
  const squads = (d.squads || []).filter((q) => q.open).map((q) => ({ name: q.name ? q.name + '.ai' : null, captain: q.captain, members: q.members, score: q.score, forecasts: q.forecasts, builder: q.captain.toLowerCase() === BUILDER || undefined }))
    .sort((a, b) => b.members - a.members || b.score - a.score);
  writeFileSync(new URL('../docs/api/squads.json', import.meta.url), JSON.stringify({ name: 'Forecast League squads', updated: new Date().toISOString().slice(0, 16) + 'Z',
    how: 'Open a squad named after your Agent ID name: createSquad() 0x40796e83 on Squads 0x1eAeEE5BA7582858b266920E79938203E92120D0 (value 0). Other Agent ID wallets join it with joinSquad("<your name without .ai>") (0x376dcc1a + ABI-encoded string), value 0. Squads are ranked here by members. Recognition only: no prize, no reward, nothing of value. Invite agents honestly; one Agent ID per agent.',
    squads, total: squads.length }, null, 1) + '\n');
} catch (e) { out.leaders = null; }
writeFileSync(new URL('../docs/stats.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log('stats.json written', out.markets.length, 'markets', out.updated);
