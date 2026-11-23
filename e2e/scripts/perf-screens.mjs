// Task 791: per-screen in-app load times against a production build. Fake data only.
// usage: UCC_PASSWORD=... node perf-screens.mjs <baseUrl> <patientId> <consultationId> [runs]
import { chromium } from '@playwright/test';
const [base, pid, cid, runsArg] = process.argv.slice(2);
const runs = Number(runsArg || 3);
const pw = process.env.UCC_PASSWORD;
const screens = [
  ['dashboard', '/dashboard', 'h1:has-text("Dashboard")'],
  ['patients list', '/patients', 'table tbody tr'],
  ['patient profile', `/patients/${pid}`, 'h1'],
  ['consultation open', `/consultations/${cid}`, 'text=/Consultation|Chief complaint|Sign/i'],
  ['lab tab', `/patients/${pid}/labs-imaging`, 'h1:has-text("Labs")'],
  ['billing/orders', '/orders', 'h1:has-text("Billing")'],
  ['checkout', `/orders/checkout/${cid}`, 'text=/Checkout|Payment|Total/i'],
  ['inventory', '/inventory', 'main table tbody tr, main :text("Inventory")'],
  ['appointments', '/appointments', 'h1:has-text("Appointments")'],
  ['analytics', '/analytics', 'h1:has-text("Analytics")'],
];
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const r = await ctx.request.post(`${base}/api/auth/login`, { data: { email: 'doctor@ucc.local', password: pw } });
if (!r.ok()) throw new Error('login ' + r.status());
const page = await ctx.newPage();
const out = {};
for (const [name, path, marker] of screens) {
  const times = [], idle = []; let cold = 0;
  for (let i = 0; i < runs + 1; i++) { // first run = cold warm-up, discarded
    const t0 = Date.now();
    await page.goto(base + path, { waitUntil: 'commit' });
    await page.locator(marker).first().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('.animate-pulse, [aria-busy="true"]'), null, { timeout: 30000 });
    const t1 = Date.now();
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    const t2 = Date.now();
    if (i === 0) cold = t1 - t0;
    if (i > 0) { times.push(t1 - t0); idle.push(t2 - t0 - 500); }
  }
  out[name] = { visibleMs: median(times), settledMs: median(idle), coldMs: cold, runs: times };
  console.log(name.padEnd(18), 'visible', median(times), 'settled', median(idle), 'first', cold, JSON.stringify(times));
}
await browser.close();
