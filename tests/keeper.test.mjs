// Offline test of keeper/claimsummary.mjs on fixture files in a temp folder. No network.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const dir = mkdtempSync(join(tmpdir(), 'fl-'));
mkdirSync(join(dir, 'docs/api/wallet'), { recursive: true }); mkdirSync(join(dir, 'docs/.well-known'), { recursive: true });
const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), BUILDER = '0x2a2f48145780639dbd91e748df157f35283165da';
const claim = (market, n) => ({ type: 'claim', market, contract: '0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C', inputData: '0x4e71d92d', finishedTickets: n });
writeFileSync(join(dir, `docs/api/wallet/${A}.json`), JSON.stringify({ wallet: A, claims: [claim('BTC 6h', 13),
  { type: 'checkIn', contract: '0x30b6b8C67Ab2239185536ba3766e8cb05BFd18ae', inputData: '0x183ff085' },
  { type: 'join', contract: '0x8433AD00601C57cE9F144b20A32aE478EEe831AE', inputData: '0xb688a363' }] }));
writeFileSync(join(dir, `docs/api/wallet/${B}.json`), JSON.stringify({ wallet: B, claims: [] }));
writeFileSync(join(dir, `docs/api/wallet/${BUILDER}.json`), JSON.stringify({ wallet: BUILDER, claims: [claim('BTC 6h', 5)] }));
writeFileSync(join(dir, 'docs/api/wallet/index.json'), '{}');
writeFileSync(join(dir, 'docs/api/state'), JSON.stringify({ project: 'x' }));
writeFileSync(join(dir, 'docs/deployment.json'), JSON.stringify({ project: 'x' }));
writeFileSync(join(dir, 'docs/agent.md'), '# t\n\n<!-- live -->\n## OPEN NOW\n<!-- /live -->\n\nrest\n');
const run = () => execFileSync(process.execPath, [new URL('../keeper/claimsummary.mjs', import.meta.url).pathname], { cwd: dir }).toString();
run(); run(); // twice: the agent.md line must not repeat
const c = JSON.parse(readFileSync(join(dir, 'docs/api/claims.json'), 'utf8'));
assert.equal(c.wallets, 1, 'builder and empty wallets are left out');
assert.equal(c.finishedTickets, 13);
assert.equal(c.claimCalls, 2, '13 finished tickets need two claim() calls (12 per call)');
assert.equal(c.extraCalls, 2);
assert.deepEqual(c.perExtra, { 'Stamps checkIn()': 1, 'Houses join()': 1 });
assert.equal(JSON.parse(readFileSync(join(dir, 'docs/api/state'), 'utf8')).claimsWaiting.wallets, 1);
assert.equal(readFileSync(join(dir, 'docs/deployment.json'), 'utf8'), readFileSync(join(dir, 'docs/.well-known/agent.json'), 'utf8'));
const md = readFileSync(join(dir, 'docs/agent.md'), 'utf8');
assert.equal(md.split('Results waiting').length - 1, 1, 'one line only');
assert.ok(md.indexOf('Results waiting') < md.indexOf('<!-- /live -->'));
console.log('keeper test ok');
