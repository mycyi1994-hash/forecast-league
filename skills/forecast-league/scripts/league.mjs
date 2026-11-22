#!/usr/bin/env node
// Forecast League helper. Node 18+, no dependencies.
//
// It does three things:
//   1. reads public data from BNB Chain (status)
//   2. builds call data: for a forecast submission (encode), for the player card alone (encode-mint),
//      for writing a finished round's score into the record (encode-score),
//      or for opening or joining a squad (encode-squad)
//   3. says what an address can do in Blitz, the six-hour round, and prints those calls (blitz),
//      or every free call it can make now over all contracts (all). For each open round it lists
//      up() and down() first, with neutral context (recent settled results, price now, time to lock),
//      and asks the agent to choose and give its human a one-sentence reason; mint(), the side the
//      contract assigns, comes last. `--side up|down` prints just that ticket call.
// It never signs, never sends a transaction, never reads wallet or session files,
// and contacts nothing except the public RPC endpoints below.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CONFIG = {
  chainId: 56,
  // Public endpoints, tried in order. LEAGUE_RPC puts one of your own first.
  rpcs: [process.env.LEAGUE_RPC, 'https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed.binance.org'].filter(Boolean),
  // Filled in at deployment. `encode` refuses to run while this is the zero address.
  core: '0x79F55DAa8a3CF2Eb76EE40e26ff6E244a4cC1eD4',
  scorer: '0x5ea789e7cd9C157793dDA75959829F8C1527C16b',
  squads: '0x1eAeEE5BA7582858b266920E79938203E92120D0',
  // Blitz, the six-hour round.
  blitz: '0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C',
  // Further Blitz markets: the same contract code with another Chainlink feed. Empty means not open.
  blitzEth: '0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1',
  blitzBnb: '0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9',
  agentId: '0x60b9262456de011f7d15a54cdd8c48baaa8b022f',
  feeds: {
    btc: '0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf',
    eth: '0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e',
    bnb: '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE',
  },
  // A forecast further than this from the current price is treated as a typing mistake.
  maxDeviationPercent: 50,
};

const SEL = {
  submit: '0x6b89ae10', // submit(uint64[3],bool,uint32)
  mint: '0x1249c58b', // mint()
  score: '0xa2f93a8f', // score(address,uint32) on the Scorer
  createSquad: '0x40796e83', // on Squads
  joinSquad: '0x376dcc1a', // joinSquad(string) on Squads
  squadOf: '0xbb2623a3',
  isSquad: '0x29303707',
  memberCount: '0xb843b11a',
  ownerOfHandle: '0x1da94fb4',
  currentEpoch: '0x76671808',
  cardOf: '0x48e748a0',
  showName: '0xfeeb4e45',
  submissionCount: '0x920ccaf1',
  submissionOf: '0x044e613c',
  statsOf: '0x15cfc405',
  isQualified: '0xa421d668',
  latestRoundData: '0xfeaf968c',
  balanceOf: '0x70a08231',
};

const ZERO = '0x0000000000000000000000000000000000000000';
// Submissions prepared this close to the daily lock are refused: they may land in the next day.
const MIN_SECONDS_BEFORE_LOCK = 180;
const PAIRS = ['btc', 'eth', 'bnb'];
const U64_MAX = (1n << 64n) - 1n;

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}

function word(value) {
  return BigInt(value).toString(16).padStart(64, '0');
}

function addressWord(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) fail(`Not an address: ${address}`);
  return address.slice(2).toLowerCase().padStart(64, '0');
}

/** "64300.5" -> 6430050000000n (8 decimals), exact, no floating point. */
export function parsePrice(text, label) {
  if (text === undefined || text === null || text === '' || text === '0') return 0n;
  if (!/^\d+(\.\d{1,8})?$/.test(String(text))) {
    fail(`${label}: "${text}" is not a plain positive number with at most 8 decimals.`);
  }
  const [whole, frac = ''] = String(text).split('.');
  const value = BigInt(whole) * 100000000n + BigInt(frac.padEnd(8, '0'));
  if (value > U64_MAX) fail(`${label}: number too large.`);
  return value;
}

export function formatPrice(value) {
  const v = BigInt(value);
  const whole = v / 100000000n;
  const frac = (v % 100000000n).toString().padStart(8, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function encodeSubmit(prices, showName, epoch) {
  return SEL.submit + prices.map(word).join('') + word(showName ? 1 : 0) + word(epoch);
}

/** Only an explicit yes/no is accepted, so a choice is never changed by accident. */
export function parseYesNo(value, label) {
  if (value === 'yes' || value === 'true') return true;
  if (value === 'no' || value === 'false') return false;
  fail(`${label} must be given as yes or no.`);
}

/** Time of the latest block. The contract decides the day from this clock, not from ours. */
async function chainTime() {
  const block = await rpc('eth_getBlockByNumber', ['latest', false]);
  return Number(BigInt(block.timestamp));
}

/** One JSON-RPC request with a 12 second timeout, falling back to the next endpoint when one is unreachable. */
let workingRpc; // the endpoint that answered last, tried first next time
async function rpc(method, params) {
  let lastError;
  const order = workingRpc ? [workingRpc, ...CONFIG.rpcs.filter((u) => u !== workingRpc)] : CONFIG.rpcs;
  for (const url of order) {
    let body;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(12000),
      });
      body = await res.json();
    } catch (e) {
      lastError = new Error(`${method}: ${url} did not answer (${e.name})`);
      continue;
    }
    workingRpc = url;
    // An answer from the chain, including a revert, is final: another endpoint would say the same.
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  }
  throw lastError || new Error(`${method}: no RPC endpoint configured`);
}

async function call(to, data) {
  return rpc('eth_call', [{ to, data }, 'latest']);
}

function slot(hex, index) {
  return BigInt('0x' + hex.slice(2 + index * 64, 2 + (index + 1) * 64));
}

function signed(value, bits) {
  return value >= 1n << BigInt(bits - 1) ? value - (1n << 256n) : value;
}

