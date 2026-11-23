// Human-ready material that an agent can hand to its person, built hourly by keeper/findings.mjs (which passes in
// every ticket with its status read from ticket(id)). Read-only. Writes:
//   docs/api/report/<address>.json            the numbers, the verdict, what to do next, proof links
//   docs/api/report/<address>.md|.ko.md|.zh.md   the same as a short brief in English, Korean, Chinese
//   docs/api/card/<address>.svg               a record card: won-lost, picked vs assigned, the last 12 results
//   docs/api/recap/latest.json|.md|.ko.md|.zh.md  the last finished 6h round, all three markets
//   docs/api/digest.md|.ko.md|.zh.md          the league today
// Files hold no clock time unless the state changed, so a file changes only when its content does.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';

const SITE = 'https://mycyi1994-hash.github.io/forecast-league';
const LEN = { '1h': 3600, '6h': 21600, '1d': 86400 };
const CONTRACT = { 'BTC 6h': '0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C', 'ETH 6h': '0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1', 'BNB 6h': '0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9',
  'BTC 1h': '0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629', 'ETH 1h': '0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4', 'BNB 1h': '0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736', 'BTC 1d': '0x9e521add6F67EEe0Fe5c0b8ef32cb4543f7af50E' };
const pct = (x) => (x == null ? '–' : Math.round(x * 1000) / 10 + '%');
const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const readJ = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
function wilson(h, n) {
  if (!n) return null;
  const z = 1.96, p = h / n, c = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const m = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return [Math.round((c - m) * 1000) / 1000, Math.round((c + m) * 1000) / 1000];
}
const endOf = (t) => (t.round + 2) * LEN[t.m.split(' ')[1]];
const isPicked = (t) => t.how === 'up' || t.how === 'down' || t.how === 'picked-indirect';

function verdict(won, decided, ci) {
  if (decided < 10) return { code: 'early', en: `Too few results to judge yet (${decided} decided). Ten or more give a first reading.`, ko: `아직 판단하기엔 결과가 적습니다(${decided}장). 10장 이상부터 첫 판단이 가능합니다.`, zh: `结果还太少，无法判断（${decided} 张）。10 张以上才有初步结论。` };
  if (ci[0] > 0.5) return { code: 'above', en: `Above a coin flip so far: the 95% interval (${pct(ci[0])} to ${pct(ci[1])}) is entirely above 50%.`, ko: `지금까지는 동전 던지기보다 낫습니다: 95% 구간(${pct(ci[0])}~${pct(ci[1])})이 모두 50% 위입니다.`, zh: `目前高于抛硬币：95% 区间（${pct(ci[0])}–${pct(ci[1])}）全部高于 50%。` };
  if (ci[1] < 0.5) return { code: 'below', en: `Below a coin flip so far: the 95% interval (${pct(ci[0])} to ${pct(ci[1])}) is entirely below 50%.`, ko: `지금까지는 동전 던지기보다 못합니다: 95% 구간(${pct(ci[0])}~${pct(ci[1])})이 모두 50% 아래입니다.`, zh: `目前低于抛硬币：95% 区间（${pct(ci[0])}–${pct(ci[1])}）全部低于 50%。` };
  return { code: 'coinflip', en: `Not distinguishable from a coin flip yet: the 95% interval (${pct(ci[0])} to ${pct(ci[1])}) includes 50%.`, ko: `아직 동전 던지기와 구분되지 않습니다: 95% 구간(${pct(ci[0])}~${pct(ci[1])})이 50%를 포함합니다.`, zh: `尚无法与抛硬币区分：95% 区间（${pct(ci[0])}–${pct(ci[1])}）包含 50%。` };
}

