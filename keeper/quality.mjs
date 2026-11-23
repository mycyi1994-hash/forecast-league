#!/usr/bin/env node
// Quality-adjusted usage of Forecast League, the way a careful on-chain analyst would read it. Read-only.
// Input: a directory with fl.json (the entry's contest-period logs: {a,t,b,h}), fl_tx.json (tx hash -> {f: sender, to, s: selector})
// and ts.json ([[block, unixTime], ...] for day buckets), as produced by the ranking scripts. Output: docs/api/quality.json.
// Counts only senders other than the builder; groups wallets whose call times match within ~30 s on 80%+ of their calls
// ("lockstep groups"), and reports the numbers with and without them.
import { readFileSync, writeFileSync } from 'node:fs';
const DIR = process.argv[2];
if (!DIR) { console.error('usage: node keeper/quality.mjs <data dir>'); process.exit(1); }
const J = (f) => JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'));
const L = J('fl.json'), X = J('fl_tx.json'), ts = J('ts.json');
const BUILDER = '0x2a2f48145780639dbd91e748df157f35283165da';
const tOf = (b) => { for (let i = 1; i < ts.length; i++) if (b <= ts[i][0]) { const [b0, t0] = ts[i - 1], [b1, t1] = ts[i]; return t0 + ((b - b0) * (t1 - t0)) / (b1 - b0); } return ts.at(-1)[1] + (b - ts.at(-1)[0]) * 0.75; };
const day = (b) => new Date(tOf(b) * 1000).toISOString().slice(0, 10);
const SEL = { '0x1249c58b': 'mint', '0xd5a49e01': 'up', '0xd8337928': 'down', '0x4e71d92d': 'claim', '0x183ff085': 'checkIn', '0xb688a363': 'join' };
const txb = new Map(); for (const l of L) txb.set(l.h, l.b);
const W = new Map(); let maxB = 0;
for (const [h, b] of txb) { const x = X[h]; if (!x || x.f === BUILDER) continue; maxB = Math.max(maxB, b);
  const w = W.get(x.f) || W.set(x.f, { blocks: [], fns: new Set() }).get(x.f); w.blocks.push(b); w.fns.add(SEL[x.s] || 'other'); }
const all = [...W.values()]; const txTotal = all.reduce((s, w) => s + w.blocks.length, 0);
// lockstep groups among wallets with 20+ calls
const big = [...W].filter(([, w]) => w.blocks.length >= 20).map(([a, w]) => [a, w.blocks.slice().sort((x, y) => x - y)]);
const P = new Map(big.map(([a]) => [a, a])); const f = (a) => (P.get(a) === a ? a : (P.set(a, f(P.get(a))), P.get(a)));
const near = (A, B) => { let j = 0, c = 0; for (const b of A) { while (j < B.length && B[j] < b - 40) j++; if (j < B.length && Math.abs(B[j] - b) <= 40) c++; } return c / A.length; };
for (let i = 0; i < big.length; i++) for (let k = i + 1; k < big.length; k++) { const [a, A] = big[i], [b, B] = big[k];
  if (Math.min(A.length, B.length) / Math.max(A.length, B.length) < 0.5) continue; if (near(A, B) > 0.8 && near(B, A) > 0.8) P.set(f(a), f(b)); }