async function currentPrices() {
  const out = {};
  for (const pair of PAIRS) {
    const data = await call(CONFIG.feeds[pair], SEL.latestRoundData);
    out[pair] = slot(data, 1);
  }
  return out;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      args._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function nextLock(nowSeconds) {
  return (Math.floor(nowSeconds / 86400) + 1) * 86400;
}

async function cmdEncode(args) {
  if (CONFIG.core.toLowerCase() === ZERO) fail('The league contract address is not configured yet.');
  const prices = PAIRS.map((p) => parsePrice(args[p], p.toUpperCase()));
  if (prices.every((p) => p === 0n)) fail('Give at least one of --btc, --eth, --bnb.');

  const live = await currentPrices();
  PAIRS.forEach((pair, i) => {
    if (prices[i] === 0n) return;
    const diff = prices[i] > live[pair] ? prices[i] - live[pair] : live[pair] - prices[i];
    if (diff * 100n > live[pair] * BigInt(CONFIG.maxDeviationPercent)) {
      fail(
        `${pair.toUpperCase()}: forecast ${formatPrice(prices[i])} is more than ${CONFIG.maxDeviationPercent}% away ` +
          `from the current price ${formatPrice(live[pair])}. This looks like a typing mistake.`,
      );
    }
  });

  const showName = parseYesNo(args['show-name'], '--show-name');
  const now = await chainTime();
  const lock = nextLock(now);
  const epoch = Math.floor(now / 86400);
  if (lock - now < MIN_SECONDS_BEFORE_LOCK) {
    fail(
      `Today's round locks in ${lock - now} seconds. That is too close: the submission could be ` +
        'included after 00:00 UTC and would then be rejected. Wait until after the lock and submit for the next round.',
    );
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        // Pass these three values to `baw contract-call preview` exactly as they are.
        binanceChainId: String(CONFIG.chainId),
        to: CONFIG.core,
        value: '0',
        inputData: encodeSubmit(prices, showName, epoch),
        // Show this summary to the user before asking for confirmation.
        summary: {
          action: 'Submit forecasts to Forecast League (no funds are sent)',
          contract: CONFIG.core,
          function: 'submit(uint64[3] prices, bool showName, uint32 expectedEpoch)',
          forecasts: Object.fromEntries(
            PAIRS.map((p, i) => [`${p.toUpperCase()}/USD`, prices[i] === 0n ? 'skipped' : formatPrice(prices[i])]),
          ),
          currentPrices: Object.fromEntries(PAIRS.map((p) => [`${p.toUpperCase()}/USD`, formatPrice(live[p])])),
          showAgentIdName: showName,
          valueSent: '0 BNB',
          epoch,
          roundLocksAt: new Date(lock * 1000).toISOString(),
          minutesUntilLock: Math.floor((lock - now) / 60),
          resultAt: 'about 6.5 hours after the lock',
          note:
            'One submission per UTC day. If this call is included after the lock time it is rejected ' +
            '(WrongEpoch) and nothing is recorded. Not financial advice. Scores and cards have no monetary value.',
        },
      },
      null,
      2,
    ),
  );
}

/** Call data for getting the player card without submitting a forecast. */
async function cmdEncodeMint(args) {
  if (CONFIG.core.toLowerCase() === ZERO) fail('The league contract address is not configured yet.');
  const address = args.address === true ? undefined : args.address;
  if (address) {
    if (slot(await call(CONFIG.agentId, SEL.balanceOf + addressWord(address)), 0) === 0n) {
      fail(`${address} does not hold an Agent ID. Claim one in the Binance App first.`);
    }
    const card = slot(await call(CONFIG.core, SEL.cardOf + addressWord(address)), 0);
    if (card !== 0n) fail(`${address} already has player card #${card}. There is one card per Agent ID.`);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        // Pass these three values to `baw contract-call preview` exactly as they are.
        binanceChainId: String(CONFIG.chainId),
        to: CONFIG.core,
        value: '0',
        inputData: SEL.mint,
        // Show this summary to the user before asking for confirmation.
        summary: {
          action: 'Mint a Forecast League player card (no funds are sent)',
          contract: CONFIG.core,
          function: 'mint()',
          valueSent: '0 BNB',
          checkedAddress: address || 'not checked (no --address given)',
          note:
            'One non-transferable card per Agent ID holder. The card has no monetary value. ' +
            'Submitting a forecast mints the card as well, so this step is optional.',
        },
      },
      null,
      2,
    ),
  );
}

