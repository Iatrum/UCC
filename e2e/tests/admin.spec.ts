import fs from 'node:fs';
import { test, expect, request, type Page, type APIResponse } from '@playwright/test';
import { BASE, MEDPLUM, MEDPLUM_ADMIN, RUN } from '../lib/env';

const OUT = '/workspace/ai-logs/admin-e2e';
// Do not inherit the doctor's state or record credentials in Playwright traces.
test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', screenshot: 'off' });
test.describe.configure({ mode: 'serial' });

test('full local admin audit (one login)', async ({ browser }) => {
  test.setTimeout(15 * 60_000);
  expect(BASE).toBe('http://localhost:3210');
  expect(MEDPLUM.replace(/\/$/, '')).toBe('http://localhost:8113');
  fs.mkdirSync(`${OUT}/shots`, { recursive: true });
  type Row = { function: string; result: string; evidence: string; cause: string };
  const rows: Row[] = [];
  let nn = 0, page: Page;
  const issues: string[] = [];
  let allowClientValidation400 = false;
  let orgId = '', clinicId = '', userId = '';
  const orgName = `e2e-${RUN}-organisation`, clinicName = `e2e-${RUN}-clinic`;
  const email = `e2e-${RUN}@example.invalid`;
  const api = await request.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  const shot = async (name: string) => {
    const file = `shots/${String(++nn).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
    await page.screenshot({ path: `${OUT}/${file}`, fullPage: true, mask: [page.locator('input[type="password"]')] });
    return file;
  };
  const step = async (name: string, cause: string, fn: () => Promise<void>, absent = '') => {
    await test.step(name, async () => {
      const start = issues.length;
      let error = '';
      try { await fn(); } catch (e) { error = e instanceof Error ? e.message : String(e); }
      const evidence = page ? await shot(name).catch(() => 'screenshot unavailable') : 'no browser';
      const errors = issues.slice(start);
      const detail = [error, ...errors].filter(Boolean).join('; ');
      rows.push({ function: name, result: detail ? 'BROKEN' : absent ? 'NOT PRESENT' : 'WORKS', evidence: `${evidence}${detail ? ` — ${detail}` : absent ? ` — ${absent}` : ''}`, cause: detail || absent ? cause : '—' });
      expect.soft(detail, name).toBe('');
      fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ run: RUN, rows }, null, 2));
    });
  };
  const json = async (r: APIResponse) => {
    const data = await r.json();
    if (!r.ok()) throw new Error(`HTTP ${r.status()}: ${JSON.stringify(data)}`);
    return data;
  };
  const visit = async (path: string) => {
    const r = await page.goto(path, { waitUntil: 'networkidle' });
    if (!r || r.status() >= 400) throw new Error(`Navigation HTTP ${r?.status()}`);
    expect(page.url()).toContain('/admin');
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('h1').or(page.getByText('Create Medplum ClientApplication', { exact: true }))).toBeVisible();
    const text = await page.locator('body').innerText();
    if (/Application error|Internal Server Error|Unable to load users|Runtime Error|This account is not a platform admin/i.test(text)) throw new Error('Page shows error state');
    if (await page.locator('nextjs-portal').evaluateAll(nodes => nodes.some(n => /Runtime Error|Build Error/.test(n.shadowRoot?.textContent || '')))) throw new Error('Next error overlay');
  };
  const submit = async (url: string, method: string, button: string) => {
    const response = page.waitForResponse(r => new URL(r.url()).pathname === url && r.request().method() === method);
    await page.getByRole('button', { name: button, exact: true }).click();
    const r = await response;
    // Delete handlers navigate immediately; Chromium may discard the response body.
    return method === 'DELETE' && r.ok() ? undefined : json(r);
  };
  const choose = async (id: string, label: string) => {
    await page.locator(`#${id}`).click();
    await page.getByRole('option').filter({ hasText: label }).click();
  };
  const remove = async (path: string, trigger: string, confirm: string, url: string) => {
    await visit(path);
    await page.getByRole('button', { name: trigger, exact: true }).click();
    await shot(`${trigger}-confirmation`);
    await submit(url, 'DELETE', confirm);
  };
  try {
    // Deliberately no retry: exactly one authentication attempt for the entire run.
    const login = await json(await api.post('/api/auth/login', { data: MEDPLUM_ADMIN }));
    expect(login.isAdmin).toBe(true);
    const context = await browser.newContext({ baseURL: BASE, storageState: await api.storageState(), viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    page.on('console', msg => {
      if (msg.type() !== 'error') return;
      if (allowClientValidation400 &&
          msg.text() === 'Failed to load resource: the server responded with a status of 400 (Bad Request)' &&
          msg.location().url === `${BASE}/api/admin/create-medplum-client`) return;
      issues.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', e => issues.push(`pageerror: ${e.message}`));
    page.on('response', r => { if (r.status() >= 500) issues.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
    // Refuse browser requests to external services, even when deployment settings contain external URLs.
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      return ['http://localhost:3210', 'http://localhost:8113', 'ws://localhost:3210'].includes(u.origin) || ['data:', 'blob:'].includes(u.protocol) ? route.continue() : route.abort();
    });
    for (const path of ['', '/clinics', '/clinics/new', '/organisation', '/organisation/new', '/users', '/users/invite', '/modules', '/settings', '/create-medplum-client']) {
      await step(`load /admin${path}`, `app/(admin)/admin${path || '/page.tsx'}`, () => visit(`/admin${path}`));
    }
    await step('create organisation', 'app/(admin)/admin/organisation/org-form.tsx:60', async () => {
      await visit('/admin/organisation/new');
      await page.locator('#name').fill(orgName);
      await page.locator('#phone').fill('0000000000');
      await page.locator('#address').fill(`Fake address ${RUN}`);
      const data = await submit('/api/admin/organisation', 'POST', 'Create Organisation');
      orgId = data.organisation.id;
      expect((await json(await api.get('/api/admin/organisation'))).organisations.some((o: any) => o.id === orgId && o.name === orgName)).toBe(true);
    });
    await step('load /admin/organisation/[id] and edit', 'app/(admin)/admin/organisation/org-form.tsx:60', async () => {
      if (!orgId) throw new Error('Create organisation prerequisite failed');
      await visit(`/admin/organisation/${orgId}`); await shot('organisation-detail');
      await page.locator('#name').fill(`${orgName}-edited`);
      await submit('/api/admin/organisation', 'PATCH', 'Save Changes');
      await visit(`/admin/organisation/${orgId}`);
      await expect(page.locator('#name')).toHaveValue(`${orgName}-edited`);
    });
    await step('create clinic', 'lib/fhir/admin-service.ts:387', async () => {
      if (!orgId) throw new Error('Owned organisation unavailable');
      await visit('/admin/clinics/new');
      await choose('parentId', `${orgName}-edited`);
      await page.locator('#name').fill(clinicName); await page.locator('#subdomain').fill(`e2e-${RUN}`);
      await submit('/api/admin/clinics', 'POST', 'Create Branch');
      clinicId = (await json(await api.get('/api/admin/clinics'))).clinics.find((c: any) => c.subdomain === `e2e-${RUN}`)?.id || '';
      expect(clinicId).not.toBe('');
    });
    await step('load /admin/clinics/[id] and edit', 'app/(admin)/admin/clinics/[id]/clinic-edit-form.tsx:94', async () => {
      if (!clinicId) throw new Error('Owned clinic unavailable');
      await visit(`/admin/clinics/${clinicId}`); await shot('clinic-detail');
      await page.locator('#name').fill(`${clinicName}-edited`); await page.locator('#phone').fill('0000000001');
      await page.locator('#address').fill(`Fake edited address ${RUN}`);
      await submit(`/api/admin/clinics/${clinicId}`, 'PATCH', 'Save Changes');
      await visit(`/admin/clinics/${clinicId}`);
      await expect(page.locator('#name')).toHaveValue(`${clinicName}-edited`);
    });
    await step('toggle every module and restore', 'app/(admin)/admin/clinics/[id]/page.tsx:22', async () => {
      if (!clinicId) throw new Error('Owned clinic unavailable');
      await visit(`/admin/clinics/${clinicId}`);
      const original = (await json(await api.get(`/api/admin/clinics/${clinicId}`))).enabledModuleIds;
      const switches = page.getByRole('switch'); const count = await switches.count();
      if (!count) throw new Error('No module switches rendered; module registry may be unavailable');
      try {
        for (let i = 0; i < count; i++) { await switches.nth(i).click(); await shot(`module-${i + 1}-toggled`); }
        await submit(`/api/admin/clinics/${clinicId}`, 'PATCH', 'Save Module Settings');
        const changed = (await json(await api.get(`/api/admin/clinics/${clinicId}`))).enabledModuleIds;
        expect(changed.slice().sort()).not.toEqual(original.slice().sort());
        await visit(`/admin/clinics/${clinicId}`);
        for (let i = 0; i < count; i++) await switches.nth(i).click();
        await submit(`/api/admin/clinics/${clinicId}`, 'PATCH', 'Save Module Settings');
        expect((await json(await api.get(`/api/admin/clinics/${clinicId}`))).enabledModuleIds.slice().sort()).toEqual(original.slice().sort());
      } finally {
        await json(await api.patch(`/api/admin/clinics/${clinicId}`, { data: { name: `${clinicName}-edited`, parentId: orgId, phone: '0000000001', address: `Fake edited address ${RUN}`, enabledModuleIds: original } }));
      }
    });
    await step('invite fake user (direct creation; email toggle)', 'lib/fhir/admin-service.ts:711', async () => {
      if (!clinicId) throw new Error('Owned clinic unavailable');
      await visit('/admin/users/invite'); await choose('clinicId', `${clinicName}-edited`);
      await page.locator('#firstName').fill(`e2e-${RUN}`); await page.locator('#lastName').fill('Fake'); await page.locator('#email').fill(email);
      await page.locator('#sendEmailInvite').click(); await expect(page.getByRole('button', { name: 'Send Invite', exact: true })).toBeVisible(); await shot('email-invite-enabled');
      await page.locator('#sendEmailInvite').click();
      await page.locator('#password').fill(`Fake-only-${RUN}-X!`);
      await submit('/api/admin/users/invite', 'POST', 'Create User');
    });
    // Lookup also catches partial invitation success when assignment fails.
    const lookup = async () => {
      const users = (await json(await api.get('/api/admin/users'))).users;
      userId = users.find((u: any) => u.email === email)?.id || '';
    };
    await step('load /admin/users/[id] and edit profile/assignments', 'lib/fhir/admin-service.ts:518', async () => {
      await lookup(); if (!userId) throw new Error('Fake user was not created');
      await visit(`/admin/users/${userId}`); await shot('user-detail');
      await page.locator('#lastName').fill('Edited');
      const owned = page.locator('label').filter({ hasText: `${clinicName}-edited` }).getByRole('checkbox');
      await owned.uncheck(); await submit(`/api/admin/users/${userId}`, 'PATCH', 'Save Changes');
      expect((await json(await api.get(`/api/admin/users/${userId}`))).organizationIds).not.toContain(clinicId);
      await visit(`/admin/users/${userId}`); await owned.check();
      await submit(`/api/admin/users/${userId}`, 'PATCH', 'Save Changes');
      const saved = await json(await api.get(`/api/admin/users/${userId}`));
      expect(saved.lastName).toBe('Edited'); expect(saved.organizationIds).toContain(clinicId);
    });
    await step('edit user role', 'app/(admin)/admin/users/[id]/user-edit-form.tsx:215', async () => {}, 'Only profile and clinic assignments exist; no role selector/API field.');
    await step('settings save and restore', 'app/(admin)/admin/settings/page.tsx:23', async () => {
      await visit('/admin/settings'); expect(await page.locator('input,select,textarea,button[type="submit"]').count()).toBe(0);
    }, 'Settings shows runtime configuration; no editable settings/save endpoint.');
    await step('client creation validation', 'app/(routes)/api/admin/create-medplum-client/route.ts:17', async () => {
      await visit('/admin/create-medplum-client'); await page.locator('#medplumUrl').fill('http://localhost:8113'); await page.locator('#email').fill(email);
      const response = page.waitForResponse(r => r.url().endsWith('/api/admin/create-medplum-client') && r.request().method() === 'POST');
      allowClientValidation400 = true;
      try {
        await page.getByRole('button', { name: 'Create Client Credentials' }).click();
        const r = await response; expect(r.status()).toBe(400); expect((await r.json()).error).toBe('Missing required fields');
        await expect(page.getByText('❌ Error: Missing required fields')).toBeVisible();
      } finally {
        allowClientValidation400 = false;
      }
    });
    await step('create client/API key and revoke', 'app/(routes)/api/admin/create-medplum-client/route.ts:29', async () => {}, 'Success path untested: endpoint necessarily performs a second login, prohibited by task. No API-key/revoke UI or route exists.');
    await step('separate user deactivate/revoke', 'app/(admin)/admin/users/[id]/user-edit-form.tsx:270', async () => {}, 'Delete User is the only access revocation action; tested during cleanup.');
  } finally {
    if (page) {
      // Only delete IDs discovered from exact RUN-owned objects, never existing fixtures.
      if (!userId) { try { userId = (await json(await api.get('/api/admin/users'))).users.find((u: any) => u.email === email)?.id || ''; } catch {} }
      if (userId) await step('delete user and revoke access', 'lib/fhir/admin-service.ts:587', async () => {
        await remove(`/admin/users/${userId}`, 'Delete User', 'Delete permanently', `/api/admin/users/${userId}`);
        const r = await api.get(`/api/admin/users/${userId}`); const d = await r.json();
        expect(r.status() === 404 || d.active === false).toBe(true);
      });
      if (clinicId) await step('delete clinic', 'lib/fhir/admin-service.ts:306', async () => {
        await remove(`/admin/clinics/${clinicId}`, 'Delete Branch', 'Delete permanently', `/api/admin/clinics/${clinicId}`);
        expect((await api.get(`/api/admin/clinics/${clinicId}`)).status()).toBe(404);
      });
      if (orgId) await step('delete organisation', 'lib/fhir/admin-service.ts:306', async () => {
        await remove(`/admin/organisation/${orgId}`, 'Delete Organisation', 'Delete', '/api/admin/organisation');
        expect((await json(await api.get('/api/admin/organisation'))).organisations.some((o: any) => o.id === orgId)).toBe(false);
      });
      // Best-effort app API cleanup if a UI action failed; results remain BROKEN.
      for (const [url, data] of [[userId && `/api/admin/users/${userId}`, undefined], [clinicId && `/api/admin/clinics/${clinicId}`, undefined], [orgId && '/api/admin/organisation', { id: orgId }]] as const) {
        if (url) await api.delete(url, { data }).catch(() => {});
      }
      await page.context().close();
    }
    const escape = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 5000);
    fs.writeFileSync(`${OUT}/FINDINGS.md`, `# Local admin E2E — RUN ${RUN}\n\nOne isolated admin login; no retries, no doctor global setup, no external navigation. Screenshots relative to this report.\n\n| Function | Result | Evidence | Suspected root cause file:line |\n|---|---|---|---|\n${rows.map(r => `| ${escape(r.function)} | ${r.result} | ${escape(r.evidence)} | ${escape(r.cause)} |`).join('\n')}\n\nSummary: ${rows.filter(r => r.result === 'WORKS').length} WORKS, ${rows.filter(r => r.result === 'BROKEN').length} BROKEN, ${rows.filter(r => r.result === 'NOT PRESENT').length} NOT PRESENT/explicit coverage limitations. Client success cannot be verified within the one-login constraint. Full check-all intentionally not run: user requested only this spec.\n`);
    await api.dispose();
  }
});
