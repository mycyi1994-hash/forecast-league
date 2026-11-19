// Writes test/fixtures/cards.json: inputs and the expected SVG for each, from card.cjs.
const fs = require('fs');
const path = require('path');
const { card } = require('./card.cjs');

const counts = [0, 1, 2, 3, 7, 8, 14, 15, 40];
const ids = [1, 100, 101, 999, 1000, 12345];
// unnamed, then 3, 9, 10, 13, 14, 17, 18 and 20 characters (the font size changes at 9/13/17)
const handles = ['', 'abc', 'ninechars', 'tencharsxx', 'thirteenchars', 'fourteencharsx', 'seventeencharsabc', 'eighteencharsabcde', 'twentycharacters2026'];
// 16 generated addresses whose last byte covers every palette index twice, plus one real holder
const addresses = ['0x2a2F48145780639dbD91e748dF157F35283165Da'];
let seed = 0x1234567;
const next = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 16) & 0xff; };
for (let k = 0; k < 16; k++) {
  let hex = '';
  for (let i = 0; i < 19; i++) hex += next().toString(16).padStart(2, '0');
  hex += ((next() & 0xf8) | (k % 8)).toString(16).padStart(2, '0');
  addresses.push('0x' + hex);
}
// two extremes for the chart: all steps up, all steps down
addresses.push('0x' + '2c'.repeat(19) + '00', '0x' + '00'.repeat(19) + '07');

const items = [];
let n = 0;
for (const count of counts) for (const handle of handles) {
  const address = addresses[n % addresses.length], id = ids[(n + Math.floor(n / ids.length)) % ids.length];
  items.push({ address, id, handle, count, svg: card({ address, id, handle, count }) });
  n++;
}
handles.forEach((h, i) => { if (h.length !== [0, 3, 9, 10, 13, 14, 17, 18, 20][i]) throw new Error('handle length'); });
const dir = path.join(__dirname, '..', 'test', 'fixtures');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'cards.json'), JSON.stringify(items));
const pal = new Set(items.map(x => parseInt(x.address.slice(-2), 16) % 8));
console.log('wrote', items.length, 'fixtures;', addresses.length, 'addresses; palettes', [...pal].sort().join(','), '; ids', [...new Set(items.map(x => x.id))].join(','));
