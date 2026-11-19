// Reference implementation of the Forecast League player card.
// Integer maths only. `src/CardArt.sol` must return exactly the same string for the same inputs;
// `test/CardArt.t.sol` checks that against `test/fixtures/cards.json` (written by fixtures.cjs).
//
//   node art/card.cjs <address> <id> <handle or ""> <count>   prints one card as SVG
//   node art/constants.cjs                                    rewrites src/CardArtConstants.sol and src/CardArtData.sol
//   node art/fixtures.cjs                                     rewrites test/fixtures/cards.json
const PAL = [
  ['0B1026', '1D3FA8', '4F8CFF', '8DF3FF'], ['160A2E', '5B1FA8', 'B36BFF', 'FF9EF5'],
  ['05231B', '0B7A55', '2EE6A0', 'C8FF7A'], ['2A0808', 'A81F2D', 'FF5A5A', 'FFC46B'],
  ['071F2A', '0B6E86', '2FD9E6', 'F7EE7A'], ['1F1203', 'A8650B', 'FFAE2E', 'FFF39A'],
  ['0F1020', '3B3F8F', '8E97FF', 'E6E9FF'], ['24061C', 'A80B7A', 'FF4DB0', 'FFD1EC'],
];
const TIER = [
  { n: 'ROOKIE', m: ['5E3612', 'D99A62', '8C5A2B', 'F0C39A', '4E2C0E'], f: 14, r: 74, bo: '.45', glow: '', hl: '.55', ped: '.25' },
  { n: 'ANALYST', m: ['4E535C', 'F1F4F8', '8A909C', 'FFFFFF', '3F444C'], f: 17, r: 88, bo: '.7', glow: '.3', hl: '1', ped: '.6' },
  { n: 'STRATEGIST', m: ['6B4E08', 'FFE27A', 'B8860B', 'FFF6C2', '5A4106'], f: 21, r: 98, bo: '.9', glow: '.42', hl: '1', ped: '.6' },
  { n: 'ORACLE', m: ['46E6FF', 'B77DFF', 'FF8EEA', 'FFF06A', '6CFFB0'], f: 24, r: 100, bo: '1', glow: '.55', hl: '1', ped: '.6' },
];
const MIN = [0, 3, 8, 15]; // forecasts needed for each tier
const SPARK = [[86, 150, 9], [418, 120, 11], [392, 300, 7], [104, 286, 8], [330, 76, 6], [150, 96, 7], [440, 210, 6], [66, 216, 6], [96, 352, 5], [404, 352, 5]];
const NSPARK = [0, 3, 6, 10];
const RINGS = [[156, 40, -16], [150, 36, 22], [178, 20, -3]]; // rx%, ry% of the orb radius, rotation
const f1 = n => (Math.round(n * 10) / 10).toString();
const div = (a, b) => Math.trunc(a / b);

