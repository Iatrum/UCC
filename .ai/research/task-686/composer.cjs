// Composer plan save under throttling + one offline blip mid-save (Task 686). Read-only audit of composer behavior.
const path = require('path'), root = path.resolve(__dirname, '../../..');
const { chromium } = require(path.join(root, 'node_modules/playwright-core'));
const fs = require('fs');
const [base] = process.argv.slice(2);
const cookie = JSON.parse(fs.readFileSync(path.join(root, 'e2e/.secrets/state.json'), 'utf8')).cookies.map(c => c.name + '=' + c.value).join('; ');
const post = async (p, body) => (await fetch(base + p, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
(async () => {
  const sfx = Math.random().toString(36).slice(2, 8);
  const { patientId } = await post('/api/patients', { fullName: `Slow686 Composer ${sfx}`, nric: `FAKE-686C-${sfx}`, dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000686' });
  await post('/api/consultations', { patientId, chiefComplaint: 'Fake 686', diagnosis: 'Fake' });
  const b = await chromium.launch(); const ctx = await b.newContext({ storageState: path.join(root, 'e2e/.secrets/state.json') });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable');
  const SLOW = { offline: false, latency: 400, downloadThroughput: 50000, uploadThroughput: 50000 };
  await cdp.send('Network.emulateNetworkConditions', SLOW);
  const posts = []; page.on('response', r => { if (r.url().includes('/api/consultations/plan') && r.request().method() === 'POST') posts.push(r.status()); });
  await page.goto(`${base}/patients/${patientId}`, { waitUntil: 'commit', timeout: 120000 });
  const tab = page.getByRole('tab', { name: 'Treatment', exact: true });
  for (let i = 0; i < 20; i++) { await tab.click().catch(() => {}); if (await page.getByText('Order', { exact: true }).isVisible().catch(() => false)) break; await page.waitForTimeout(2500); }
  const st = page.getByTestId('composer-save-status');
  await st.waitFor({ timeout: 60000 });
  const out = { initial: await st.innerText() };
  await page.locator('input:visible').last().fill('para');
  await cdp.send('Network.emulateNetworkConditions', { ...SLOW, offline: true }); // blip right as the item is added
  await page.locator('button', { hasText: /Paracetamol/ }).filter({ hasText: 'RM' }).first().click();
  await page.waitForTimeout(6000);
  out.offlineStatus = await st.innerText(); out.itemKept = await page.getByText(/1 × RM 0\.50/).isVisible();
  out.retryVisible = await page.getByRole('button', { name: 'Retry', exact: true }).isVisible().catch(() => false);
  await cdp.send('Network.emulateNetworkConditions', SLOW);
  if (out.retryVisible) await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.waitForFunction(() => /Saved \(server\)/.test(document.querySelector('[data-testid="composer-save-status"]')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
  out.finalStatus = await st.innerText(); out.postStatuses = posts; out.duplicatePostsOk = posts.filter(s => s === 200).length;
  console.log(JSON.stringify(out)); await b.close();
})();
