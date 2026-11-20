// Slow-network walk (Task 686). Usage: node walk.cjs <baseUrl> <outJson> [throttle=1|0]
// Needs e2e/.secrets/state.json (git-ignored) and the e2e playwright install. Fake data / dev Medplum only.
const path = require('path');
const root = path.resolve(__dirname, '../../..');
const { chromium } = require(path.join(root, 'node_modules/playwright-core'));
const fs = require('fs');
const [base, out, thr = '1'] = process.argv.slice(2);
const state = path.join(root, 'e2e/.secrets/state.json');
const SLOW = { offline: false, latency: 400, downloadThroughput: 50000, uploadThroughput: 50000 }; // ~400 kbps
const FAST = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
const cookie = JSON.parse(fs.readFileSync(state, 'utf8')).cookies.map(c => c.name + '=' + c.value).join('; ');
const api = async (p) => (await fetch(base + p, { headers: { cookie } })).json();
(async () => {
  const pts = (await api('/api/patients?limit=5')).patients;
  const pid = pts[0].id;
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const net = (o) => cdp.send('Network.emulateNetworkConditions', o);
  const results = [];
  const text = () => page.evaluate(() => document.body.innerText || '').catch(() => '');
  async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Date.now() - t0; await page.waitForTimeout(250); } return null; }
  async function load(name, url, ready, extra) {
    await cdp.send('Network.setCacheDisabled',{cacheDisabled:true}); await net(thr === '1' ? SLOW : FAST);
    const r = { name, url };
    const t0 = Date.now();
    try { await page.goto(base + url, { waitUntil: 'commit', timeout: 120000 }); } catch (e) { r.gotoError = String(e).slice(0, 100); }
    // ready = last time the page text changed before it stayed stable for 4 s with no loading marker and the marker regex present
    let last = '', lastChange = Date.now(), ms = null; const lim = Date.now() + 100000;
    while (Date.now() < lim) {
      const t = await text(); if (t !== last) { last = t; lastChange = Date.now(); }
      if (Date.now() - lastChange > 4000 && ready.test(t) && !/Loading|Memuatkan|Fetching/i.test(t)) { ms = lastChange - t0; break; }
      await page.waitForTimeout(300);
    }
    r.readyMs = ms; r.totalMs = Date.now() - t0;
    const t = await text(); r.textLen = t.length; r.blank = t.trim().length < 40;
    r.snippet = t.replace(/\s+/g, ' ').slice(0, 160);
    if (extra) { try { Object.assign(r, await extra(r)); } catch (e) { r.extraError = String(e).slice(0, 160); } }
    await net(thr === '1' ? SLOW : FAST);
    results.push(r); console.log(JSON.stringify(r));
  }
  await load('dashboard', '/dashboard', /Live clinic queue[\s\S]*(Waiting|Arrived|No patients|queue)/i);
  await load('patients', '/patients', /Name[\s\S]*NRIC/, async () => {
    const o = {};
    const input = page.getByPlaceholder('Search patients...');
    await net({ ...SLOW, offline: true });
    await input.fill('Review');
    await page.waitForTimeout(6000);
    const t = await text();
    o.offlineSearchView = t.replace(/\s+/g, ' ').slice(-200);
    o.typedKept = (await input.inputValue()) === 'Review';
    o.hasRetry = await page.getByRole('button', { name: /retry/i }).count() > 0;
    await net(SLOW);
    o.recoveredMs = await until(async () => /Review\d* Fake/.test(await text()), 30000);
    // hang test: stall responses (no reply) for search
    await page.route('**/api/patients?search=*', () => {});
    await input.fill('Fake');
    const hung = await until(async () => /timed out|error|fail|retry/i.test(await text()), 40000);
    o.hungSearchResolvedMs = hung; o.hungSearchView = (await text()).replace(/\s+/g, ' ').slice(-160);
    await page.unroute('**/api/patients?search=*');
    return o;
  });
  await load('profile', `/patients/${pid}`, /Fake[\s\S]*(Consultation|Overview|History|Documents)/i);
  await load('billing', '/orders', /Billing & Documents[\s\S]*(Paid|Unpaid|No |Open checkout)/i);
  await load('inventory', '/inventory', /Paracetamol|Add (Medication|Item)|No medications/i);
  await load('analytics', '/analytics', /Analytics[\s\S]*(Summary|Ringkasan|Pesakit|Revenue|Hasil)/i);
  await load('records', '/records', /./);
  await load('settings-documents', '/settings/documents', /Medical Certificate|Template/i);
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
