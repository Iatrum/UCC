// Normal-network warm-run load bench (Task 686). Usage: node bench.cjs <baseUrl> <mcPatientId> <runs>
// "usable" = the element a user needs is visible (not just the shell). 1 cold-ish warm-up run is discarded.
const path = require('path');
const root = path.resolve(__dirname, '../../..');
const { chromium } = require(path.join(root, 'node_modules/playwright-core'));
const [base, mcPid, runs = '6'] = process.argv.slice(2);
const cases = [
  ['appointments', '/appointments', (p) => p.getByText('Loading appointments...').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {})],
  ['patients list', '/patients', (p) => p.getByRole('cell').first().waitFor({ timeout: 60000 })],
  ['analytics', '/analytics', (p) => p.getByText('Ringkasan').first().waitFor({ timeout: 60000 }).then(() => p.waitForFunction(() => document.querySelectorAll('svg').length > 3, null, { timeout: 60000 }))],
  ['settings/documents', '/settings/documents', (p) => p.locator('textarea').first().waitFor({ timeout: 60000 })],
  ['patient documents tab', `/patients/${mcPid}`, async (p) => { for (let i = 0; i < 8; i++) { await p.getByRole('tab', { name: 'Documents', exact: true }).click(); if (await p.getByText('Generated Documents').first().isVisible().catch(() => false)) return; await p.waitForTimeout(500); } }],
];
(async () => {
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ storageState: path.join(root, 'e2e/.secrets/state.json'), viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  for (const [name, url, ready] of cases) {
    const ts = [];
    for (let i = 0; i <= Number(runs); i++) {
      const t0 = Date.now();
      await page.goto(base + url, { waitUntil: 'commit' });
      await ready(page).catch(() => {});
      if (i > 0) ts.push(Date.now() - t0);
    }
    ts.sort((a, b) => a - b);
    console.log(JSON.stringify({ name, medianMs: ts[Math.floor(ts.length / 2)], runs: ts }));
  }
  await browser.close();
})();