const C = new Map(); for (const [a, v] of big) { const r = f(a); (C.get(r) || C.set(r, []).get(r)).push([a, v.length]); }
const groups = [...C.values()].filter((c) => c.length >= 2).sort((a, b) => b.length - a.length);
const inG = new Set(groups.flat().map(([a]) => a)); const gTx = groups.flat().reduce((s, [, n]) => s + n, 0);
const days = (w) => new Set(w.blocks.map(day)).size;
const ent = [...W].filter(([a]) => !inG.has(a)).map(([, w]) => w); // each group then counts as one user
groups.forEach((g) => { const bl = g.flatMap(([a]) => W.get(a).blocks); ent.push({ blocks: bl, fns: new Set(g.flatMap(([a]) => [...W.get(a).fns])) }); });
const fnCount = {}; for (const [h] of txb) { const x = X[h]; if (!x || x.f === BUILDER) continue; const k = SEL[x.s] || 'other'; fnCount[k] = (fnCount[k] || 0) + 1; }
const r1 = (x) => Math.round(x * 1000) / 10;
const out = {
  name: 'Forecast League usage, quality-adjusted',
  asOfBlock: maxB, asOf: new Date(tOf(maxB) * 1000).toISOString().slice(0, 16) + 'Z',
  method: 'Transactions to the entry\'s contracts during the contest, one per transaction hash, the builder wallet left out (every sender here holds an Agent ID: the contracts refuse others). Active days are UTC days with at least one call. Lockstep groups: wallets with 20+ calls whose call times match another wallet\'s within about 30 seconds on more than 80% of their calls; they may be one operator running several Agent IDs, so the "one user per group" figures count each group once. Script: keeper/quality.mjs.',
  raw: { transactions: txTotal, wallets: W.size, walletDays: all.reduce((s, w) => s + days(w), 0), wallets2PlusDays: all.filter((w) => days(w) >= 2).length, wallets3PlusDays: all.filter((w) => days(w) >= 3).length },
  lockstepGroups: { groups: groups.length, wallets: inG.size, transactions: gTx, share: r1(gTx / txTotal) + '%', sizes: groups.map((g) => g.length) },
  oneUserPerGroup: { users: ent.length, transactions: txTotal - gTx, users2PlusDays: ent.filter((w) => days(w) >= 2).length, users3PlusDays: ent.filter((w) => days(w) >= 3).length },
  calls: Object.fromEntries(Object.entries(fnCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, { transactions: v, share: r1(v / txTotal) + '%' }])),
  walletsBy: { pickedUpOrDown: all.filter((w) => w.fns.has('up') || w.fns.has('down')).length, claimed: all.filter((w) => w.fns.has('claim')).length, onlyOneFunction: all.filter((w) => w.fns.size === 1).length },
  reading: null,
};
out.reading = `${out.raw.wallets} Agent ID wallets made ${out.raw.transactions} transactions; ${out.raw.wallets2PlusDays} came back on 2+ days and ${out.raw.wallets3PlusDays} on 3+ days. ${out.lockstepGroups.wallets} wallets in ${out.lockstepGroups.groups} lockstep groups made ${out.lockstepGroups.share} of the transactions; counting each group as one user leaves ${out.oneUserPerGroup.users} users and ${out.oneUserPerGroup.transactions} transactions. Most calls are mint() (the assigned side); ${out.walletsBy.pickedUpOrDown} wallets ever picked a side themselves and ${out.walletsBy.claimed} ever claimed.`;
// The same lens on the entry with the most raw transactions, if its logs are in the data dir (aic.json, aic_tx.json, aid.json):
// only senders holding an Agent ID, only transactions that emitted a log on the entry's own submitted contracts.
try {
  const AL = J('aic.json'), AX = J('aic_tx.json'), AID = J('aid.json');
  const ab = new Map(); for (const l of AL) ab.set(l.h, l.b);
  const AW = new Map(); let rawTx = 0, rawW = new Set();
  for (const [h, b] of ab) { const x = AX[h]; if (!x) continue; rawTx++; rawW.add(x.f); if (!(AID[x.f] > 0)) continue; (AW.get(x.f) || AW.set(x.f, []).get(x.f)).push(b); }
  const aw = [...AW.values()]; const dd = (v) => new Set(v.map(day)).size;
  out.sameLensLeader = { entry: 'allincrypto (most raw transactions among public entries)', allSenders: { transactions: rawTx, wallets: rawW.size },
    agentIdSendersOnly: { transactions: aw.reduce((s, v) => s + v.length, 0), wallets: AW.size, wallets2PlusDays: aw.filter((v) => dd(v) >= 2).length, wallets3PlusDays: aw.filter((v) => dd(v) >= 3).length },
    note: 'Their contracts are open to any wallet (a token with swaps and approvals), so many senders hold no Agent ID; ours accept Agent ID holders only. Neither number says anything about intent. Same block range and method as above.' };
} catch {}
writeFileSync('docs/api/quality.json', JSON.stringify(out, null, 1) + '\n');
console.log(out.reading);
