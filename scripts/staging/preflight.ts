/**
 * Staging safe-target preflight (Task 525 / plan 2.5 item 385b). Fails closed:
 * every check is a positive allowlist; anything not explicitly recognised as staging is refused.
 * Never prints values of secrets, only check names. Does not weaken the localhost guards of the
 * existing seed/admin specs (those stay as they are).
 *
 *   bun run staging:preflight            checks process.env
 */
export const STAGING_MEDPLUM_ORIGINS = ['http://127.0.0.1:8123', 'http://localhost:8123'];

type Env = Record<string, string | undefined>;

function origin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.username || u.password || u.search || u.hash) return null;
    if (u.pathname !== '/' && u.pathname !== '') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Returns a list of failed check names (empty = safe to target staging). */
export function stagingPreflight(env: Env): string[] {
  const fails: string[] = [];
  const allowedOrigin = origin(env.UCC_STAGING_MEDPLUM_URL);
  if (!allowedOrigin || !STAGING_MEDPLUM_ORIGINS.includes(allowedOrigin)) fails.push('UCC_STAGING_MEDPLUM_URL is not a staging origin (127.0.0.1:8123)');

  // Every Medplum URL in play must be exactly the allowlisted staging origin.
  for (const key of ['MEDPLUM_BASE_URL', 'NEXT_PUBLIC_MEDPLUM_BASE_URL', 'MEDPLUM_URL']) {
    const v = env[key];
    if (key !== 'MEDPLUM_URL' && !v) { fails.push(`${key} is not set`); continue; }
    if (v && origin(v) !== allowedOrigin) fails.push(`${key} does not match the staging Medplum origin`);
  }
  const ucc = env.UCC_BASE_URL;
  if (ucc && origin(ucc) !== 'http://127.0.0.1:3220' && origin(ucc) !== 'http://localhost:3220') fails.push('UCC_BASE_URL is not the staging app origin (127.0.0.1:3220)');

  // Firebase: explicit project allowlist, no ADC fallback, consistent bucket.
  const project = env.UCC_STAGING_ALLOWED_FIREBASE_PROJECT;
  if (!project || /^REPLACE|^$/.test(project)) fails.push('UCC_STAGING_ALLOWED_FIREBASE_PROJECT is not set');
  if (env.FIREBASE_PROJECT_ID !== project || !project) fails.push('FIREBASE_PROJECT_ID is not the allowlisted staging project');
  for (const key of ['FIREBASE_STORAGE_BUCKET', 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET']) {
    const b = env[key] ?? '';
    if (!project || !(b === project || b.startsWith(`${project}.`) || b.startsWith(`${project}-`))) fails.push(`${key} does not belong to the staging project`);
  }
  if (env.GOOGLE_APPLICATION_CREDENTIALS || env.FIREBASE_CONFIG || env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT) fails.push('ambient Google credentials/project env is set (ADC fallback could reach another project)');
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as { project_id?: string };
      if (sa.project_id !== project) fails.push('FIREBASE_SERVICE_ACCOUNT project_id is not the staging project');
    } catch {
      fails.push('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
    }
  }

  // Cookies: never the production domain.
  const cookie = (env.COOKIE_DOMAIN ?? '').toLowerCase();
  if (/(^|\.)iatrum\.com$/.test(cookie.replace(/^\./, '')) || cookie.includes('iatrum')) fails.push('COOKIE_DOMAIN is a production domain');
  const base = (env.NEXT_PUBLIC_BASE_DOMAIN ?? '').toLowerCase();
  if (base.includes('iatrum') || base.includes('drhidayat')) fails.push('NEXT_PUBLIC_BASE_DOMAIN is a production domain');

  return fails;
}

if (import.meta.main) {
  const fails = stagingPreflight(process.env);
  if (fails.length) {
    console.error('STAGING PREFLIGHT FAILED (refusing to continue):');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('staging preflight OK');
}
