import { Page, test } from '@playwright/test';
import fs from 'node:fs'; import path from 'node:path';
import { EVIDENCE, USER, PASSWORD } from './env';
export type Issue = { step: string; kind: string; text: string };
export function watch(page: Page, issues: Issue[], step: () => string) {
  page.on('console', m => { if (m.type() === 'error') issues.push({ step: step(), kind: 'console', text: m.text().slice(0, 300) }); });
  page.on('pageerror', e => issues.push({ step: step(), kind: 'pageerror', text: e.message.slice(0, 300) }));
  page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 400) issues.push({ step: step(), kind: 'http', text: `${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}` }); });
  page.on('dialog', d => d.accept());
}
export async function shot(page: Page, name: string) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(EVIDENCE, name + '.png'), fullPage: true, timeout: 20_000 }).catch(() => {});
}
export async function uiLogin(page: Page) {
  await page.goto('/login');
  await page.fill('input[type=email]', USER); await page.fill('input[type=password]', PASSWORD);
  await page.keyboard.press('Enter'); await page.waitForURL(/dashboard/, { timeout: 120_000 });
}
export function saveJson(name: string, data: unknown) { fs.writeFileSync(path.join(EVIDENCE, name), JSON.stringify(data, null, 2)); }
/** Record a known-bug check without aborting the serial workflow. */
export function known(ok: boolean, msg: string) { test.info().annotations.push({ type: ok ? 'ok' : 'BUG', description: msg }); }