// ---- per-tier constant strings (pasted into the contract) ----
function tierConst(ti) {
  const t = TIER[ti], r = t.r, cx = 250, cy = 296 - r;
  let back = '', front = '';
  for (let k = 0; k < ti; k++) {
    const rx = div(r * RINGS[k][0], 100), ry = div(r * RINGS[k][1], 100), d = RINGS[k][2];
    const a = (d * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    back += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${d} ${cx} ${cy})" fill="none" stroke="url(#r)" stroke-width="4" stroke-opacity=".5"/>`;
    const sx = f1(cx + rx * 0.5 * c + ry * 0.86 * s), sy = f1(cy + rx * 0.5 * s + ry * 0.86 * c);
    front += `<path d="M${f1(cx - rx * c)} ${f1(cy - rx * s)}A${rx} ${ry} ${d} 0 0 ${f1(cx + rx * c)} ${f1(cy + rx * s)}" fill="none" stroke="url(#r)" stroke-width="5" stroke-linecap="round"/>` +
      `<circle cx="${sx}" cy="${sy}" r="9" fill="#fff" filter="url(#b3)"/><circle cx="${sx}" cy="${sy}" r="5.5" fill="#fff"/>`;
  }
  let rays = '';
  if (ti >= 2) for (let i = 0; i < 12; i++) {
    const a0 = ((i * 30 - 5) * Math.PI) / 180, a1 = ((i * 30 + 5) * Math.PI) / 180;
    rays += `M${cx} ${cy}L${f1(cx + 330 * Math.cos(a0))} ${f1(cy + 330 * Math.sin(a0))}L${f1(cx + 330 * Math.cos(a1))} ${f1(cy + 330 * Math.sin(a1))}Z`;
  }
  return { back, front, rays };
}
function sparkStr(from, to) {
  let s = '';
  for (let i = from; i < to; i++) {
    const [x, y, z] = SPARK[i];
    s += `<path d="M${x} ${y - z}Q${x} ${y} ${x + z} ${y}Q${x} ${y} ${x} ${y + z}Q${x} ${y} ${x - z} ${y}Q${x} ${y} ${x} ${y - z}Z" fill="#fff"><animate attributeName="opacity" values="1;.2;1" dur="${2 + (i % 3)}s" repeatCount="indefinite"/></path>`;
  }
  return s;
}
const TC = [0, 1, 2, 3].map(tierConst);
const SP = [sparkStr(0, 3), sparkStr(3, 6), sparkStr(6, 10)];

function pad4(id) { return id >= 1000 ? String(id) : ('000' + id).slice(-4); }
function stops(M, offs) { return M.map((c, i) => `<stop offset="${offs[i]}" stop-color="#${c}"/>`).join(''); }

function card({ address, id, handle, count }) {
  const b = Buffer.from(address.slice(2), 'hex');
  const [A, B, C, D] = PAL[b[19] % 8];
  const ti = count >= MIN[3] ? 3 : count >= MIN[2] ? 2 : count >= MIN[1] ? 1 : 0;
  const t = TIER[ti], M = t.m, r = t.r, f = t.f, cy = 296 - r;
  const u = n => String(n);
  // chart
  let y = cy + div(r * 42, 100); const top = cy - div(r * 55, 100), bot = cy + div(r * 55, 100);
  const x0 = 250 - div(r * 72, 100), step = div(r, 6); let line = '', lx = 0, ly = 0;
  for (let i = 0; i < 10; i++) {
    y -= div(((b[i] % 45) - 16) * r, 110); if (y < top) y = top; if (y > bot) y = bot;
    lx = x0 + i * step; ly = y; line += (i ? ' ' : '') + lx + ',' + ly;
  }
  const prog = ti === 3 ? 150 : div((count - MIN[ti]) * 150, MIN[ti + 1] - MIN[ti]);
  const num = '#' + pad4(id), named = handle.length > 0, hl = handle.length;
  const size = !named ? 36 : hl <= 9 ? 44 : hl <= 13 ? 36 : hl <= 17 ? 29 : 24;
  const plain = named ? handle + '.ai' : 'AGENT ' + num;
  const rich = named ? `${handle}<tspan fill="#${D}">.ai</tspan>` : plain;
  const w = 500 - 2 * f, rr = 40 - div(f * 6, 10), pw = 58 + ti * 10, g = div(f, 2) + 6, e = 500 - f;
  const hx = 250 - div(r * 34, 100), hy = cy - div(r * 54, 100), kx = 250 + div(r * 38, 100), ky = cy + div(r * 60, 100);

  const defs = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500"><defs>` +
    `<linearGradient id="m" x1="0" y1="0" x2="1" y2="1">${stops(M, ['0', '.28', '.5', '.72', '1'])}</linearGradient>` +
    `<linearGradient id="p" x1="0" y1="0" x2="1" y2="0">${stops([M[0], M[3], M[2], M[1], M[4]], ['0', '.22', '.5', '.8', '1'])}</linearGradient>` +
    `<linearGradient id="v" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></linearGradient>` +
    `<linearGradient id="w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".75"/><stop offset=".5" stop-color="#000" stop-opacity=".2"/><stop offset="1" stop-color="#fff" stop-opacity=".55"/></linearGradient>` +
    `<radialGradient id="o" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".16" stop-color="#${D}"/><stop offset=".5" stop-color="#${B}"/><stop offset="1" stop-color="#${A}"/></radialGradient>` +
    `<radialGradient id="s"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".7"/></radialGradient>` +
    `<radialGradient id="j" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="#${D}"/><stop offset="1" stop-color="#${B}"/></radialGradient>` +
    `<linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#${C}" stop-opacity=".2"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#${D}" stop-opacity=".25"/></linearGradient>` +
    `<linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#${D}"/></linearGradient>` +
    `<filter id="b1" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="44"/></filter>` +
    `<filter id="b2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter>` +
    `<filter id="b3" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>` +
    `<clipPath id="c"><circle cx="250" cy="${u(cy)}" r="${u(r - 3)}"/></clipPath>` +
    `<clipPath id="k"><rect x="${u(f)}" y="${u(f)}" width="${u(w)}" height="${u(w)}" rx="${u(rr)}"/></clipPath></defs>`;

  let gems = '';
  if (ti >= 2) for (const [gx, gy] of [[g, g], [500 - g, g], [g, 500 - g], [500 - g, 500 - g]])
    gems += `<circle cx="${u(gx)}" cy="${u(gy)}" r="${u(ti + 5)}" fill="url(#j)" stroke="#000" stroke-opacity=".45"/><circle cx="${u(gx - 2)}" cy="${u(gy - 2)}" r="2" fill="#fff" fill-opacity=".9"/>`;

  const field = `<rect width="500" height="500" rx="40" fill="url(#m)"/>` +
    `<rect x="2" y="2" width="496" height="496" rx="38" fill="none" stroke="url(#v)" stroke-width="4"/>` +
    `<g clip-path="url(#k)"><rect width="500" height="500" fill="#06060B"/>` +
    `<g filter="url(#b1)" opacity="${t.bo}"><circle cx="110" cy="90" r="130" fill="#${B}"/><circle cx="420" cy="180" r="110" fill="#${C}" fill-opacity=".7"/><circle cx="250" cy="480" r="150" fill="#${B}" fill-opacity=".85"/>` +
    (ti === 3 ? `<circle cx="250" cy="${u(cy)}" r="120" fill="#${D}" fill-opacity=".55"/>` : '') + `</g>` +
    (ti >= 2 ? `<path d="${TC[ti].rays}" fill="#fff" fill-opacity="${ti === 3 ? '.1' : '.06'}">` + (ti === 3 ? `<animateTransform attributeName="transform" type="rotate" from="0 250 ${u(cy)}" to="360 250 ${u(cy)}" dur="60s" repeatCount="indefinite"/>` : '') + `</path>` : '') +
    `<rect width="500" height="500" fill="url(#s)" fill-opacity=".55"/>` +
    (ti >= 1 ? SP[0] : '') + (ti >= 2 ? SP[1] : '') + (ti >= 3 ? SP[2] : '') + `</g>` +
    `<rect x="${u(f)}" y="${u(f)}" width="${u(w)}" height="${u(w)}" rx="${u(rr)}" fill="none" stroke="url(#w)" stroke-width="5"/>` + gems;

  const pedestal = `<ellipse cx="250" cy="336" rx="${u(pw + 34)}" ry="14" fill="#000" fill-opacity=".6" filter="url(#b2)"/>` +
    (ti >= 2 ? `<path d="M${u(232 - pw)} 322v10a${u(pw + 18)} 13 0 0 0 ${u(2 * pw + 36)} 0v-10z" fill="url(#p)"/><ellipse cx="250" cy="322" rx="${u(pw + 18)}" ry="13" fill="url(#m)"/>` : '') +
    `<path d="M${u(250 - pw)} 300v${ti >= 2 ? '22' : '26'}a${u(pw)} 12 0 0 0 ${u(2 * pw)} 0v-${ti >= 2 ? '22' : '26'}z" fill="url(#p)"/>` +
    `<ellipse cx="250" cy="300" rx="${u(pw)}" ry="12" fill="url(#m)"/><ellipse cx="250" cy="300" rx="${u(pw - 12)}" ry="8" fill="#000" fill-opacity=".45"/>` +
    `<ellipse cx="250" cy="300" rx="${u(pw - 16)}" ry="6" fill="#${D}" fill-opacity="${t.ped}" filter="url(#b3)"/>`;

  const orb = TC[ti].back +
    (ti > 0 ? `<circle cx="250" cy="${u(cy)}" r="${u(r + 10 + ti * 4)}" fill="#${D}" fill-opacity="${t.glow}" filter="url(#b2)"/>` : '') +
    `<circle cx="250" cy="${u(cy)}" r="${u(r)}" fill="url(#o)"/>` +
    `<g clip-path="url(#c)"><polyline points="${line}" fill="none" stroke="#fff" stroke-width="9" stroke-opacity=".5" stroke-linecap="round" stroke-linejoin="round" filter="url(#b3)"/>` +
    `<polyline points="${line}" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g>` +
    `<circle cx="250" cy="${u(cy)}" r="${u(r)}" fill="url(#s)"/>` +
    `<circle cx="${u(lx)}" cy="${u(ly)}" r="5" fill="#fff"><animate attributeName="r" values="4;8;4" dur="2s" repeatCount="indefinite"/></circle>` +
    `<ellipse cx="${u(hx)}" cy="${u(hy)}" rx="${u(div(r, 2))}" ry="${u(div(r * 26, 100))}" transform="rotate(-24 ${u(hx)} ${u(hy)})" fill="url(#h)" fill-opacity="${t.hl}"/>` +
    `<ellipse cx="${u(kx)}" cy="${u(ky)}" rx="${u(div(r * 3, 10))}" ry="${u(div(r * 12, 100))}" transform="rotate(-30 ${u(kx)} ${u(ky)})" fill="#${D}" fill-opacity=".3" filter="url(#b3)"/>` +
    `<circle cx="250" cy="${u(cy)}" r="${u(r - 1)}" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="2"/>` +
    TC[ti].front +
    (ti === 3 ? `<ellipse cx="250" cy="${u(cy - r - 12)}" rx="42" ry="9" fill="none" stroke="#FFF2A8" stroke-width="7" filter="url(#b3)"/><ellipse cx="250" cy="${u(cy - r - 12)}" rx="42" ry="9" fill="none" stroke="#fff" stroke-width="3"/>` : '');

  let shadow = '';
  for (const [d, col, op] of [[5, A, ' fill-opacity=".6"'], [4, A, ''], [3, B, ''], [2, B, '']])
    shadow += `<text x="250" y="${u(438 + d)}" text-anchor="middle" fill="#${col}"${op} font-size="${u(size)}">${plain}</text>`;

  const text = `<g font-family="Arial,Helvetica,sans-serif" font-weight="bold">` +
    `<text x="${u(f + 24)}" y="${u(f + 40)}" fill="#fff" fill-opacity=".8" font-size="14" letter-spacing="5">FORECAST LEAGUE</text>` +
    `<rect x="${u(e - 112)}" y="${u(f + 19)}" width="88" height="32" rx="16" fill="#000" fill-opacity=".5"/><rect x="${u(e - 112)}" y="${u(f + 17)}" width="88" height="32" rx="16" fill="url(#m)"/><rect x="${u(e - 109)}" y="${u(f + 19)}" width="82" height="13" rx="7" fill="#fff" fill-opacity=".3"/>` +
    `<text x="${u(e - 68)}" y="${u(f + 39)}" text-anchor="middle" fill="#14100A" font-size="16">${num}</text>` +
    (id <= 100 ? `<text x="${u(f + 24)}" y="${u(f + 62)}" fill="#FFD95A" font-size="11" letter-spacing="4">GENESIS</text>` : '') +
    `<rect x="160" y="357" width="180" height="34" rx="17" fill="#000" fill-opacity=".55"/><rect x="162" y="354" width="176" height="34" rx="17" fill="url(#m)"/><rect x="166" y="357" width="168" height="14" rx="7" fill="#fff" fill-opacity=".32"/>` +
    `<text x="250" y="377" text-anchor="middle" fill="#14100A" font-size="15" letter-spacing="4">${t.n}</text>` +
    shadow +
    `<text x="250" y="438" text-anchor="middle" fill="url(#t)" font-size="${u(size)}">${rich}</text>` +
    `<text x="${u(f + 24)}" y="${u(e - 18)}" fill="#fff" fill-opacity=".7" font-size="12" letter-spacing="2">FORECASTS ${u(count)}</text></g>` +
    `<rect x="${u(e - 178)}" y="${u(e - 29)}" width="154" height="12" rx="6" fill="#000" fill-opacity=".6"/>` +
    (prog > 0 ? `<rect x="${u(e - 176)}" y="${u(e - 27)}" width="${u(prog)}" height="8" rx="4" fill="url(#m)"/>` : '') + `</svg>`;

  return defs + field + pedestal + orb + text;
}
module.exports = { card, TC, SP, PAL, TIER, MIN, stops };
if (require.main === module) {
  const [address, id, handle, count] = process.argv.slice(2);
  if (!address) { console.error('usage: node art/card.cjs <address> <id> <handle or ""> <count>'); process.exit(1); }
  process.stdout.write(card({ address, id: Number(id || 1), handle: handle || '', count: Number(count || 0) }));
}
