// Forecast League: read-only data layer for the website.
// Reads public chain data through public RPC endpoints. No wallet, no keys, no cookies.
// Works in the browser (window.League) and in Node 18+ (module.exports) for testing.
(function (root) {
  const CORE = '0x79F55DAa8a3CF2Eb76EE40e26ff6E244a4cC1eD4';
  const SCORER = '0x5ea789e7cd9C157793dDA75959829F8C1527C16b';
  const REGISTRY = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f';
  const SQUADS = '0x1eAeEE5BA7582858b266920E79938203E92120D0';
  const BLITZ = ''; // set when Blitz is deployed
  const MULTICALL = '0xcA11bde05977b3631167028862bE2a173976CA11';
  const RPCS = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed.binance.org'];
  const SEL = {
    totalCards: '0xe994c15d', ownerOf: '0x6352211e', submissionCount: '0x920ccaf1', showName: '0xfeeb4e45',
    submissionOf: '0x044e613c', statsOf: '0x15cfc405', roundOf: '0xdba20268', handleOf: '0xc50a1514',
    aggregate3: '0x82ad56cb', scored: '0xa86c3b41',
    squadOf: '0xbb2623a3', isSquad: '0x29303707', memberCount: '0xb843b11a', captainsCount: '0x1b88c370', captains: '0xf412511e',
    bTotalSupply: '0x18160ddd', bTotalPlayers: '0xf60cdcf6', bCurrentRound: '0x8a19c8bc', bRoundMinted: '0xc31ef0f6',
    bTicket: '0xc129ff32', bRecordOf: '0xc06ac6a3',
  };
  const BATCH = 250;

  const word = (n) => BigInt(n).toString(16).padStart(64, '0');
  const addrWord = (a) => a.slice(2).toLowerCase().padStart(64, '0');
  const slot = (hex, i) => BigInt('0x' + (hex.slice(2 + i * 64, 2 + (i + 1) * 64) || '0'));
  const signed = (v, bits) => (v >= 1n << BigInt(bits - 1) ? v - (1n << BigInt(bits)) : v);

  async function rpc(method, params) {
    let last;
    for (const url of RPCS) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
        const body = await res.json();
        if (body.result !== undefined && body.result !== null) return body.result;
        last = new Error((body.error && body.error.message) || 'rpc');
      } catch (e) { last = e; }
    }
    throw last || new Error('rpc');
  }

  // Multicall3.aggregate3((address target, bool allowFailure, bytes callData)[])
  function encodeAggregate3(calls) {
    const heads = []; const bodies = []; let offset = calls.length * 32;
    for (const c of calls) {
      const data = c.data.slice(2); const len = data.length / 2;
      const body = addrWord(c.to) + word(1) + word(0x60) + word(len) + data.padEnd(Math.ceil(len / 32) * 64, '0');
      heads.push(word(offset)); bodies.push(body); offset += body.length / 2;
    }
    return SEL.aggregate3 + word(0x20) + word(calls.length) + heads.join('') + bodies.join('');
  }
  function decodeAggregate3(hex) {
    const h = hex.slice(2); const at = (pos) => parseInt(h.substr(pos * 2, 64), 16);
    const base = at(0); const n = at(base); const out = [];
    const start = base + 32;
    for (let i = 0; i < n; i++) {
      const el = start + at(start + i * 32);
      const ok = at(el) === 1; const dataPos = el + at(el + 32); const len = at(dataPos);
      out.push(ok ? '0x' + h.substr((dataPos + 32) * 2, len * 2) : null);
    }
    return out;
  }
  async function multicall(calls) {
    const out = [];
    for (let i = 0; i < calls.length; i += BATCH) {
      const part = calls.slice(i, i + BATCH);
      const res = await rpc('eth_call', [{ to: MULTICALL, data: encodeAggregate3(part) }, 'latest']);
      out.push(...decodeAggregate3(res));
    }
    return out;
  }

  function decodeString(hex) {
    if (!hex || hex.length < 130) return '';
    const h = hex.slice(2); const len = parseInt(h.slice(64, 128), 16); const body = h.slice(128, 128 + len * 2);
    let s = ''; for (let i = 0; i < body.length; i += 2) s += String.fromCharCode(parseInt(body.substr(i, 2), 16));
    return /^[a-z0-9]{1,32}$/.test(s) ? s : '';
  }

  // Same formula as Scorer.scoreOf, including rounding toward zero.
  function scoreOf(p0, p1, f) {
    const abs = (a, b) => (a > b ? a - b : b - a);
    const base = abs(p1, p0); const err = abs(p1, f);
    let floor = p0 / 1000n; if (floor === 0n) floor = 1n;
    const denom = base > floor ? base : floor;
    let v = ((base - err) * 100n) / denom;
    if (v > 100n) v = 100n; if (v < -100n) v = -100n;
    return Number(v);
  }
  const tierOf = (n) => (n >= 15 ? 'ORACLE' : n >= 8 ? 'STRATEGIST' : n >= 3 ? 'ANALYST' : 'ROOKIE');
  const price = (v) => Number(v) / 1e8;

  async function load() {
    const block = await rpc('eth_getBlockByNumber', ['latest', false]);
    const now = Number(BigInt(block.timestamp));
    const epoch = Math.floor(now / 86400);
    const last = epoch - 1; // the round whose submissions closed at the latest 00:00 UTC
    const head = await multicall([
      { to: CORE, data: SEL.totalCards },
      { to: SQUADS, data: SEL.captainsCount },
      ...[0, 1, 2].map((f) => ({ to: SCORER, data: SEL.roundOf + word(last) + word(f) })),
    ]);
    const total = Number(slot(head[0], 0));
    const captainsCount = head[1] ? Number(slot(head[1], 0)) : 0;
    const round = [2, 3, 4].map((i) => {
      const r = head[i];
      return r ? { p0: slot(r, 0), p1: slot(r, 2), settled: slot(r, 4) !== 0n, final: slot(r, 5) === 1n } : { p0: 0n, p1: 0n, settled: false, final: false };
    });

    const owners = (await multicall(Array.from({ length: total }, (_, i) => ({ to: CORE, data: SEL.ownerOf + word(i + 1) }))))
      .map((r) => (r ? '0x' + r.slice(26) : null));
    const calls = [];
    owners.forEach((o) => {
      const a = addrWord(o || '0x' + '0'.repeat(40));
      calls.push({ to: CORE, data: SEL.submissionCount + a }, { to: CORE, data: SEL.showName + a },
        { to: SCORER, data: SEL.statsOf + a }, { to: CORE, data: SEL.submissionOf + a + word(epoch) },
        { to: CORE, data: SEL.submissionOf + a + word(last) }, { to: SCORER, data: SEL.scored + a + word(last) },
        { to: SQUADS, data: SEL.squadOf + a });
    });
    const res = await multicall(calls);
    const rows = owners.map((owner, i) => {
      const [count, show, stats, today, prev, done, squad] = res.slice(i * 7, i * 7 + 7);
      const forecasts = count ? Number(slot(count, 0)) : 0;
      let lastScore = null; // score of the latest closed round, worked out from the settled prices
      if (prev && slot(prev, 3) !== 0n) {
        lastScore = { pending: true };
        const parts = [0, 1, 2].map((f) => {
          const fc = slot(prev, f);
          if (fc === 0n) return null;
          return round[f].settled ? scoreOf(round[f].p0, round[f].p1, fc) : undefined;
        });
        if (parts.every((p) => p !== undefined)) {
          lastScore = { pending: false, parts, total: parts.reduce((a, p) => a + (p || 0), 0) };
        }
      }
      return {
        id: i + 1, owner, forecasts, tier: tierOf(forecasts), showName: !!show && slot(show, 0) === 1n,
        scoredRounds: stats ? Number(slot(stats, 0)) : 0, wins: stats ? Number(slot(stats, 2)) : 0,
        total: stats ? Number(signed(slot(stats, 3), 256)) : 0,
        submittedToday: !!today && slot(today, 3) !== 0n, lastScore, name: '',
        lastInRecord: !!done && slot(done, 0) === 1n,
        squad: squad && slot(squad, 0) !== 0n ? '0x' + squad.slice(26, 66) : null,
      };
    });
    const named = rows.filter((r) => r.showName && r.owner);
    const names = await multicall(named.map((r) => ({ to: REGISTRY, data: SEL.handleOf + addrWord(r.owner) })));
    named.forEach((r, i) => { r.name = decodeString(names[i]); });

    // Ranking: on-chain record plus the latest round if it is not in the record yet, then activity.
    rows.forEach((r) => {
      const extra = r.lastScore && !r.lastScore.pending && !r.lastInRecord ? r.lastScore.total : 0;
      r.points = r.total + extra;
    });
    const ranked = rows.filter((r) => r.forecasts > 0).sort((a, b) =>
      b.points - a.points || b.forecasts - a.forecasts || a.id - b.id);
    // Squads: every captain that ever opened one, filtered to the open ones.
    const caps = (await multicall(Array.from({ length: captainsCount }, (_, i) => ({ to: SQUADS, data: SEL.captains + word(i) }))))
      .map((r) => '0x' + r.slice(26, 66));
    const capInfo = await multicall(caps.flatMap((c) => [
      { to: SQUADS, data: SEL.isSquad + addrWord(c) }, { to: SQUADS, data: SEL.memberCount + addrWord(c) },
      { to: REGISTRY, data: SEL.handleOf + addrWord(c) },
    ]));
    const squads = caps.map((captain, i) => {
      const members = rows.filter((r) => r.squad === captain);
      // Squad score: the five best members. A member who does not play, or plays badly, cannot pull it down.
      const best = members.map((r) => r.points).sort((a, b) => b - a).slice(0, 5).filter((p) => p > 0);
      return {
        order: i + 1, founding: i < 20,
        captain, open: !!capInfo[i * 3] && slot(capInfo[i * 3], 0) === 1n,
        members: capInfo[i * 3 + 1] ? Number(slot(capInfo[i * 3 + 1], 0)) : 0, name: decodeString(capInfo[i * 3 + 2]),
        score: best.reduce((a, p) => a + p, 0), forecasts: members.reduce((a, r) => a + r.forecasts, 0),
      };
    }).filter((q) => q.open).sort((a, b) => b.score - a.score || b.members - a.members || b.forecasts - a.forecasts);

    const blitz = BLITZ ? await loadBlitz(rows) : null;
    // Funnel: how far holders go after the card. Counted from current state, no history needed.
    const funnel = {
      cards: rows.length,
      forecastOnce: rows.filter((r) => r.forecasts >= 1).length,
      forecastTwice: rows.filter((r) => r.forecasts >= 2).length,
      forecastThree: rows.filter((r) => r.forecasts >= 3).length,
      inSquad: rows.filter((r) => r.squad).length,
      nameShown: rows.filter((r) => r.showName).length,
    };

    return {
      squads, blitz, funnel,
      now, epoch, lockAt: (epoch + 1) * 86400, resultAt: (epoch + 1) * 86400 + 6.5 * 3600,
      total, forecasters: ranked.length, submittedToday: rows.filter((r) => r.submittedToday).length,
      lastEpoch: last,
      lastRound: {
        settled: round.every((r) => r.settled), final: round.every((r) => r.final),
        prices: ['BTC', 'ETH', 'BNB'].map((pair, f) => ({ pair, lock: price(round[f].p0), result: price(round[f].p1) })),
        players: rows.filter((r) => r.lastScore).length,
      },
      ranked, rows,
    };
  }

  // Blitz: players are found from the latest tickets, their records read from the contract.
  async function loadBlitz(cardRows) {
    const head = await multicall([
      { to: BLITZ, data: SEL.bTotalSupply }, { to: BLITZ, data: SEL.bTotalPlayers }, { to: BLITZ, data: SEL.bCurrentRound },
    ]);
    const supply = Number(slot(head[0], 0)); const players = Number(slot(head[1], 0)); const round = Number(slot(head[2], 0));
    const from = Math.max(1, supply - 1999);
    const ids = []; for (let id = supply; id >= from; id--) ids.push(id);
    const tickets = (await multicall([{ to: BLITZ, data: SEL.bRoundMinted + word(round) },
      ...ids.map((id) => ({ to: BLITZ, data: SEL.bTicket + word(id) }))]));
    const minted = Number(slot(tickets[0], 0));
    let up = 0; let down = 0; const owners = [];
    const now = new Set(); const before = new Set(); // players of the open round and of the one before it
    tickets.slice(1).forEach((t) => {
      if (!t) return;
      const owner = '0x' + t.slice(26, 66); if (!owners.includes(owner)) owners.push(owner);
      const r = Number(slot(t, 1));
      if (r === round) { now.add(owner); if (slot(t, 2) === 1n) up++; else down++; }
      if (r === round - 1) before.add(owner);
    });
    // Of the players of the previous round, how many have a ticket in the open one so far.
    const returning = [...before].filter((o) => now.has(o)).length;
    const recs = await multicall(owners.map((o) => ({ to: BLITZ, data: SEL.bRecordOf + addrWord(o) })));
    const nameOf = {}; cardRows.forEach((r) => { if (r.name && r.owner) nameOf[r.owner.toLowerCase()] = r.name; });
    const table = owners.map((owner, i) => {
      const r = recs[i];
      return {
        owner, name: nameOf[owner.toLowerCase()] || '', tickets: Number(slot(r, 0)), wins: Number(slot(r, 1)), losses: Number(slot(r, 2)),
        streak: Number(slot(r, 3)), best: Number(slot(r, 4)), unclaimed: Number(slot(r, 5)),
      };
    }).sort((a, b) => (b.wins - b.losses) - (a.wins - a.losses) || b.best - a.best || b.tickets - a.tickets);
    return { address: BLITZ, supply, players, round, minted, up, down, lockAt: (round + 1) * 21600, table,
      previousRoundPlayers: before.size, returning };
  }

  const api = { load, scoreOf, encodeAggregate3, decodeAggregate3, CORE, SCORER, SQUADS, BLITZ };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.League = api;
})(typeof window !== 'undefined' ? window : globalThis);
