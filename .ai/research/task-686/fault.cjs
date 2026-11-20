// Fault injection (Task 686). Usage: node fault.cjs <baseUrl> <patientIdWithMC> [out.json]
// Each case: throttled ~400 kbps / 400 ms RTT, then a stalled-request case (route never answers) and an offline blip.
const path = require('path'), fs = require('fs');
const root = path.resolve(__dirname, '../../..');
const { chromium } = require(path.join(root, 'node_modules/playwright-core'));
const [base, mcPid, out = '/tmp/fault.json'] = process.argv.slice(2);
const SLOW = { offline: false, latency: 400, downloadThroughput: 50000, uploadThroughput: 50000 };
(async () => {
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  const results = [];
  const rec = (r) => { results.push(r); console.log(JSON.stringify(r)); };
  async function fresh() {
    const ctx = await browser.newContext({ storageState: path.join(root, 'e2e/.secrets/state.json'), viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    const net = (o) => cdp.send('Network.emulateNetworkConditions', o);
    await net(SLOW);
    const text = () => page.evaluate(() => document.body.innerText || '').catch(() => '');
    const until = async (re, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await text())) return Date.now() - t0; await page.waitForTimeout(250); } return null; };
    return { ctx, page, net, text, until };
  }
  // 1. patients: stalled search
  { const { ctx, page, text, until } = await fresh();
    await page.goto(base + '/patients', { waitUntil: 'commit', timeout: 120000 });
    await until(/Slow686|Review\d+ Fake|Fake \d+/, 90000);
    await page.route('**/api/patients?search=*', () => {});
    await page.getByPlaceholder('Search patients...').fill('Fake');
    const ms = await until(/timed out|Network error|Failed to|Retry/i, 45000);
    const t = (await text()).replace(/\s+/g, ' ');
    rec({ case: 'patients: stalled search', errorShownMs: ms, retryButton: await page.getByRole('button', { name: /retry/i }).count() > 0, rowsStillVisible: /Slow686|Review\d+ Fake/.test(t), tail: t.slice(-120) });
    await ctx.close(); }
  // 2. patients: offline blip during search then back online
  { const { ctx, page, net, text, until } = await fresh();
    await page.goto(base + '/patients', { waitUntil: 'commit', timeout: 120000 });
    await until(/Slow686|Review\d+ Fake|Fake \d+/, 90000);
    await net({ ...SLOW, offline: true });
    const input = page.getByPlaceholder('Search patients...');
    await input.fill('Slow686');
    await page.waitForTimeout(5000);
    const t1 = (await text()).replace(/\s+/g, ' ');
    const retry = page.getByRole('button', { name: /retry/i });
    const hadRetry = await retry.count() > 0;
    await net(SLOW);
    if (hadRetry) await retry.first().click();
    const rec1 = await until(/Slow686 Fake/, 40000);
    rec({ case: 'patients: offline blip during search', typedKept: (await input.inputValue()) === 'Slow686', rowsVisibleOffline: /Review\d+ Fake|Slow686|Fake \d+/.test(t1) && /NRIC/.test(t1), retryButton: hadRetry, recoveredAfterOnlineMs: rec1, offlineTail: t1.slice(-110) });
    await ctx.close(); }
  // 3. analytics: tab load stalled / offline
  { const { ctx, page, net, text, until } = await fresh();
    await page.goto(base + '/analytics', { waitUntil: 'commit', timeout: 120000 });
    await until(/Analytics[\s\S]{0,400}(Klinikal|Hasil|Operasi)/i, 90000);
    await page.route('**/api/analytics/*', () => {});
    const tabs = page.getByRole('tab'); const n = await tabs.count();
    for (let i = 0; i < 8 && (await tabs.nth(1).getAttribute('aria-selected')) !== 'true'; i++) { await tabs.nth(1).click(); await page.waitForTimeout(2500); }
    const ms = await until(/tamat masa|Gagal|Cuba lagi|timed out/i, 40000);
    rec({ case: 'analytics: stalled tab request', tabs: n, tabName: await tabs.nth(1).innerText(), errorShownMs: ms, tail: (await text()).replace(/\s+/g, ' ').slice(-120) });
    await page.unroute('**/api/analytics/*');
    await net({ ...SLOW, offline: true });
    for (let i = 0; i < 8 && (await tabs.nth(2).getAttribute('aria-selected')) !== 'true'; i++) { await tabs.nth(2).click(); await page.waitForTimeout(1500); }
    const ms2 = await until(/Gagal|Cuba lagi|Tiada sambungan|Failed to fetch/i, 20000);
    const t2 = (await text()).replace(/\s+/g, ' ');
    await net(SLOW);
    const retry = page.getByRole('button', { name: /Cuba lagi/ });
    if (await retry.count()) await retry.first().click();
    await page.waitForTimeout(800); const ms3 = await until(/^(?![\s\S]*(Cuba lagi|Failed to fetch))[\s\S]+$/, 40000);
    rec({ case: 'analytics: offline blip on tab', errorShownMs: ms2, retryVisible: /Cuba lagi/.test(t2), message: t2.slice(-90), recoveredAfterRetryMs: ms3 });
    await ctx.close(); }
  // 4. documents/MC viewer on patient profile: stalled template fetch
  { const { ctx, page, net, text, until } = await fresh();
    await page.goto(base + `/patients/${mcPid}`, { waitUntil: 'commit', timeout: 120000 });
    await until(/Slow686 Fake/, 90000);
    const docsTab = page.getByRole('tab', { name: /Documents|Letters|Referral|MC/i });
    const tabNames = await page.getByRole('tab').allInnerTexts();
    let clicked = false, ok = null;
    for (let i = 0; i < 8 && !ok; i++) { await page.getByRole('tab', { name: 'Documents', exact: true }).click(); clicked = true; ok = await until(/Generated Documents[\s\S]*(MEDICAL CERTIFICATE|Medical Certificate)/i, 6000); }
    if (!ok) { rec({ case: 'mc viewer', note: 'no MC listed', tabNames, clicked, tail: (await text()).replace(/\s+/g, ' ').slice(-200) }); await ctx.close(); }
    else {
      await page.route('**/api/document-templates**', () => {});
      await page.route('**/api/organization', () => {});
      await page.getByRole('button', { name: /^(View|Preview|Open)/i }).first().click().catch(async () => { await page.getByText(/MEDICAL CERTIFICATE|Medical Certificate/).first().click(); });
      await page.waitForTimeout(500);
      const ms = await until(/timed out|Network error|Preview failed|Retry/i, 45000);
      const t = (await text()).replace(/\s+/g, ' ');
      rec({ case: 'mc viewer: stalled template fetch', errorOrRetryShownMs: ms, stillPreparing: /Preparing preview/.test(t), retryButton: await page.getByRole('button', { name: /^retry$/i }).count() > 0, tail: t.slice(-120) });
      await ctx.close(); }
  }
  // 5. settings/documents template editor: failure must not offer default-overwrite
  { const { ctx, page, until, text } = await fresh();
    await page.route('**/api/document-templates?type=*', (r) => r.abort('failed'));
    await page.goto(base + '/settings/documents', { waitUntil: 'commit', timeout: 120000 });
    await until(/Document Templates/, 90000); await page.waitForTimeout(4000);
    const t = (await text()).replace(/\s+/g, ' ');
    rec({ case: 'settings documents: template load fails', editorShownWithDefaults: /Save/.test(t) && !/Retry/i.test(t), retryButton: /Retry/.test(t), tail: t.slice(-140) });
    await ctx.close(); }
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