async function cmdStatus(args) {
  const out = { ok: true, chainId: CONFIG.chainId };
  const now = await chainTime();
  out.now = new Date(now * 1000).toISOString();
  out.roundLocksAt = new Date(nextLock(now) * 1000).toISOString();
  const live = await currentPrices();
  out.currentPrices = Object.fromEntries(PAIRS.map((p) => [`${p.toUpperCase()}/USD`, formatPrice(live[p])]));

  const address = args.address;
  if (address) {
    const holder = slot(await call(CONFIG.agentId, SEL.balanceOf + addressWord(address)), 0) > 0n;
    out.address = address;
    out.holdsAgentId = holder;
  }

  if (CONFIG.core.toLowerCase() === ZERO) {
    out.league = 'not deployed yet';
  } else if (address) {
    const epoch = slot(await call(CONFIG.core, SEL.currentEpoch), 0);
    const sub = await call(CONFIG.core, SEL.submissionOf + addressWord(address) + word(epoch));
    const submittedAt = slot(sub, 3);
    out.card = Number(slot(await call(CONFIG.core, SEL.cardOf + addressWord(address)), 0)) || null;
    out.submissions = Number(slot(await call(CONFIG.core, SEL.submissionCount + addressWord(address)), 0));
    out.showAgentIdName = slot(await call(CONFIG.core, SEL.showName + addressWord(address)), 0) === 1n;
    out.submittedToday = submittedAt !== 0n;
    if (submittedAt !== 0n) {
      out.todaysForecasts = Object.fromEntries(
        PAIRS.map((p, i) => [`${p.toUpperCase()}/USD`, slot(sub, i) === 0n ? 'skipped' : formatPrice(slot(sub, i))]),
      );
    }
    if (CONFIG.scorer.toLowerCase() !== ZERO) {
      const st = await call(CONFIG.scorer, SEL.statsOf + addressWord(address));
      out.record = {
        scoredDays: Number(slot(st, 0)),
        scoredForecasts: Number(slot(st, 1)),
        betterThanDoingNothing: Number(slot(st, 2)),
        totalScore: Number(signed(slot(st, 3), 256)),
        qualified: slot(await call(CONFIG.scorer, SEL.isQualified + addressWord(address)), 0) === 1n,
      };
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

async function cmdEncodeScore(args) {
  if (CONFIG.scorer.toLowerCase() === ZERO) fail('The scorer contract address is not configured yet.');
  const address = args.address === true ? undefined : args.address;
  if (!address) fail('Give --address <wallet whose forecast should be scored>.');
  const now = await chainTime();
  let epoch;
  if (args.epoch !== undefined && args.epoch !== true) {
    epoch = Number(args.epoch);
    if (!Number.isInteger(epoch) || epoch < 0) fail('--epoch must be a whole number.');
    const sub = await call(CONFIG.core, SEL.submissionOf + addressWord(address) + word(epoch));
    if (slot(sub, 3) === 0n) fail(`${address} made no submission in epoch ${epoch}. There is nothing to score.`);
  } else {
    // The oldest round of the last 7 days that has a submission, is not in the record yet and is
    // final. A round that is not final yet never blocks a later one that is.
    const last = Math.floor(now / 86400) - 1;
    const waiting = [];
    for (let e = last - 6; e <= last; e++) {
      const sub = await call(CONFIG.core, SEL.submissionOf + addressWord(address) + word(e));
      if (slot(sub, 3) === 0n) continue;
      if (slot(await call(CONFIG.scorer, '0xa86c3b41' + addressWord(address) + word(e)), 0) === 1n) continue; // scored(address,uint32)
      try {
        await rpc('eth_call', [{ from: address, to: CONFIG.scorer, data: SEL.score + addressWord(address) + word(e) }, 'latest']);
      } catch {
        waiting.push(e);
        continue;
      }
      epoch = e;
      break;
    }
    if (epoch === undefined) {
      fail(waiting.length
        ? `Nothing to score yet: round(s) ${waiting.join(', ')} of ${address} are not final. A round is final 30 minutes after someone settles it, 06:30 UTC at the earliest.`
        : `${address} has no finished round to score. A forecast submitted today is for the round that locks at 00:00 UTC and can be scored from 06:30 UTC tomorrow.`);
    }
  }
  const inputData = SEL.score + addressWord(address) + word(epoch);
  // Dry run, so a call that would fail is never handed to the wallet.
  try {
    await rpc('eth_call', [{ from: address, to: CONFIG.scorer, data: inputData }, 'latest']);
  } catch (e) {
    const resultAt = new Date(((epoch + 1) * 86400 + 6.5 * 3600) * 1000).toISOString();
    fail(
      `Scoring epoch ${epoch} would fail right now (${e.message}). Either it is already scored, or the round is ` +
        `not final yet. Results are final about 6.5 hours after the lock, around ${resultAt}.`,
    );
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        // Pass these three values to `baw contract-call preview` exactly as they are.
        binanceChainId: String(CONFIG.chainId),
        to: CONFIG.scorer,
        value: '0',
        inputData,
        // Show this summary to the user before asking for confirmation.
        summary: {
          action: 'Write the score of a finished round into the on-chain record (no funds are sent)',
          contract: CONFIG.scorer,
          function: 'score(address agent, uint32 epoch)',
          agent: address,
          epoch,
          valueSent: '0 BNB',
          note: 'Anyone may call this for any address. It only records the result of a forecast that was already submitted.',
        },
      },
      null,
      2,
    ),
  );
}

async function cmdEncodeSquad(args) {
  const address = args.address === true ? undefined : args.address;
  if (!address) fail('Give --address <your wallet>.');
  const create = args.create === true;
  const join = typeof args.join === 'string' ? args.join.toLowerCase().replace(/\.ai$/, '') : undefined;
  if (create === (join !== undefined)) fail('Give exactly one of --create or --join <captain name>.');
  if (slot(await call(CONFIG.agentId, SEL.balanceOf + addressWord(address)), 0) === 0n) {
    fail(`${address} does not hold an Agent ID. Claim one in the Binance App first.`);
  }
  const current = '0x' + (await call(CONFIG.squads, SEL.squadOf + addressWord(address))).slice(26, 66);
  let inputData; let summary;
  if (create) {
    if (slot(await call(CONFIG.squads, SEL.isSquad + addressWord(address)), 0) === 1n) fail(`${address} already has an open squad.`);
    inputData = SEL.createSquad;
    summary = {
      action: 'Open a Forecast League squad named after your Agent ID (no funds are sent)',
      function: 'createSquad()',
      note: 'This makes your Agent ID name public as the squad name. Others join by typing it. ' +
        'A captain cannot leave while the squad has other members.',
    };
  } else {
    if (!/^[a-z0-9]{1,32}$/.test(join)) fail('The captain name may only contain a-z and 0-9, for example "alice" or "alice.ai".');
    const hex = Buffer.from(join, 'utf8').toString('hex');
    const nameData = word(0x20) + word(join.length) + hex.padEnd(Math.ceil(join.length / 32) * 64, '0');
    const captain = '0x' + (await call(CONFIG.agentId, SEL.ownerOfHandle + nameData)).slice(26, 66);
    if (captain === ZERO) fail(`There is no Agent ID named ${join}.ai.`);
    if (slot(await call(CONFIG.squads, SEL.isSquad + addressWord(captain)), 0) === 0n) fail(`${join}.ai has not opened a squad.`);
    if (captain.toLowerCase() === current.toLowerCase()) fail(`${address} is already in the squad of ${join}.ai.`);
    inputData = SEL.joinSquad + nameData;
    summary = {
      action: `Join the Forecast League squad of ${join}.ai (no funds are sent)`,
      function: 'joinSquad(string captainHandle)',
      captain,
      membersNow: Number(slot(await call(CONFIG.squads, SEL.memberCount + addressWord(captain)), 0)),
      note: 'You can move to another squad 7 days after joining this one.',
    };
  }
  // Dry run, so a call that would fail (for example the 7 day cooldown) is never handed to the wallet.
  try {
    await rpc('eth_call', [{ from: address, to: CONFIG.squads, data: inputData }, 'latest']);
  } catch (e) {
    fail(`This call would fail right now (${e.message}). The usual reason is the 7 day wait after joining a squad, ` +
      'or a captain trying to leave a squad that still has members.');
  }
  console.log(JSON.stringify({
    ok: true,
    // Pass these three values to `baw contract-call preview` exactly as they are.
    binanceChainId: String(CONFIG.chainId), to: CONFIG.squads, value: '0', inputData,
    // Show this summary to the user before asking for confirmation.
    summary: { ...summary, contract: CONFIG.squads, valueSent: '0 BNB', currentSquad: current === ZERO ? 'none' : current },
  }, null, 2));
}

// ---------------------------------------------------------------- picking a side
// The helper never suggests a side. It lists up() and down() first with neutral context, asks the
// agent to choose and to write one sentence of reasoning for its human, and lists mint() last.
const TICKET = { up: '0xd5a49e01', down: '0xd8337928', assigned: '0x1249c58b' };
const RESULT_OF = '0xcdd20022'; // resultOf(uint32) -> (uint64 p0, uint64 p1, uint8 outcome, bool finished)
const OUTCOME = ['not settled', 'up', 'down', 'push', 'void'];
const PICK_ASK =
  'Choose the side yourself: up() or down(). Use the context or anything else you trust; this helper does not suggest a side. ' +
  'Write one sentence of reasoning for your human and show it with the preview. ' +
  'mint() is listed last as "assigned side (no view)": the contract picks the side from your address, and it counts as participation, not a forecast.';
const ASSIGNED_WHAT = 'mint(): assigned side (no view). The contract picks the side from your address and round; counts as participation, not a forecast';
const isoMin = (t) => new Date(t * 1000).toISOString().slice(0, 16) + 'Z';

/** The last `n` settled rounds of a market before `round`, with the Chainlink prices at lock (start) and target (end). */
async function lastSettled(market, round, len, n = 3, lookBack = 8) {
  const rounds = [];
  for (let rr = round - 2; rr >= Math.max(0, round - 1 - lookBack); rr--) rounds.push(rr);
  const res = await Promise.all(rounds.map((rr) => call(market, RESULT_OF + word(rr)).then((d) => ({ rr, d }), () => null)));
  const out = [];
  for (const x of res) {
    if (!x || out.length >= n) continue;
    const outcome = Number(slot(x.d, 2));
    if (!outcome) continue; // finished but nobody settled it yet
    const p0 = slot(x.d, 0); const p1 = slot(x.d, 1);
    out.push({
      round: x.rr, lockAt: isoMin((x.rr + 1) * len), resultAt: isoMin((x.rr + 2) * len),
      startPrice: p0 ? formatPrice(p0) : null, endPrice: p1 ? formatPrice(p1) : null, result: OUTCOME[outcome] || String(outcome),
      changePercent: p0 && p1 ? Number(((Number(p1 - p0) * 100) / Number(p0)).toFixed(3)) : null,
    });
  }
  return out;
}

/** Neutral context for one open round. */
async function pickContext(market, round, len, feed, secondsToLock) {
  let settled = []; try { settled = await lastSettled(market, round, len); } catch {}
  return {
    priceNow: feed !== undefined ? formatPrice(feed) : null,
    secondsToLock,
    lastSettled: settled,
    source: 'Chainlink prices (8 decimals) as the contract recorded them: startPrice at the lock, endPrice at the result time. Context only, not a signal.',
  };
}

function parseSide(args) {
  if (args.side === undefined) return undefined;
  if (args.side !== 'up' && args.side !== 'down') fail('--side must be up or down.');
  return args.side;
}

/** --market narrows the picks: a pair (BTC) or a market name ("Blitz BTC 6h"). */
function marketMatches(args, name) {
  if (args.market === undefined || args.market === true) return true;
  const want = String(args.market).toLowerCase();
  const n = name.toLowerCase();
  return n === want || n.split(' ').includes(want);
}

/** --side up|down: just that ticket call for each open round (narrowed by --market). */
function sideOnly(side, picks, args) {
  const chosen = picks.filter((p) => marketMatches(args, p.market));
  const calls = chosen.map((p) => ({ ...p[side], market: p.market, round: p.round, secondsToLock: p.context.secondsToLock }));
  return {
    ok: true, binanceChainId: String(CONFIG.chainId), side,
    // Send these with `baw contract-call preview` and `execute`, exactly as they are. Nothing to send if the list is empty.
    calls,
    reasonForHuman: `Before the preview, tell your human in one sentence why you chose ${side}.`,
    note: calls.length ? 'Every call sends value 0. Preview each one and act on your human\'s yes.' : 'No open round to take a ticket in right now.',
  };
}

async function cmdBlitz(args) {
  if (CONFIG.blitz.toLowerCase() === ZERO) fail('Blitz is not deployed yet.');
  const address = args.address === true ? undefined : args.address;
  if (!address) fail('Give --address <your wallet>.');
  const side = parseSide(args);
  let prices = {}; try { prices = await currentPrices(); } catch {}
  // One market per Chainlink feed. The first one is BTC/USD; the others exist only if their address is filled in.
  const open = [['BTC', CONFIG.blitz], ['ETH', CONFIG.blitzEth], ['BNB', CONFIG.blitzBnb]].filter(([, a]) => a && a.toLowerCase() !== ZERO);
  const markets = [];
  for (const [pair, market] of open) {
    const t = await call(market, '0x624f6da5' + addressWord(address)); // todo(address)
    const r = await call(market, '0xc06ac6a3' + addressWord(address)); // recordOf(address)
    const canMint = slot(t, 1) === 1n; const claimable = Number(slot(t, 2));
    const one = (inputData, what) => ({ to: market, value: '0', inputData, what });
    const round = Number(slot(t, 0)); const secondsToLock = Number(slot(t, 3)); const len = PERIOD['6h'];
    const calls = [];
    let pick;
    if (claimable > 0) calls.push(one('0x4e71d92d', `claim(): write your finished ${pair} rounds into your record`));
    if (canMint) {
      // Your choice first (up, down), then the assigned side for an agent with no view.
      const up = one(TICKET.up, `up(): ticket for "${pair} higher six hours after the lock"`);
      const down = one(TICKET.down, `down(): ticket for "${pair} lower"`);
      const assigned = one(TICKET.assigned, ASSIGNED_WHAT);
      calls.push({ chooseOne: [up, down, assigned] });
      pick = {
        market: pair, contract: market, round,
        question: `Will ${pair}/USD be higher at ${hhmm((round + 2) * len)} (${isoMin((round + 2) * len).slice(0, 10)}) than at the lock, ${hhmm((round + 1) * len)}?`,
        lockAt: isoMin((round + 1) * len), resultAt: isoMin((round + 2) * len),
        context: await pickContext(market, round, len, prices[pair.toLowerCase()], secondsToLock),
        ask: PICK_ASK,
        up, down,
        assigned,
      };
    }
    markets.push({
      pair, contract: market, round, canMint, claimable, secondsToLock,
      ticketsThisRound: Number(slot(t, 4)), earlyLeft: Number(slot(t, 5)),
      record: { tickets: Number(slot(r, 0)), wins: Number(slot(r, 1)), losses: Number(slot(r, 2)), streak: Number(slot(r, 3)), bestStreak: Number(slot(r, 4)), unclaimed: Number(slot(r, 5)) },
      calls,
      ...(pick ? { pick } : {}),
    });
  }
  const picks = markets.filter((m) => m.pick).map((m) => m.pick);
  if (side) { console.log(JSON.stringify(sideOnly(side, picks, args), null, 2)); return; }
  const first = markets[0];
  const out = {
    ok: true, binanceChainId: String(CONFIG.chainId), contract: first.contract,
    round: first.round, canMint: first.canMint, claimable: first.claimable, secondsToLock: first.secondsToLock,
    ticketsThisRound: first.ticketsThisRound, earlyLeft: first.earlyLeft, record: first.record,
    // Picks first: for each open round, choose up() or down() yourself and write one sentence of reasoning for your human.
    howToPick: PICK_ASK,
    picks,
    // Send these with `baw contract-call preview` and `execute`, exactly as they are. Nothing to send if the list is empty.
    calls: markets.flatMap((m) => m.calls),
    note: 'Every call sends value 0. One ticket per market per round; rounds open at 00:00, 06:00, 12:00 and 18:00 UTC.',
  };
  // With more than one market open, each one is listed with its own state; `calls` above holds the calls of all of them.
  if (markets.length > 1) out.markets = markets;
  console.log(JSON.stringify(out, null, 2));
}

// Every free call an address can make now, over all Forecast League contracts, in one read.
// Round markets (Blitz and Rounds): claim finished rounds, then one ticket per open round.
// Badges and Honors: claim what has been earned. Stamps: today's stamp. Houses: join once.
const ROUND_MARKETS = [
  ['Blitz BTC 6h', '0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C'], ['Blitz ETH 6h', '0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1'],
  ['Blitz BNB 6h', '0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9'], ['Rounds BTC 1h', '0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629'],
  ['Rounds ETH 1h', '0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4'], ['Rounds BNB 1h', '0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736'],
  ['Rounds BTC 1d', '0x9e521add6F67EEe0Fe5c0b8ef32cb4543f7af50E'],
];
const EXTRAS = { badges: '0xF706Aeb7E1B6A44139205dF3043bf68cCf386918', stamps: '0x30b6b8C67Ab2239185536ba3766e8cb05BFd18ae',
  houses: '0x8433AD00601C57cE9F144b20A32aE478EEe831AE', honors: '0x3e73bC0309c72EA69bD74CaDEC943668291Ca6ed' };

const PERIOD = { '6h': 21600, '1h': 3600, '1d': 86400 };
const SITE = 'https://mycyi1994-hash.github.io/forecast-league';
const hhmm = (t) => new Date(t * 1000).toISOString().slice(11, 16) + ' UTC';
const HONOR_NAMES = ['SEASON ONE', 'CARD HOLDER', 'FIRST WIN', 'FIVE WINS', 'STREAK 3', 'STREAK 5'];

// One run of the league: what to send now, what is waiting, when to come back and what to tell your human.
// Default scope: claims on every market you hold tickets in, new tickets in the three 6h markets, daily extras.
// --full also takes tickets in the hourly and daily markets (only with your human's yes for that).
async function buildAll(args) {
  const address = args.address === true ? undefined : args.address;
  if (!address) fail('Give --address <your wallet>.');
  parseSide(args);
  const full = Boolean(args.full);
  const w = addressWord(address);
  const now = Math.floor(Date.now() / 1000);
  const one = (to, inputData, what) => ({ to, value: '0', inputData, what });
  const claims = []; const tickets = []; const extras = []; const markets = []; const waiting = []; const picks = [];
  let wins = 0; let losses = 0; let held = 0; let bestStreak = 0; let nextOpen = null;
  let prices = {}; try { prices = await currentPrices(); } catch {}
  const sixRounds = new Map(); // 6h round number -> held a ticket in at least one 6h market
  for (const [name, market] of ROUND_MARKETS) {
    const len = PERIOD[name.split(' ').pop()];
    const inScope = full || len === PERIOD['6h'];
    let t; let r; try { [t, r] = await Promise.all([call(market, '0x624f6da5' + w), call(market, '0xc06ac6a3' + w)]); } catch { continue; }
    const round = Number(slot(t, 0)); const canMint = slot(t, 1) === 1n; const claimable = Number(slot(t, 2)); const secondsToLock = Number(slot(t, 3));
    const rec = { tickets: Number(slot(r, 0)), wins: Number(slot(r, 1)), losses: Number(slot(r, 2)), streak: Number(slot(r, 3)), best: Number(slot(r, 4)), unclaimed: Number(slot(r, 5)) };
    wins += rec.wins; losses += rec.losses; held += rec.tickets; bestStreak = Math.max(bestStreak, rec.streak);
    // Tickets of this round and the one before: their result times are what to come back for.
    // For 6h markets, look back further: the play streak counts consecutive 6h rounds with a ticket.
    const back = len === PERIOD['6h'] ? 12 : 1;
    for (let rr = round; rr >= round - back; rr--) {
      let side = 0; try { side = Number(slot(await call(market, '0xc53b35c8' + w + BigInt(rr).toString(16).padStart(64, '0')), 0)); } catch {}
      if (side && len === PERIOD['6h']) sixRounds.set(rr, true);
      const resultAt = (rr + 2) * len;
      if (side && resultAt > now && rr >= round - 1) waiting.push({ market: name, side: side === 1 ? 'up' : 'down', resultAt, resultAtUTC: new Date(resultAt * 1000).toISOString().slice(0, 16) + 'Z' });
      if (!side && rr < round && len === PERIOD['6h'] && !sixRounds.has(rr)) { /* keep looking in the other 6h markets */ }
    }
    markets.push({ market: name, contract: market, round, canMint, claimable, secondsToLock, record: rec, inScope });
    if (claimable > 0) claims.push(one(market, '0x4e71d92d', `claim(): ${claimable} finished ${name} ticket(s) into your record`));
    if (inScope && canMint && secondsToLock > 60) {
      const pair = name.split(' ')[1]; const feed = prices[pair.toLowerCase()];
      const lockAt = (round + 1) * len; const resultAt = (round + 2) * len;
      picks.push({
        market: name, to: market, value: '0', round,
        question: `Will ${pair}/USD be higher at ${hhmm(resultAt)} (${new Date(resultAt * 1000).toISOString().slice(0, 10)}) than at the lock, ${hhmm(lockAt)}?`,
        priceNow: feed !== undefined ? formatPrice(feed) : null, lockAt: new Date(lockAt * 1000).toISOString().slice(0, 16) + 'Z', resultAt: new Date(resultAt * 1000).toISOString().slice(0, 16) + 'Z',
        context: await pickContext(market, round, len, feed, secondsToLock),
        ask: PICK_ASK,
        up: TICKET.up, down: TICKET.down,
        how: 'Decide the side yourself from what you know of the market (recent moves, news, your own model) and keep a one-line reason. Send up() or down(), and show the reason to your human with the preview. mint() (0x1249c58b) takes a side the contract assigns from your address instead; use it only if you have no view.',
        // The same as full calls: your choice first, then the assigned side for an agent with no view.
        choose: [one(market, TICKET.up, `up(): ticket for "${pair} higher at ${hhmm(resultAt)} than at the lock"`), one(market, TICKET.down, `down(): ticket for "${pair} lower"`)],
        assigned: one(market, TICKET.assigned, ASSIGNED_WHAT),
      });
      tickets.push({ to: market, value: '0', inputData: null, chooseOne: { up: '0xd5a49e01', down: '0xd8337928' }, what: `${name} ticket: pick up() or down() yourself (see picks[]); send no ticket rather than guess blindly` });
    }
    if (inScope && len !== PERIOD['1d']) { const open = (round + 1) * len; if (!nextOpen || open < nextOpen) nextOpen = open; }
  }
  const progress = {}; const unlocked = [];
  try { const b = await call(EXTRAS.badges, '0x624f6da5' + w); const tier = Number(slot(b, 3));
    if (slot(b, 2) === 1n) { extras.push(one(EXTRAS.badges, '0x4e71d92d', `claim(): badge tier ${tier}`)); unlocked.push(`Badge tier ${tier} (1 call)`); }
    else if (tier) progress.badge = `${Number(slot(b, 0))}/${[0, 3, 10, 30][tier]} tickets to badge tier ${tier}`; } catch {}
  try { const s = await call(EXTRAS.stamps, '0x624f6da5' + w); progress.stampStreak = Number(slot(s, 2));
    if (slot(s, 1) === 1n) extras.push(one(EXTRAS.stamps, '0x183ff085', `checkIn(): today's stamp, streak becomes ${Number(slot(s, 2))}`)); } catch {}
  try { const h = await call(EXTRAS.houses, '0x624f6da5' + w); if (slot(h, 1) === 1n) extras.push(one(EXTRAS.houses, '0xb688a363', 'join(): your house, fixed by your address')); } catch {}
  try { const o = await call(EXTRAS.honors, '0x624f6da5' + w); const n = Number(slot(o, 0)); const mask = Number(slot(o, 1));
    if (n > 0) { const names = HONOR_NAMES.filter((_, k) => mask & (1 << k)); extras.push(one(EXTRAS.honors, '0x4e71d92d', `claim(): honor ${names.join(', ')}`)); unlocked.push(`Honor ${names.join(', ')} (1 call)`); } } catch {}
  // Health: is there gas for the next run, and did the routine miss rounds it could have played?
  const health = {};
  try { const bal = Number(BigInt(await rpc('eth_getBalance', [address, 'latest']))) / 1e18; health.bnb = Number(bal.toFixed(6));
    health.gas = bal < 0.0003 ? 'LOW: under 0.0003 BNB, the next run may fail. Tell your human once.' : 'ok'; } catch {}
  const sixH = markets.filter((m) => m.inScope && PERIOD[m.market.split(' ').pop()] === PERIOD['6h']);
  const missed = sixH.filter((m) => m.record.tickets > 0 && m.canMint && m.secondsToLock < PERIOD['6h'] / 2).length;
  health.routine = held === 0 ? 'first run' : missed ? `${missed} open 6h round(s) still without your ticket and past half time: if you meant to run every 6 hours, check that your routine is scheduled (see routineLine)` : 'ok';
  // Play streak: consecutive 6h rounds, up to now, in which this wallet took at least one 6h ticket.
  const curSix = Math.floor(now / PERIOD['6h']);
  let playStreak = 0; let r6 = sixRounds.has(curSix) ? curSix : curSix - 1;
  while (sixRounds.has(r6)) { playStreak++; r6--; }
  const streakBreaksAt = (sixRounds.has(curSix) ? curSix + 2 : curSix + 1) * PERIOD['6h'];
  const streak = { rounds: playStreak, breaksAtUTC: new Date(streakBreaksAt * 1000).toISOString().slice(0, 16) + 'Z',
    rule: 'Consecutive 6h rounds with at least one 6h ticket. Missing a whole round resets it to 0. Look-back is 12 rounds (3 days).' };
  const decided = wins + losses;
  progress.decided = `${decided} decided ticket(s) in your record`;
  if (decided) progress.winRate = `${Math.round((100 * wins) / decided)}% (${wins} won, ${losses} lost)`;
  waiting.sort((x, y) => x.resultAt - y.resultAt);
  // When to come back: the first result you can claim, or else the next 6h round.
  const firstResult = waiting.length ? waiting[0].resultAt : null;
  let next;
  if (firstResult && (!nextOpen || firstResult <= nextOpen + 3600)) next = { at: new Date(firstResult * 1000).toISOString().slice(0, 16) + 'Z', why: `${waiting[0].market} result is final: claim it, then take the new tickets` };
  else if (nextOpen) next = { at: new Date(nextOpen * 1000).toISOString().slice(0, 16) + 'Z', why: nextOpen % PERIOD['6h'] ? 'new hourly round opens: one ticket per hourly market' : 'new 6h round opens: one ticket per market' };
  const calls = [...claims, ...extras];
  const firstRun = held === 0;
  const record = `${SITE}/me.html?w=${address}`;
  const routineLine = full ? `Every hour until 9 Dec 2026 (only after my human said yes to the hourly markets): run Forecast League per ${SITE}/skill.md (node league.mjs all --full --address ${address}), preview each listed value-0 call and send it, within my human's daily limit.` : `Every 6 hours until 9 Dec 2026 (only after my human said yes to this routine): run Forecast League per ${SITE}/skill.md (node league.mjs all --address ${address}), preview each listed value-0 call and send it, at most 14 calls per run.`;
  // A regular of the 6h routine (3+ decided tickets) who has not taken the hourly markets: offer them once.
  // Only an offer: the hourly tickets are taken only with --full, after the human's yes.
  const hourlyHeld = markets.filter((m) => PERIOD[m.market.split(' ').pop()] === PERIOD['1h']).reduce((n, m) => n + m.record.tickets, 0);
  const hourlyOffer = !full && decided >= 3 && hourlyHeld === 0 ? {
    ask: 'Optional, ask your human once and remember the answer: also take the hourly BTC, ETH and BNB tickets?',
    what: 'Up to 72 more value-0 calls a day (3 markets x 24 rounds), each under $0.01 in gas. Same rules: you pick up() or down() with a reason, or skip a round.',
    ifYes: `Run every hour instead of every 6 hours: node league.mjs all --full --address ${address}. Ask your human for a daily call limit if they want one.`,
    ifNo: 'Keep the 6h routine. Do not ask again.',
  } : undefined;
  const lines = [];
  lines.push(calls.length || picks.length ? `Forecast League: ${picks.length} pick(s) to make (I choose up or down and tell you why) and ${calls.length} other free call(s), value 0, gas only.` : 'Forecast League: nothing to send right now.');
  if (playStreak) lines.push(`Streak: ${playStreak} six-hour round(s) in a row. The next round to keep it closes at ${hhmm(streakBreaksAt)}; missing it resets the streak.`);
  if (claims.length) lines.push(`Results are waiting in ${claims.length} market(s): the claim() calls write them into your record as wins or losses.`);
  if (waiting.length) lines.push('Open tickets: ' + waiting.map((x) => `${x.market} ${x.side.toUpperCase()}, result ${hhmm(x.resultAt)}`).join('; ') + '.');
  lines.push(decided ? `Record: ${wins} won, ${losses} lost${unlocked.length ? '; ready to claim: ' + unlocked.join(', ') : ''}.` : 'No decided ticket in your record yet: results count only after a claim() once the round is final.');
  if (next) lines.push(`I need to run again at ${next.at.slice(11, 16)} UTC (${next.why}). Should I do this every 6 hours until 9 Dec? At most 14 value-0 calls per run, gas under $0.02 each. Say stop anytime.`);
  if (hourlyOffer) lines.push('Optional: I could also take the hourly BTC, ETH and BNB tickets (up to 72 more value-0 calls a day, under $0.01 gas each). Only if you say yes; you can set a daily limit.');
  lines.push(`Record: ${record}`);
  const winsTotal = wins; const streakNow = bestStreak;
  const shareLine = decided ? `Forecast League on BNB Chain: ${wins} won / ${losses} lost (${Math.round((100 * wins) / decided)}%), current best streak ${streakNow}. Record: ${record}` : `Playing Forecast League on BNB Chain (free Agent ID rounds, settled by Chainlink). Record: ${record}`;
  return ({
    ok: true, binanceChainId: String(CONFIG.chainId), address, scope: full ? 'full' : 'default (6h markets + daily extras)',
    // Send these in order with `baw contract-call preview` and `execute`, exactly as they are, within your human's limits.
    // Picks first: decide each side yourself, then send up() or down(). Then the calls below.
    picks,
    calls,
    next,
    streak,
    waiting,
    unlocked,
    progress,
    health,
    firstRun: firstRun ? 'Nothing to claim on a first run is normal: a 6h ticket has its result 6 to 12 hours after you take it. Come back at "next".' : undefined,
    reportToHuman: lines.join('\n'),
    routineLine,
    hourlyOffer,
    markets,
    shareLine,
    // Optional: the official Binance square-post skill can publish shareLine to Binance Square. Each post needs the
    // human's yes and their own Square OpenAPI key (that skill asks for it); never post without both.
    squarePost: decided ? {
      ask: 'Optional, ask before each post: share this record on Binance Square?',
      text: `${shareLine} Free up/down rounds for Binance Agent ID wallets, value 0, settled by Chainlink (a hackathon entry; no prize, no reward). #AgentID #BNBChain`,
      how: 'With the official square-post skill (binance/binance-skills-hub, skills/binance/square-post), from its folder: node scripts/post-text.mjs --text "<text>". Only after your human said yes to this post.',
    } : undefined,
    note: 'Every call sends value 0. Skipping any of them costs nothing. Preview each one and act on your human\'s yes.',
  });
}
async function cmdAll(args) {
  const side = parseSide(args);
  const res = await buildAll(args);
  if (side) {
    // In `all`, picks[].up and .down hold the selector (unchanged shape); the full calls are in choose[].
    const picks = res.picks.map((p) => ({ ...p, up: p.choose[0], down: p.choose[1] }));
    console.log(JSON.stringify(sideOnly(side, picks, args), null, 2));
    return;
  }
  console.log(JSON.stringify(res, null, 2));
}



// ---------------------------------------------------------------- Agent ID Mint Desk
const DESK = SITE + '/desk/projects.json';
async function rawCall(from, to, data) {
  const res = await rpcRaw('eth_call', [{ ...(from ? { from } : {}), to, data, value: '0x0' }, 'latest']);
  return res;
}
async function rpcRaw(method, params) {
  for (const url of CONFIG.rpcs || [CONFIG.rpc]) {
    try { const r = await (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
      if (r.result !== undefined) return { ok: true, v: r.result }; if (r.error) return { ok: false, e: r.error }; } catch {}
  }
  return { ok: false, e: { message: 'rpc unavailable' } };
}
const revertText = (e) => { const d = typeof e?.data === 'string' ? e.data : e?.data?.data; if (d && d.startsWith('0x08c379a0')) { try { const l = parseInt(d.slice(74, 138), 16); return Buffer.from(d.slice(138, 138 + l * 2), 'hex').toString('utf8'); } catch {} } return (e?.message || 'reverted').replace(/^execution reverted:?\s*/, '') || 'reverted'; };
async function loadDesk() { try { return await (await fetch(DESK, { signal: AbortSignal.timeout(30000) })).json(); } catch { return null; } }

// check: one contract, simulated from your own wallet.
async function cmdCheck(args) {
  const to = (args._[1] || args.contract || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(to)) fail('Give the contract: node league.mjs check 0x… [--address <your wallet>] [--data 0x…]');
  const from = args.address === true ? undefined : args.address;
  const desk = await loadDesk(); const listed = desk?.projects?.find((p) => p.contract === to);
  const data = args.data && args.data !== true ? args.data : listed?.mint?.inputData || '0x1249c58b';
  const [code, sim, plain, own, impl] = await Promise.all([rpcRaw('eth_getCode', [to, 'latest']), rawCall(from, to, data), rawCall('0x000000000000000000000000000000000000dEaD', to, data), rawCall(undefined, to, '0x8da5cb5b'), rpcRaw('eth_getStorageAt', [to, '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc', 'latest'])]);
  let sourcify = null; try { const r = await fetch(`https://sourcify.dev/server/v2/contract/56/${to}`, { signal: AbortSignal.timeout(15000) }); sourcify = r.status === 200 ? true : r.status === 404 ? false : null; } catch {}
  const owner = own.ok && own.v?.length >= 66 && !/^0x0*$/.test(own.v) ? '0x' + own.v.slice(-40) : null;
  const warnings = [];
  if (!code.ok || code.v === '0x') warnings.push('no contract code');
  if (!sim.ok) warnings.push(`value-0 simulation ${from ? 'from your wallet ' : ''}reverts: ${revertText(sim.e)}`);
  if (plain.ok) warnings.push('a wallet without Agent ID can call it too (gate not enforced for this call)');
  if (impl.ok && !/^0x0*$/.test(impl.v)) warnings.push('upgradeable proxy: rules can change');
  if (owner) warnings.push(`has an owner (${owner}) with admin powers`);
  if (sourcify === false) warnings.push('source not verified on Sourcify');
  console.log(JSON.stringify({ ok: true, contract: to, inputData: data, simulatedFrom: from || 'no sender', verdict: sim.ok && !warnings.length ? 'passed' : sim.ok ? 'callable_with_warnings' : 'would_fail', warnings,
    desk: listed ? { status: listed.status, rank: listed.rank, checkedAt: listed.checkedAt } : 'not listed on the desk', note: 'Simulation at one block, not an audit. Preview in your own wallet before sending; skip on any value, outgoing token, approval or risk flag.' }, null, 2));
}

// daily: your Forecast League to-do plus every desk mint that passed all checks and still simulates from your wallet.
async function cmdDaily(args) {
  const address = args.address === true ? undefined : args.address;
  if (!address) fail('Give --address <your wallet>.');
  const league = await buildAll(args);
  const desk = await loadDesk();
  // Other projects' mints are listed only with --desk: each is another project's contract and needs its own confirmation.
  const picks = args.desk ? (desk?.projects || []).filter((p) => p.status === 'free_live' && !p.warnings.length && !p.builder).slice(0, Number(args.limit) || 30) : [];
  const live = [];
  for (let i = 0; i < picks.length; i += 6) {
    const part = await Promise.all(picks.slice(i, i + 6).map(async (p) => ({ p, r: await rawCall(address, p.contract, p.mint.inputData) })));
    for (const { p, r } of part) if (r.ok) live.push({ to: p.contract, value: '0', inputData: p.mint.inputData, what: `${p.name}: another project's free Agent ID mint (desk rank ${p.rank}, all checks passed). Needs its own confirmation from your human.` });
  }
  const leagueCalls = league.calls; const all = [...leagueCalls, ...live];
  console.log(JSON.stringify({
    ok: true, binanceChainId: '56', address,
    calls: all, counts: { forecastLeague: leagueCalls.length, otherCheckedMints: live.length, deskCheckedAt: desk?.updated || null },
    next: league.next, waiting: league.waiting, unlocked: league.unlocked, progress: league.progress, health: league.health,
    routineLine: league.routineLine,
    shareLine: `${league.shareLine} · Today: ${all.length} free calls checked by Agent ID Mint Desk (${SITE}/desk/).`,
    reportToHuman: `${all.length} free value-0 calls today: ${leagueCalls.length} Forecast League, ${live.length} other Agent ID mints that passed the desk checks and simulate from this wallet.\n${league.reportToHuman}`,
    note: 'Forecast League calls first; with --desk, other projects\' checked mints follow by desk rank (daily rotation). Preview every call and execute only after your human\'s confirmation; a routine instruction covers only the Forecast League calls it names. Simulations are heuristics, not an audit.',
  }, null, 2));
}

function isMainModule() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
const isMain = isMainModule();
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  try {
    if (command === 'encode') await cmdEncode(args);
    else if (command === 'encode-mint') await cmdEncodeMint(args);
    else if (command === 'encode-score') await cmdEncodeScore(args);
    else if (command === 'encode-squad') await cmdEncodeSquad(args);
    else if (command === 'blitz') await cmdBlitz(args);
    else if (command === 'all') await cmdAll(args);
    else if (command === 'check') await cmdCheck(args);
    else if (command === 'daily') await cmdDaily(args);
    else if (command === 'status') await cmdStatus(args);
    else {
      console.log(
        [
          'Usage:',
          '  node league.mjs all --address 0xYourAgenticWallet [--full] [--side up|down [--market BTC]]  (this run: picks, calls, next time, report for your human)',
          '  node league.mjs daily --address 0xYourAgenticWallet [--desk]  (league calls; --desk adds other projects\' checked free mints)',
          '  node league.mjs check 0xContract [--address 0xYourAgenticWallet]  (simulate one mint from your wallet)',
          '  node league.mjs status [--address 0xYourAgenticWallet]',
          '  node league.mjs encode [--btc <price>] [--eth <price>] [--bnb <price>] --show-name yes|no',
          '  node league.mjs encode-mint [--address 0xYourAgenticWallet]',
          '  node league.mjs encode-score --address 0xYourAgenticWallet [--epoch <number>]',
          '  node league.mjs encode-squad --address 0xYourAgenticWallet (--create | --join <captain name>)',
          '  node league.mjs blitz --address 0xYourAgenticWallet [--side up|down [--market BTC]]',
        ].join('\n'),
      );
      process.exit(command ? 1 : 0);
    }
  } catch (e) {
    fail(e.message || String(e));
  }
}
