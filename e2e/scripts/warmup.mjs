// Warm the Next dev server (compile client chunks) before the suite, so a cold server
// does not make the first UI test submit a non-hydrated form. Uses the saved session if present.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const base = process.env.UCC_BASE_URL || 'http://localhost:3210';
const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const c = await b.newContext({ baseURL: base, ...(fs.existsSync('.secrets/state.json') ? { storageState: '.secrets/state.json' } : {}) });
const p = await c.newPage();
for (const u of ['/login', '/dashboard', '/patients', '/patients/new', '/queue', '/orders', '/reports', '/settings', '/poct', '/pacs', '/admin']) {
  const t = Date.now();
  try { await p.goto(u, { timeout: 240_000, waitUntil: 'networkidle' }); } catch {}
  console.log(`warm ${u} ${Date.now() - t}ms`);
}
await b.close();
