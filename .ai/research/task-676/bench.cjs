const { readFileSync } = require('node:fs');
const { performance } = require('node:perf_hooks');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd()] }));

const base = 'http://127.0.0.1:3676';
const heading = (page, name) => page.getByRole('heading', { name, exact: true }).first();
const visible = (locator) => locator.waitFor({ state: 'visible' });
const treatment = (page) => page.getByRole('tab', { name: 'Treatment', exact: true });
const search = (page) => page.getByRole('textbox', { name: 'Search treatment catalog' })
  .or(page.getByPlaceholder(/^Search medicines/)).first();
const untilDashboard = async (page) => {
  await visible(heading(page, 'Dashboard'));
  await page.getByText('Loading queue...', { exact: true }).filter({ visible: true }).first().waitFor({ state: 'hidden' });
  await visible(page.getByRole('tab', { name: "Today's Queue", exact: true }).first());
  if (await page.getByText('Queue could not be refreshed', { exact: true }).first().isVisible()) {
    throw new Error('queue-failure');
  }
};

const ms = Math.round;
async function metrics(page, start) {
  const usable = ms(performance.now() - start);
  const document = await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const nav = performance.getEntriesByType('navigation')[0];
    const pending = window.uccBenchLcpObserver.takeRecords();
    return {
      ttfb: nav.responseStart - nav.startTime,
      lcp: pending.at(-1)?.startTime ?? window.uccBenchLcp ?? 0,
    };
  });
  return { usable, lcp: ms(document.lcp), ttfb: ms(document.ttfb) };
}

let stage = 'launch';
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ baseURL: base });
    const statuses = new Map();
    context.on('response', response => {
      const path = new URL(response.url()).pathname;
      if (['/api/queue', '/api/auth/login', '/api/orders/billable', '/api/auth/me'].includes(path)) {
        statuses.set(path, response.status());
      }
    });
    process.on('exit', code => { if (code) console.error(JSON.stringify(Object.fromEntries(statuses))); });
    const page = await context.newPage();
    const catalogRequests = new Set();
    let watchCatalogs = false;
    if (process.env.UCC_VERIFY_ON_DEMAND === '1') {
      page.on('request', request => {
        if (!watchCatalogs) return;
        const path = new URL(request.url());
        const catalogType = path.searchParams.get('type');
        if (['/api/inventory', '/api/procedures'].includes(path.pathname)) catalogRequests.add(path.pathname);
        if (path.pathname === '/api/catalogs' && ['lab', 'imaging', 'document'].includes(catalogType)) {
          catalogRequests.add(catalogType);
        }
      });
    }
    page.setDefaultTimeout(15000);
    await page.addInitScript(() => {
      const observer = new PerformanceObserver((list) => {
        window.uccBenchLcp = list.getEntries().at(-1)?.startTime;
      });
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
      window.uccBenchLcpObserver = observer;
    });

    stage = 'login';
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.locator('#email').fill('doctor@ucc.local');
    await page.locator('#password').fill(readFileSync(process.env.UCC_BENCH_PASSWORD_FILE, 'utf8').trim());
    const loginStart = performance.now();
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await untilDashboard(page);
    console.log(JSON.stringify({ route: 'login-dashboard', run: 1, ...await metrics(page, loginStart) }));

    stage = 'fixture discovery';
    const fixture = await page.evaluate(async () => {
      const [billable, patients] = await Promise.all([
        fetch('/api/orders/billable').then((r) => r.json()),
        fetch('/api/patients').then((r) => r.json()),
      ]);
      const bill = billable.consultations?.find((row) => row.id && row.patientId);
      return { encounterId: bill?.id, patientId: bill?.patientId, patientListAvailable: patients.patients?.length > 0 };
    });
    if (!fixture.encounterId || !fixture.patientId || !fixture.patientListAvailable) {
      throw new Error('No billable patient or patients list');
    }
    const profile = '/patients/' + encodeURIComponent(fixture.patientId);
    const checkout = '/orders/checkout/' + encodeURIComponent(fixture.encounterId)
      + '?patientId=' + encodeURIComponent(fixture.patientId);

    const routes = [
      ['dashboard', '/dashboard', untilDashboard],
      ['patients', '/patients', async p => {
        await visible(heading(p, 'Patients'));
        await visible(p.getByText('Total Patients', { exact: true }).or(p.getByRole('table')).first());
      }],
      ['profile', profile, async p => visible(treatment(p))],
      ['composer', profile, async p => visible(treatment(p))],
      ['billing', '/orders', async p => {
        await visible(p.getByRole('heading', { name: /^Billing(?: & Documents)?$/ }).first());
        await visible(p.getByText('Ready for Billing', { exact: true }).first());
      }],
      ['checkout', checkout, async p => visible(heading(p, 'Invoice'))],
      ['inventory', '/inventory', async p => visible(heading(p, 'Inventory'))],
      ['analytics', '/analytics', async p => {
        await visible(heading(p, 'Analytics'));
        await visible(p.getByRole('tab').first().or(p.locator('[data-slot="card"]').first()).first());
        await p.waitForLoadState('networkidle');
      }],
    ];

    for (const [route, url, ready] of routes) {
      for (let run = 0; run <= 5; run++) {
        stage = route + ' run ' + run;
        catalogRequests.clear();
        watchCatalogs = route === 'composer' || route === 'profile';
        const start = performance.now();
        let interaction;
        await page.goto(url, { waitUntil: 'commit' });
        await ready(page);
        if (route === 'composer') {
          if (catalogRequests.size) throw new Error('early-catalog');
          const clickStart = performance.now();
          await treatment(page).click();
          await visible(search(page));
          interaction = ms(performance.now() - clickStart);
          if (!(await search(page).isEditable())) throw new Error('Composer search not editable');
        }
        const timings = await metrics(page, start);
        if (run) console.log(JSON.stringify({ route, run, ...timings, interaction }));
        if (route === 'composer') {
          await page.getByText('Loading…', { exact: true }).filter({ visible: true }).first().waitFor({ state: 'hidden' });
          if (process.env.UCC_VERIFY_ON_DEMAND === '1' && catalogRequests.size !== 5) throw new Error('missing-catalog');
        } else if (route === 'profile' && catalogRequests.size) {
          throw new Error('early-catalog');
        }
        await page.waitForLoadState('load');
        if (process.env.UCC_BENCH_SETTLE === '1') await page.waitForLoadState('networkidle');
      }
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  // Playwright errors can contain input values and protected URLs.
  const reason = ['queue-failure', 'early-catalog', 'missing-catalog'].includes(error.message) ? error.message :
    error.message.includes('strict mode violation') ? 'strict locator' :
    error.message.includes('Executable doesn') ? 'missing chromium' : error.name;
  console.error('Benchmark failed at ' + stage + ' (' + reason + ').');
  process.exitCode = 1;
});
