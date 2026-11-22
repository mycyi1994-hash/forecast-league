#!/usr/bin/env node
// Forecast League MCP server (stdio, no dependencies). Read-only: it reads BNB Chain and the public feeds,
// and returns value-0 calls for the agent to preview and send with its own wallet (e.g. `baw contract-call
// preview`). It never signs, holds keys or sends anything.
//
// Claude Desktop / Claude Code / Cursor config:
//   { "mcpServers": { "forecast-league": { "command": "node", "args": ["/path/to/forecast-league/mcp/server.mjs"] } } }
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import readline from 'node:readline';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HELPER = path.join(HERE, '..', 'skills', 'forecast-league', 'scripts', 'league.mjs');
const PAPER = path.join(HERE, '..', 'skills', 'forecast-league', 'scripts', 'paper.py');
const SITE = 'https://mycyi1994-hash.github.io/forecast-league';
const ADDR = { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'BNB Chain wallet address (holds a Binance Agent ID)' };
const NOTE = 'Forecast League: free BTC/ETH/BNB up/down rounds for Binance Agent ID wallets on BNB Chain. Every call is value 0; Chainlink settles; no owner, no tokens, no prize. Built as a Binance Agent ID Hackathon entry. Preview every call and send only with your human\'s yes.';

const TOOLS = [
  { name: 'forecast_league_plan', description: 'Everything this wallet can do now in Forecast League: tickets to pick (up or down, with context), claims, daily extras, when to come back, and a short report for the human. Returns calls (to, value 0, inputData) to preview and send.',
    inputSchema: { type: 'object', properties: { address: ADDR, full: { type: 'boolean', description: 'also the hourly and daily markets (only with the human\'s yes)' } }, required: ['address'] } },
  { name: 'forecast_league_open_rounds', description: 'Rounds open right now in all seven markets, with lock times and tickets so far (public feed, refreshed hourly).',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'forecast_league_record', description: 'A wallet\'s claims waiting, joined rounds and pending results (public per-wallet feed).',
    inputSchema: { type: 'object', properties: { address: ADDR }, required: ['address'] } },
  { name: 'forecast_league_findings', description: 'Do AI agents call the market better than a coin flip? Picked vs assigned hit rates with 95% intervals, read from the contracts.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'forecast_league_paper_report', description: 'Hit rate of a wallet over recent rounds read from the chain, with a 95% interval (paper mode for binance-prediction-updown hooks). Needs python3.',
    inputSchema: { type: 'object', properties: { address: ADDR, days: { type: 'number', default: 7 }, markets: { type: 'string', default: 'btc-1h,eth-1h,bnb-1h' } }, required: ['address'] } },
];

function run(cmd, args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: '', err: String(e) }); });
  });
}
async function getJson(url) {
  const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Math.floor(Date.now() / 60000), { signal: AbortSignal.timeout(20000) });
  if (r.status === 404) return { found: false, note: 'No file for this address: it has not played yet.' };
  return r.json();
}
const okAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);

async function callTool(name, a = {}) {
  if (name === 'forecast_league_plan') {
    if (!okAddr(a.address)) throw new Error('address must be 0x followed by 40 hex characters');
    const r = await run(process.execPath, [HELPER, 'all', '--address', a.address, ...(a.full ? ['--full'] : [])]);
    return r.out || JSON.stringify({ ok: false, error: r.err.slice(0, 500) });
  }
  if (name === 'forecast_league_open_rounds') return JSON.stringify(await getJson(`${SITE}/api/state`));
  if (name === 'forecast_league_record') {
    if (!okAddr(a.address)) throw new Error('address must be 0x followed by 40 hex characters');
    return JSON.stringify(await getJson(`${SITE}/api/wallet/${a.address.toLowerCase()}.json`));
  }
  if (name === 'forecast_league_findings') return JSON.stringify(await getJson(`${SITE}/api/findings.json`));
  if (name === 'forecast_league_paper_report') {
    if (!okAddr(a.address)) throw new Error('address must be 0x followed by 40 hex characters');
    const days = Number.isFinite(Number(a.days)) ? String(Math.min(Math.max(Number(a.days), 0.1), 30)) : '7';
    const markets = typeof a.markets === 'string' && /^[a-z0-9,-]{1,80}$/.test(a.markets) ? a.markets : 'btc-1h,eth-1h,bnb-1h';
    const r = await run('python3', [PAPER, 'report', '--address', a.address, '--days', days, '--markets', markets]);
    return r.out || JSON.stringify({ ok: false, error: r.err.slice(0, 500) });
  }
  throw new Error('unknown tool ' + name);
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return; // notifications
  try {
    if (m.method === 'initialize') {
      return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} },
        serverInfo: { name: 'forecast-league', version: '1.8.1' }, instructions: NOTE } });
    }
    if (m.method === 'ping') return send({ jsonrpc: '2.0', id: m.id, result: {} });
    if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: TOOLS } });
    if (m.method === 'tools/call') {
      try {
        const text = await callTool(m.params?.name, m.params?.arguments || {});
        return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text }] } });
      } catch (e) {
        return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: String(e.message || e) }], isError: true } });
      }
    }
    send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'method not found' } });
  } catch (e) {
    send({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: String(e.message || e) } });
  }
});
