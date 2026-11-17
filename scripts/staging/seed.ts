/**
 * Staging seed runner (Task 525 / plan 385b). Runs the staging preflight, then delegates to the
 * existing fake-only 4-clinic seed (e2e/scripts/seed-clinics.ts) against the allowlisted staging
 * Medplum. Fake data only: the seed tags everything FAKE / ucc-dummy-v1. It never reads production.
 *
 *   bun run staging:seed [--dry-run]
 *
 * Admin credentials come from MEDPLUM_ADMIN_EMAIL / MEDPLUM_ADMIN_PASSWORD (staging project only;
 * the seed's dev defaults are refused here). The staging project must already contain the `demo`
 * clinic Organization and the doctor Practitioner (bootstrap not automated yet; see the checklist).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { stagingPreflight } from './preflight';

const args = process.argv.slice(2);
if (args.some((a) => a !== '--dry-run')) { console.error('Unsupported argument'); process.exit(2); }
const fails = stagingPreflight(process.env);
if (fails.length) {
  console.error('STAGING PREFLIGHT FAILED (refusing to seed):');
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
if (!args.includes('--dry-run')) {
  if (!process.env.MEDPLUM_ADMIN_EMAIL || !process.env.MEDPLUM_ADMIN_PASSWORD) {
    console.error('Set MEDPLUM_ADMIN_EMAIL and MEDPLUM_ADMIN_PASSWORD for the staging project (no dev defaults).');
    process.exit(1);
  }
  if (process.env.MEDPLUM_ADMIN_PASSWORD === 'medplum_admin' || process.env.MEDPLUM_ADMIN_EMAIL === 'admin@example.com') {
    console.error('Refusing the well-known dev admin credentials on staging.');
    process.exit(1);
  }
}
const e2e = path.resolve(import.meta.dirname, '../../e2e');
const r = spawnSync('npx', ['tsx', 'scripts/seed-clinics.ts', ...args], {
  cwd: e2e, stdio: 'inherit',
  env: { ...process.env, MEDPLUM_URL: process.env.UCC_STAGING_MEDPLUM_URL },
});
process.exit(r.status ?? 1);
