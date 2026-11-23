const { chromium } = require('playwright');
const OUT = process.argv[2];
(async () => {
  const proxy = process.env.HTTPS_PROXY;
  const b = await chromium.launch({ proxy: proxy ? { server: proxy, bypass: 'localhost,127.0.0.1' } : undefined });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } }, ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  const B = 'http://localhost:8765/';
  const cap = async (text) => p.evaluate((t) => {
    let d = document.getElementById('__cap'); if (!d) { d = document.createElement('div'); d.id = '__cap';
      d.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;background:rgba(11,14,17,.92);color:#fff;border:1px solid #f0b90b;border-radius:12px;padding:10px 18px;font:600 20px -apple-system,Segoe UI,Inter,sans-serif;max-width:1100px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.5)'; document.body.appendChild(d); }
    d.textContent = t; }, text);
  const wait = (ms) => p.waitForTimeout(ms);
  const scroll = async (y, steps = 30, ms = 40) => { for (let i = 0; i < steps; i++) { await p.mouse.wheel(0, y / steps); await wait(ms); } };
  // 1. title
  await p.goto(B + '_demo/title.html'); await wait(4000);
  // 2. homepage hero
  await p.goto(B, { waitUntil: 'networkidle' }); await wait(1500);
  await cap('Free up/down rounds on BTC, ETH and BNB. Only Binance Agent ID wallets. Every call is value 0.'); await wait(4500);
  await cap("Agents' own picks vs a coin-flip control (mint() assigns the side): read from the contracts, hourly"); await wait(4000);
  await p.evaluate(() => document.getElementById('open').scrollIntoView({ block: 'start' })); await wait(300); await cap('Open rounds: live ASCII price tiles, close countdown, and when the result comes back'); await wait(5000);
  // 3. agent session
  await p.goto(B + '_demo/session.html'); await cap('The agent picks a side with a reason; the human sees the preview and says yes'); await wait(15500);
  await cap('Then it tells the human when to come back: results count only after claim()'); await wait(3500);
  // 4. findings + last round
  await p.goto(B, { waitUntil: 'networkidle' }); await wait(1200);
  await p.evaluate(() => document.getElementById('results').scrollIntoView({ block: 'start' })); await wait(400);
  await cap('Every round settles from Chainlink prices; picked tickets are scored apart from assigned ones'); await wait(4500);
  await p.evaluate(() => document.getElementById('findings').scrollIntoView({ block: 'start' })); await wait(300); await cap('Per market, with 95% intervals. Small sample, shown honestly: not evidence of a trading edge'); await wait(5000);
  // 5. record page
  await p.goto(B + 'me.html?w=0xd301d472f2e469a1aafa1af6f214e312f1858873', { waitUntil: 'networkidle' }).catch(() => {}); await wait(1500);
  await cap('Every Agent ID gets a public, Chainlink-settled record any contract can read (recordOf)'); await wait(5000);
  // 6. judges
  await p.goto(B + 'judges.html', { waitUntil: 'networkidle' }); await wait(2000);
  await p.evaluate(() => document.getElementById('compliance').scrollIntoView({ block: 'start' })); await wait(500);
  await cap('No owner, no proxy, no QR or pairing, no secrets, no prize. The human confirms every call.'); await wait(5000);
  await p.evaluate(() => document.getElementById('quality').scrollIntoView({ block: 'start' })); await wait(500);
  await cap('Usage counted the way an analyst would: Agent ID senders only, repeat days, lockstep groups disclosed'); await wait(5500);
  // 7. end
  await p.goto(B + '_demo/end.html'); await wait(5000);
  await ctx.close(); await b.close();
})();
