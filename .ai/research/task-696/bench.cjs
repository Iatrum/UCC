// Task 696 warm-run browser bench. Usage: node bench.cjs <baseUrl> <patientId> <runs> [only]
// usable = element the user needs is visible; LCP via PerformanceObserver; 1 discarded warm-up + N warm runs; median reported.
const path = require('path');
const root = path.resolve(__dirname, '../../..');
const { chromium } = require(path.join(root, 'node_modules/playwright-core'));
const [base, pid, runs = '8', only] = process.argv.slice(2);
const T = 60000;
const lcpInit = () => { window.__lcp = 0; try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {} };
const docsReady = async (p) => { // usable = both lists finished loading (no spinner text) and the uploaded-files empty/list state is shown
  await p.getByRole('tab', { name: 'Documents', exact: true }).click({ timeout: T });
  await p.getByText('Generated Documents').first().waitFor({ timeout: T });
  await p.waitForFunction(() => { const t = document.body.innerText; return !/Loading uploaded files|Loading documents|Checking for older referral|Loading\.\.\./.test(t) && /No uploaded files yet|File\s+Uploaded/.test(t); }, null, { timeout: T });
};
const cases = {
  'patient profile (from queue)': { start: async (p) => { await p.goto(base + '/dashboard', { waitUntil: 'load' }); await p.locator(`a[href="/patients/${pid}"]`).first().waitFor({ timeout: T }); await p.waitForTimeout(400); }, go: (p) => p.locator(`a[href="/patients/${pid}"]`).first().click(), ready: (p) => p.getByRole('tab', { name: 'Consultation History' }).waitFor({ timeout: T }), softNav: true },
  'patient profile (hard load)': { go: (p) => p.goto(base + `/patients/${pid}`, { waitUntil: 'commit' }), ready: (p) => p.getByRole('tab', { name: 'Consultation History' }).waitFor({ timeout: T }) },
  'patient documents tab': { go: (p) => p.goto(base + `/patients/${pid}`, { waitUntil: 'commit' }), ready: docsReady },
  'inventory list': { go: (p) => p.goto(base + '/inventory', { waitUntil: 'commit' }), ready: (p) => p.getByText('Paracetamol').first().waitFor({ timeout: T }) },
  'appointments': { go: (p) => p.goto(base + '/appointments', { waitUntil: 'commit' }), ready: (p) => p.getByText('Loading appointments...').waitFor({ state: 'detached', timeout: T }).catch(() => {}).then(() => p.getByText('Fake follow-up').first().waitFor({ timeout: T })) },
};
(async () => {
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ storageState: path.join(root, 'e2e/.secrets/state.json'), viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(lcpInit);
  const page = await ctx.newPage();
  for (const [name, c] of Object.entries(cases)) {
    if (only && !name.includes(only)) continue;
    const ts = [], lcps = [], reqs = [], kb = [];
    for (let i = 0; i <= Number(runs); i++) {
      if (c.start) await c.start(page);
      let n = 0; const onReq = () => n++; page.on('request', onReq);
      const t0 = Date.now();
      await c.go(page);
      await c.ready(page).catch(() => {});
      const dt = Date.now() - t0;
      await page.waitForTimeout(300);
      page.off('request', onReq);
      const lcp = await page.evaluate(() => Math.round(window.__lcp)).catch(() => 0);
      const bytes = await page.evaluate(() => Math.round(performance.getEntriesByType('resource').reduce((a, e) => a + (e.transferSize || 0), 0) / 1024)).catch(() => 0);
      if (i > 0) { ts.push(dt); lcps.push(c.softNav ? null : lcp); reqs.push(n); kb.push(bytes); }
    }
    const med = (a) => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
    console.log(JSON.stringify({ name, usableMedianMs: med(ts), lcpMedianMs: med(lcps), requestsMedian: med(reqs), transferKbMedian: med(kb), usableRuns: [...ts].sort((a, b) => a - b) }));
  }
  await browser.close();
})();
