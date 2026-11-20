// Stall every /api/** call for a screen (never answered) and report what the user sees after 40 s. Fake data only.
const path = require('path'), root = path.resolve(__dirname, '../../..');
const { chromium } = require(path.join(root, 'node_modules/playwright-core'));
const [base, ...screens] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  for (const url of screens) {
    const ctx = await b.newContext({ storageState: path.join(root, 'e2e/.secrets/state.json') });
    const p = await ctx.newPage();
    await p.route('**/api/**', () => {});
    await p.goto(base + url, { waitUntil: 'commit' }).catch(() => {});
    await p.waitForTimeout(40000);
    const t = (await p.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ');
    console.log(JSON.stringify({ url, retry: /retry|cuba lagi/i.test(t), timeoutMsg: /timed out|tamat masa|Network error|failed/i.test(t), loadingForever: /Loading|Memuatkan/i.test(t), blank: t.length < 150, tail: t.slice(-150) }));
    await ctx.close();
  }
  await b.close();
})();