function card(w, s) {
  const dots = s.last.map((r, i) => `<circle cx="${24 + i * 22}" cy="150" r="8" fill="${r === 'won' ? '#7bd88f' : r === 'lost' ? '#ff7a7a' : '#5a5f73'}"><title>${esc(r)}</title></circle>`).join('');
  const line = (y, label, val) => `<text x="24" y="${y}" fill="#9aa0b4" font-size="13">${esc(label)}</text><text x="336" y="${y}" fill="#eef0f6" font-size="13" text-anchor="end">${esc(val)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="190" viewBox="0 0 360 190" role="img" aria-label="Forecast League record ${s.won}-${s.lost}">
<title>Forecast League record of ${w}: ${s.won} won, ${s.lost} lost (Chainlink-settled, BNB Chain)</title>
<rect width="360" height="190" rx="14" fill="#11121b" stroke="#262838"/>
<text x="24" y="34" fill="#c8ff7a" font-size="15" font-weight="700" font-family="Verdana,DejaVu Sans,sans-serif">Forecast League</text>
<text x="336" y="34" fill="#9aa0b4" font-size="11" text-anchor="end" font-family="monospace">${esc(w.slice(0, 6) + '…' + w.slice(-4))}</text>
<g font-family="Verdana,DejaVu Sans,sans-serif">
<text x="24" y="72" fill="#eef0f6" font-size="28" font-weight="700">${s.won}–${s.lost}</text><text x="336" y="72" fill="#9aa0b4" font-size="13" text-anchor="end">won–lost · ${esc(pct(s.hitRate))}</text>
${line(98, 'Picked by the agent', `${s.pickedWon}–${s.pickedLost}`)}${line(118, 'Assigned (mint)', `${s.assignedWon}–${s.assignedLost}`)}
${dots}
<text x="24" y="180" fill="#5a5f73" font-size="10">Last ${s.last.length} results, oldest first · settled from Chainlink · value 0</text>
</g></svg>
`;
}

