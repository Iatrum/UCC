// Opt-in dev-only gate driver: reclaim Next's compiler heap between suites.
// Every discovered spec is run once; no retries, result replacement or omission.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const e2e = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(e2e, '..');
const reports = path.resolve(process.env.UCC_REPORTS || '/workspace/ai-logs/e2e-reports');
if ((process.env.UCC_BASE_URL || 'http://localhost:3210') !== 'http://localhost:3210') throw Error('Batched gate requires local :3210');
if (!['http://localhost:8113', 'http://127.0.0.1:8113'].includes(new URL(process.env.MEDPLUM_URL || 'http://127.0.0.1:8113').origin)) throw Error('Dev Medplum only');
const env = { ...process.env, NODE_OPTIONS: '--max-old-space-size=3072', MEDPLUM_URL: 'http://127.0.0.1:8113/', MEDPLUM_BASE_URL: 'http://127.0.0.1:8113/', NEXT_PUBLIC_MEDPLUM_BASE_URL: 'http://127.0.0.1:8113/', UCC_NO_TRACE: '1' };
const files = fs.readdirSync(path.join(e2e, 'tests')).filter(f => /\.spec\.ts$/.test(f) && (process.env.UCC_ADMIN_E2E || f !== 'admin.spec.ts')).sort();
const groups = Array.from({ length: 6 }, () => []);
for (const file of files) {
  const group = file === 'admin.spec.ts' ? 5 : file === 'workflow.spec.ts' ? 4 : file === 'time-chit.spec.ts' ? 3 : /^(poct|xray|xray-phase2)\.spec/.test(file) ? 2 : /^(draft-retention|lab-results-state|save-state)\.spec/.test(file) ? 1 : 0;
  groups[group].push(file);
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const exited = child => new Promise(resolve => { child.once('exit', code => resolve(code)); child.once('error', () => resolve(null)); });
let server, browserTest, cancelled = false;
async function stopGroup(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
  await pause(1500);
  try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  cancelled = true;
  if (browserTest?.pid) { try { process.kill(-browserTest.pid, 'SIGINT'); } catch {} }
  else void stopGroup(server);
});
async function availablePort() {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(Error('Port :3210 is occupied; refusing to touch another server')));
    probe.listen(3210, () => probe.close(resolve));
  });
}
fs.mkdirSync(reports, { recursive: true });
fs.rmSync(path.join(reports, 'results.json'), { force: true });
const completed = [];
let failed = false;
try {
  for (const [index, group] of groups.entries()) {
    if (!group.length) continue;
    if (cancelled) throw Error('Gate interrupted');
    await availablePort();
    const batch = path.join(reports, `batch-${index + 1}`);
    fs.mkdirSync(batch, { recursive: true });
    const log = fs.openSync(path.join(batch, 'server.log'), 'w', 0o600);
    server = spawn(process.execPath, [path.join(repo, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '-p', '3210'], { cwd: repo, env, detached: true, stdio: ['ignore', log, log] });
    fs.closeSync(log);
    try {
      let ready = false;
      for (let attempt = 0; attempt < 120 && !cancelled; attempt++) {
        if (server.exitCode !== null) throw Error('Owned dev server exited before readiness');
        try { ready = (await fetch('http://localhost:3210/login', { signal: AbortSignal.timeout(5000) })).status === 200; } catch {}
        if (ready) break;
        await pause(1000);
      }
      if (!ready) throw Error('Owned dev server readiness failed');
      // Warm only common entry pages, rather than compiling the entire app in every batch.
      const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
      try {
        const context = await browser.newContext(fs.existsSync(path.join(e2e, '.secrets/state.json')) ? { storageState: path.join(e2e, '.secrets/state.json') } : {});
        const page = await context.newPage();
        for (const url of ['/login', '/dashboard', '/patients/new']) await page.goto('http://localhost:3210' + url, { timeout: 120000, waitUntil: 'networkidle' });
      } finally { await browser.close(); }
      console.log(`BATCH ${index + 1}: ${group.join(', ')}`);
      const batchEnv = { ...env, UCC_REPORTS: batch };
      browserTest = spawn('timeout', ['--kill-after=15s', '15m', 'npx', 'playwright', 'test', '--workers=1', ...group.map(f => `tests/${f}`)], { cwd: e2e, env: batchEnv, detached: true, stdio: 'inherit' });
      const code = await exited(browserTest);
      await stopGroup(browserTest); browserTest = undefined;
      if (cancelled) throw Error('Gate interrupted');
      const result = JSON.parse(fs.readFileSync(path.join(batch, 'results.json'), 'utf8'));
      if (result.errors?.length || !result.suites?.length) throw Error('Incomplete batch report');
      completed.push(result); failed ||= code !== 0;
    } finally { await stopGroup(server); server = undefined; }
  }
  if (cancelled || !completed.length) throw Error('No complete gate report');
  const combined = { ...completed[0], suites: completed.flatMap(r => r.suites), errors: [], stats: { ...completed[0].stats } };
  for (const key of ['duration', 'expected', 'unexpected', 'flaky', 'skipped']) combined.stats[key] = completed.reduce((n, r) => n + (r.stats[key] || 0), 0);
  fs.writeFileSync(path.join(reports, 'results.json'), JSON.stringify(combined));
  console.log(`BATCHES complete: ${completed.length}; every discovered spec included, no retries`);
  process.exitCode = failed ? 1 : 0;
} catch {
  console.error('Batched gate failed or was interrupted; individual reports retained, combined report withheld');
  process.exitCode = 1;
} finally { await stopGroup(browserTest); await stopGroup(server); }
