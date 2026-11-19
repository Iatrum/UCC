// Task 710 warm-run browser bench (Playwright Chromium, prod build, dev Medplum, fake data).
// Usage: node bench.cjs <baseUrl> <samples> [onlyCaseSubstring]   -> one JSON line per case with raw samples.
// usable = first meaningful content (the data the user came for) visible; LCP via PerformanceObserver;
// requests = all browser requests; api = subset hitting /api/* or the Medplum origin. 1 discarded warm-up run per case.
const path = require('path');
const root = path.resolve(__dirname, '../../..');
const { chromium } = require(path.join(root, 'node_modules/playwright-core'));
const [base, runs = '8', only] = process.argv.slice(2);
const T = 60000;
const lcpInit = () => { window.__lcp = 0; try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {} };
const txt = (re) => (p) => p.waitForFunction((s) => new RegExp(s).test((document.querySelector('main') || document.body).innerText), re.source, { timeout: T });
const cases = {
  patients: { url: '/patients', ready: async (p) => { await txt(/Total Patients\s*[\d,]{2,}/)(p); await p.locator('table tbody a[href^="/patients/"]').first().waitFor({ timeout: T }); } },
  appointments: { url: '/appointments', ready: async (p) => { await txt(/Patient\s+Date\s+Time/)(p); await p.waitForFunction(() => !/Loading appointments/.test(document.body.innerText), null, { timeout: T }); } },
  analytics: { url: '/analytics', ready: txt(/KONSULTASI\s*[\d,]+/) },
  orders: { url: '/orders', ready: txt(/Ready to bill/) },
  settings: { url: '/settings', ready: txt(/Signed in as:\s*doctor@ucc\.local/) },
};
(async () => {
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ storageState: path.join(root, 'e2e/.secrets/state.json'), viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(lcpInit);
  const page = await ctx.newPage();
  // Diagnostic only: BLOCK_RSC=1 aborts Next <Link> prefetch (_rsc) requests to measure their contention cost.
  if (process.env.BLOCK_RSC) await ctx.route(/[?&]_rsc=/, (r) => r.abort());
  const origin = new URL(base).origin;
  for (const [name, c] of Object.entries(cases)) {
    if (only && !name.includes(only)) continue;
    const out = { name, usable: [], lcp: [], req: [], api: [], kb: [] };
    for (let i = 0; i <= Number(runs); i++) {
      let n = 0, a = 0;
      const onReq = (r) => { n++; const u = r.url(); if (u.startsWith(origin + '/api/') || u.includes(':8113')) a++; };
      page.on('request', onReq);
      const t0 = Date.now();
      await page.goto(base + c.url, { waitUntil: 'commit' });
      await c.ready(page).catch(() => {});
      const dt = Date.now() - t0;
      await page.waitForTimeout(800); // let trailing requests land so counts are complete
      page.off('request', onReq);
      const lcp = await page.evaluate(() => Math.round(window.__lcp)).catch(() => 0);
      const kb = await page.evaluate(() => Math.round(performance.getEntriesByType('resource').reduce((s, e) => s + (e.transferSize || 0), 0) / 1024)).catch(() => 0);
      if (i > 0) { out.usable.push(dt); out.lcp.push(lcp); out.req.push(n); out.api.push(a); out.kb.push(kb); }
    }
    console.log(JSON.stringify(out));
  }
  await browser.close();
})();