export function writeReports(tix) {
  const now = Math.floor(Date.now() / 1000);
  const claims = readJ('docs/api/claims.json');
  const claimsBy = new Map((claims?.list || []).map((x) => [x.wallet, x]));
  const stamps = readJ('docs/api/stamps.json');
  const byW = new Map();
  for (const t of tix) (byW.get(t.holder) || byW.set(t.holder, []).get(t.holder)).push(t);
  for (const d of ['docs/api/report', 'docs/api/card', 'docs/api/recap']) mkdirSync(d, { recursive: true });
  const index = [];
  for (const [w, list] of byW) {
    list.sort((a, b) => endOf(a) - endOf(b));
    const dec = list.filter((t) => t.status === 'won' || t.status === 'lost');
    const won = dec.filter((t) => t.status === 'won').length, lost = dec.length - won;
    const pk = dec.filter(isPicked), as = dec.filter((t) => t.how === 'mint');
    const waiting = list.filter((t) => t.status === 'live' || t.status === 'finished');
    let run = 0; for (let i = dec.length - 1; i >= 0 && dec[i].status === 'won'; i--) run++;
    const ci = wilson(won, dec.length);
    const pci = wilson(pk.filter((t) => t.status === 'won').length, pk.length);
    const markets = {};
    for (const t of dec) { const m = (markets[t.m] ||= { won: 0, lost: 0 }); m[t.status]++; }
    const c = claimsBy.get(w);
    const todo = [];
    for (const x of c?.markets || []) todo.push({ call: 'claim()', inputData: '0x4e71d92d', to: x.contract, what: `write ${x.finishedTickets} finished ${x.market} ticket(s) into the record` });
    for (const x of c?.extras || []) todo.push({ call: x.call, inputData: x.inputData, to: x.contract, what: x.why || x.call });
    const nextResult = waiting.length ? Math.min(...waiting.map(endOf)) : null;
    const s = { won, lost, hitRate: dec.length ? won / dec.length : null, pickedWon: pk.filter((t) => t.status === 'won').length, pickedLost: pk.filter((t) => t.status === 'lost').length,
      assignedWon: as.filter((t) => t.status === 'won').length, assignedLost: as.filter((t) => t.status === 'lost').length, last: dec.slice(-12).map((t) => t.status) };
    const v = verdict(won, dec.length, ci);
    const pv = pk.length ? verdict(s.pickedWon, pk.length, pci) : null;
    const rep = {
      wallet: w, tickets: list.length, decided: dec.length, won, lost, hitRate: s.hitRate == null ? null : Math.round(s.hitRate * 1000) / 1000, ci95: ci, currentWinRun: run,
      picked: { decided: pk.length, won: s.pickedWon, ci95: pci, verdict: pv?.code ?? null }, assigned: { decided: as.length, won: s.assignedWon },
      byMarket: markets, waitingTickets: waiting.length, nextResultAt: nextResult ? new Date(nextResult * 1000).toISOString().slice(0, 16) + 'Z' : null,
      verdict: pv?.code ?? 'no-own-picks', overallAllTickets: v.code, todoNow: todo,
      proof: { record: `${SITE}/me.html?w=${w}`, tickets: Object.fromEntries([...new Set(list.map((t) => t.m))].map((m) => [m, `https://bscscan.com/token/${CONTRACT[m]}?a=${w}`])) },
      links: { card: `${SITE}/api/card/${w}.svg`, briefEn: `${SITE}/api/report/${w}.md`, briefKo: `${SITE}/api/report/${w}.ko.md`, briefZh: `${SITE}/api/report/${w}.zh.md` },
    };
    writeFileSync(`docs/api/report/${w}.json`, JSON.stringify(rep, null, 1) + '\n');
    const mk = Object.entries(markets).map(([m, x]) => `${m} ${x.won}-${x.lost}`).join(' · ') || '–';
    const todoEn = todo.length ? todo.map((t) => `- \`${t.call}\` \`${t.inputData}\` on \`${t.to}\`: ${t.what}`).join('\n') : '- Nothing waiting right now.';
    const nextEn = rep.nextResultAt ? `Next result: ${rep.nextResultAt.replace('T', ' ').replace('Z', ' UTC')}. Come back then: \`claim()\` writes it into the record.` : 'No ticket is waiting for a result.';
    writeFileSync(`docs/api/report/${w}.md`, `# Your Forecast League record

**${won} won, ${lost} lost** (${pct(s.hitRate)} of ${dec.length} decided tickets), settled on BNB Chain from Chainlink prices. ${run ? `Current run: ${run} in a row.` : ''}

- **Your agent's own calls** (\`up()\`/\`down()\`): ${s.pickedWon} won, ${s.pickedLost} lost.${pv ? ' ' + pv.en : ''}
- **Assigned sides** (\`mint()\`, a coin flip by design): ${s.assignedWon} won, ${s.assignedLost} lost.
- **By market:** ${mk}
- **Skill verdict (own calls only):** ${pv ? pv.en : 'None yet. Only your agent\'s own up()/down() calls measure skill; assigned sides are a coin flip and say nothing about it. Ask your agent to pick the side itself.'}

## What to do now (every call value 0, preview first)
${todoEn}

${nextEn}

Proof: [record](${SITE}/me.html?w=${w}) · card: ${SITE}/api/card/${w}.svg · Forecast League is a Binance Agent ID Hackathon entry; tickets have no monetary value and there is no prize.
`);
    const todoKo = todo.length ? todo.map((t) => `- \`${t.to}\`에 \`${t.call}\` \`${t.inputData}\`: ${t.what}`).join('\n') : '- 지금 할 일은 없습니다.';
    writeFileSync(`docs/api/report/${w}.ko.md`, `# Forecast League 내 기록

**${won}승 ${lost}패** (결과가 난 ${dec.length}장 중 ${pct(s.hitRate)}), BNB Chain 위에서 Chainlink 가격으로 판정됐습니다. ${run ? `지금 ${run}연승 중입니다.` : ''}

- **에이전트가 직접 고른 것** (\`up()\`/\`down()\`): ${s.pickedWon}승 ${s.pickedLost}패.${pv ? ' ' + pv.ko : ''}
- **배정받은 것** (\`mint()\`, 원래 동전 던지기): ${s.assignedWon}승 ${s.assignedLost}패.
- **시장별:** ${mk}
- **실력 판단 (직접 고른 것만):** ${pv ? pv.ko : '아직 없습니다. 실력은 에이전트가 직접 고른 up()/down()으로만 잽니다. 배정받은 방향은 동전 던지기라 실력과 무관합니다. 에이전트에게 직접 방향을 고르라고 해 보세요.'}

## 지금 할 일 (모두 0원, 미리보기 먼저)
${todoKo}

${rep.nextResultAt ? `다음 결과: ${rep.nextResultAt.replace('T', ' ').replace('Z', ' UTC')}. 그때 돌아와 \`claim()\`을 보내야 기록에 반영됩니다.` : '결과를 기다리는 티켓이 없습니다.'}

증거: [기록](${SITE}/me.html?w=${w}) · 카드: ${SITE}/api/card/${w}.svg · Forecast League는 Binance Agent ID 해커톤 출품작이며, 티켓에는 금전적 가치도 상품도 없습니다.
`);
    const todoZh = todo.length ? todo.map((t) => `- 在 \`${t.to}\` 调用 \`${t.call}\` \`${t.inputData}\`：${t.what}`).join('\n') : '- 目前没有待办。';
    writeFileSync(`docs/api/report/${w}.zh.md`, `# 我的 Forecast League 战绩

**${won} 胜 ${lost} 负**（已结算 ${dec.length} 张中 ${pct(s.hitRate)}），在 BNB Chain 上按 Chainlink 价格结算。${run ? `目前 ${run} 连胜。` : ''}

- **代理自己选的方向**（\`up()\`/\`down()\`）：${s.pickedWon} 胜 ${s.pickedLost} 负。${pv ? ' ' + pv.zh : ''}
- **合约分配的方向**（\`mint()\`，本质是抛硬币）：${s.assignedWon} 胜 ${s.assignedLost} 负。
- **各市场：** ${mk}
- **实力判断（仅自选）：** ${pv ? pv.zh : '暂无。只有代理自己用 up()/down() 选的方向才能衡量实力；分配的方向相当于抛硬币，与实力无关。可以让代理自己选方向。'}

## 现在可以做的（全部 value 0，先预览）
${todoZh}

${rep.nextResultAt ? `下一个结果：${rep.nextResultAt.replace('T', ' ').replace('Z', ' UTC')}。届时回来发送 \`claim()\` 才会写入战绩。` : '没有等待结果的门票。'}

证明：[战绩](${SITE}/me.html?w=${w}) · 卡片：${SITE}/api/card/${w}.svg · Forecast League 是币安 Agent ID 黑客松参赛作品；门票没有任何金钱价值，也没有奖品。
`);
    writeFileSync(`docs/api/card/${w}.svg`, card(w, s));
    index.push(w);
  }
  writeFileSync('docs/api/report/index.json', JSON.stringify({ wallets: index.sort(), files: '<address>.json, .md, .ko.md, .zh.md; cards at /api/card/<address>.svg' }) + '\n');

  // Recap of the last finished 6h round, all three markets.
  const stats = readJ('docs/stats.json');
  const sixR = Math.floor(now / 21600) - 2; // its result became final at (r+2)*6h <= now
  const rec = { round: sixR, lockUTC: new Date((sixR + 1) * 21600000).toISOString().slice(0, 16) + 'Z', resultUTC: new Date((sixR + 2) * 21600000).toISOString().slice(0, 16) + 'Z', markets: [] };
  for (const m of ['BTC 6h', 'ETH 6h', 'BNB 6h']) {
    const tk = tix.filter((t) => t.m === m && t.round === sixR);
    const dec = tk.filter((t) => t.status === 'won' || t.status === 'lost');
    const pk = dec.filter(isPicked);
    const r = (stats?.markets || []).find((x) => x.contract?.toLowerCase() === CONTRACT[m].toLowerCase())?.rounds?.find((x) => x.round === sixR);
    rec.markets.push({ market: m, tickets: tk.length, outcome: r?.outcome ?? null, lock: r?.lockPrice ?? null, result: r?.resultPrice ?? null,
      right: dec.filter((t) => t.status === 'won').length, decided: dec.length, pickedRight: pk.filter((t) => t.status === 'won').length, picked: pk.length });
  }
  writeFileSync('docs/api/recap/latest.json', JSON.stringify(rec, null, 1) + '\n');
  const row = (x, l) => {
    const px = x.lock && x.result ? `${Number(x.lock).toLocaleString('en-US', { maximumFractionDigits: 2 })} → ${Number(x.result).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : (l === 'ko' ? '판정 대기' : l === 'zh' ? '等待结算' : 'awaiting settlement');
    const oc = x.outcome ? x.outcome.toUpperCase() : '–';
    if (l === 'ko') return `| ${x.market} | ${oc} | ${px} | ${x.tickets}장 | ${x.right}/${x.decided} | ${x.pickedRight}/${x.picked} |`;
    if (l === 'zh') return `| ${x.market} | ${oc} | ${px} | ${x.tickets} 张 | ${x.right}/${x.decided} | ${x.pickedRight}/${x.picked} |`;
    return `| ${x.market} | ${oc} | ${px} | ${x.tickets} | ${x.right}/${x.decided} | ${x.pickedRight}/${x.picked} |`;
  };
  writeFileSync('docs/api/recap/latest.md', `# Round recap: ${rec.lockUTC.replace('T', ' ').replace('Z', '')} → ${rec.resultUTC.replace('T', ' ').replace('Z', '')} UTC\n\n| Market | Result | Chainlink price | Tickets | Right | Picked right |\n|---|---|---|---|---|---|\n${rec.markets.map((x) => row(x, 'en')).join('\n')}\n\n"Picked" are sides agents chose themselves; the rest were assigned by the contract (a coin flip). If you hold one of these tickets, \`claim()\` \`0x4e71d92d\` on that market writes the result into your record. Forecast League is a Binance Agent ID Hackathon entry; no prize.\n`);
  writeFileSync('docs/api/recap/latest.ko.md', `# 라운드 결과: ${rec.lockUTC.replace('T', ' ').replace('Z', '')} → ${rec.resultUTC.replace('T', ' ').replace('Z', '')} UTC\n\n| 시장 | 결과 | Chainlink 가격 | 티켓 | 맞힘 | 직접 고른 것 중 맞힘 |\n|---|---|---|---|---|---|\n${rec.markets.map((x) => row(x, 'ko')).join('\n')}\n\n"직접 고른 것"은 에이전트가 스스로 정한 방향이고, 나머지는 계약이 배정한 방향(동전 던지기)입니다. 이 티켓을 갖고 있다면 해당 시장에 \`claim()\` \`0x4e71d92d\`를 보내면 기록에 반영됩니다. Binance Agent ID 해커톤 출품작이며 상품은 없습니다.\n`);
  writeFileSync('docs/api/recap/latest.zh.md', `# 轮次结果：${rec.lockUTC.replace('T', ' ').replace('Z', '')} → ${rec.resultUTC.replace('T', ' ').replace('Z', '')} UTC\n\n| 市场 | 结果 | Chainlink 价格 | 门票 | 猜对 | 自选中猜对 |\n|---|---|---|---|---|---|\n${rec.markets.map((x) => row(x, 'zh')).join('\n')}\n\n“自选”指代理自己选的方向，其余是合约分配的方向（抛硬币）。持有这些门票的话，在对应市场调用 \`claim()\` \`0x4e71d92d\` 即可写入战绩。币安 Agent ID 黑客松参赛作品，没有奖品。\n`);

  // The league today.
  const P = tix.filter(isPicked).filter((t) => t.status === 'won' || t.status === 'lost');
  const pw = P.filter((t) => t.status === 'won').length;
  const A = tix.filter((t) => t.how === 'mint' && (t.status === 'won' || t.status === 'lost'));
  const aw = A.filter((t) => t.status === 'won').length;
  const sh = readJ('docs/api/agent/shadow.json');
  const ranking = readJ('docs/api/ranking.json');
  const facts = {
    wallets: byW.size, tickets: tix.length, pickedRate: P.length ? pw / P.length : null, pickedN: P.length, assignedRate: A.length ? aw / A.length : null, assignedN: A.length,
    waiting: claims ? claims.finishedTickets : null, stampsToday: stamps?.stampedToday ?? null, rankTx: ranking?.ours?.rankByTransactions ?? null, shadow: sh?.total?.rule ?? null,
  };
  writeFileSync('docs/api/digest.md', `# Forecast League today\n\n- **${facts.wallets} Agent ID wallets** hold ${facts.tickets} round tickets on BNB Chain.\n- **Agents' own calls:** right ${pct(facts.pickedRate)} of ${facts.pickedN} decided; **assigned sides** (the control): ${pct(facts.assignedRate)} of ${facts.assignedN}.\n- **Waiting to be claimed:** ${facts.waiting ?? '–'} finished tickets ([who can claim what](${SITE}/api/claims.json)).\n- **Stamp Week:** ${facts.stampsToday ?? '–'} wallets stamped today.\n${facts.shadow && facts.shadow.decided ? `- **The builder agent's shadow picks:** ${facts.shadow.right} of ${facts.shadow.decided} right so far.\n` : ''}\nForecast League is a Binance Agent ID Hackathon entry: value 0 on every call, no prize, no promise of value.\n`);
  writeFileSync('docs/api/digest.ko.md', `# 오늘의 Forecast League\n\n- **Agent ID 지갑 ${facts.wallets}개**가 BNB Chain에서 라운드 티켓 ${facts.tickets}장을 갖고 있습니다.\n- **에이전트가 직접 고른 것:** 결과가 난 ${facts.pickedN}장 중 ${pct(facts.pickedRate)} 적중. **배정받은 것**(비교군): ${facts.assignedN}장 중 ${pct(facts.assignedRate)}.\n- **claim 대기:** 끝난 티켓 ${facts.waiting ?? '–'}장 ([누가 무엇을 claim할 수 있는지](${SITE}/api/claims.json)).\n- **스탬프 위크:** 오늘 ${facts.stampsToday ?? '–'}개 지갑이 찍었습니다.\n\nForecast League는 Binance Agent ID 해커톤 출품작입니다. 모든 호출은 0원이며 상품도 가치 약속도 없습니다.\n`);
  writeFileSync('docs/api/digest.zh.md', `# 今日 Forecast League\n\n- **${facts.wallets} 个 Agent ID 钱包**在 BNB Chain 上持有 ${facts.tickets} 张轮次门票。\n- **代理自选方向：** 已结算 ${facts.pickedN} 张中猜对 ${pct(facts.pickedRate)}；**合约分配**（对照组）：${facts.assignedN} 张中 ${pct(facts.assignedRate)}。\n- **待记入战绩：** ${facts.waiting ?? '–'} 张已结束门票（[每个钱包可以发送什么](${SITE}/api/claims.json)）。\n- **印章周：** 今天 ${facts.stampsToday ?? '–'} 个钱包领了印章。\n\nForecast League 是币安 Agent ID 黑客松参赛作品：每次调用 value 0，没有奖品，也不承诺任何价值。\n`);
  return { wallets: byW.size };
}
