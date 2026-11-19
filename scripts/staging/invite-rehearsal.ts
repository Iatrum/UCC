/**
 * Task 663 / plan 385d: rehearse a SUCCESSFUL user invite through the allowlisted proxy.
 *   bun run scripts/staging/invite-rehearsal.ts            (proxy base defaults to http://127.0.0.1:8180)
 * Env: MEDPLUM_ADMIN_EMAIL / MEDPLUM_ADMIN_PASSWORD (dev defaults are the repo's e2e/lib/env.ts ones),
 *      REHEARSAL_DIRECT=http://127.0.0.1:8113 (dev Medplum, used ONLY for cleanup, never for the invite).
 * Fake data only. Refuses any base other than loopback. Never prints tokens or passwords.
 * Flow (all through the proxy): admin login -> POST /admin/projects/:id/invite (sendEmail=false, password)
 * -> invited user logs in -> admin token is denied (404) on /admin/projects/:id/members -> cleanup.
 */
import { randomBytes, createHash } from 'node:crypto';

const PROXY = process.env.REHEARSAL_PROXY || 'http://127.0.0.1:8180';
const DIRECT = process.env.REHEARSAL_DIRECT || 'http://127.0.0.1:8113';
for (const b of [PROXY, DIRECT]) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(b)) throw new Error(`refusing non-loopback base ${b}`);
}
const ADMIN = {
  email: process.env.MEDPLUM_ADMIN_EMAIL || 'admin@example.com',
  password: process.env.MEDPLUM_ADMIN_PASSWORD || 'medplum_admin',
};
let failed = 0;
const check = (label: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  if (!ok) failed = 1;
};
const json = async (base: string, method: string, path: string, body?: unknown, token?: string) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON, e.g. Traefik 404 body */ }
  return { status: res.status, data };
};

async function login(base: string, email: string, password: string) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let r = await json(base, 'POST', '/auth/login', {
    email, password, scope: 'openid', codeChallenge: challenge, codeChallengeMethod: 'S256',
  });
  if (r.status !== 200) throw new Error(`login HTTP ${r.status}`);
  if (!r.data.code) { // several projects: pick the first membership
    const m = r.data.memberships?.[0];
    if (!m) throw new Error('login returned no code and no memberships');
    r = await json(base, 'POST', '/auth/profile', { login: r.data.login, profile: m.id });
    if (r.status !== 200 || !r.data.code) throw new Error(`profile select HTTP ${r.status}`);
  }
  const tok = await fetch(base + '/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: r.data.code, code_verifier: verifier }),
  });
  const t: any = await tok.json();
  if (!tok.ok || !t.access_token) throw new Error(`token HTTP ${tok.status}`);
  return { token: t.access_token as string, projectId: t.project?.reference?.replace('Project/', '') as string, profile: t.profile?.reference as string };
}

const stamp = Date.now().toString(36);
const fake = { email: `invite-rehearsal-${stamp}@example.invalid`, password: randomBytes(18).toString('base64url') + 'aA1!' };

const admin = await login(PROXY, ADMIN.email, ADMIN.password);
check('admin login through proxy', !!admin.token && !!admin.projectId);

const inv = await json(PROXY, 'POST', `/admin/projects/${admin.projectId}/invite`, {
  resourceType: 'Practitioner', firstName: 'Rehearsal', lastName: `Fake${stamp}`, email: fake.email,
  sendEmail: false, password: fake.password, upsert: false,
}, admin.token);
const membership = inv.data?.id as string | undefined;
const practitionerRef = inv.data?.profile?.reference as string | undefined;
check('invite POST through proxy succeeds', inv.status === 200 && !!membership && !!practitionerRef?.startsWith('Practitioner/'),
  `HTTP ${inv.status}, ${inv.data?.resourceType ?? '?'}, ${practitionerRef ?? 'no profile'}`);

const prac = practitionerRef ? await json(PROXY, 'GET', `/fhir/R4/${practitionerRef}`, undefined, admin.token) : { status: 0, data: {} };
check('invited Practitioner readable through proxy /fhir', prac.status === 200 && prac.data.resourceType === 'Practitioner');

let invitedOk = false;
try { const u = await login(PROXY, fake.email, fake.password); invitedOk = !!u.token && u.projectId === admin.projectId; } catch (e) { console.log(String(e)); }
check('invited user can log in through proxy (same project)', invitedOk);

const members = await json(PROXY, 'GET', `/admin/projects/${admin.projectId}/members`, undefined, admin.token);
check('admin token still denied on non-invite admin route (proxy 404)', members.status === 404, `HTTP ${members.status}`);
const dup = await json(PROXY, 'POST', `/admin/projects/${admin.projectId}/invite`, {
  resourceType: 'Practitioner', firstName: 'Rehearsal', lastName: 'Dup', email: fake.email, sendEmail: false, password: fake.password, upsert: false,
}, admin.token);
check('duplicate invite is rejected by Medplum (not 2xx)', dup.status >= 400, `HTTP ${dup.status}`);

// cleanup on the DIRECT dev Medplum (invite itself never used it): remove membership + fake Practitioner
if (membership) {
  const d1 = await json(DIRECT, 'DELETE', `/admin/projects/${admin.projectId}/members/${membership}`, undefined, admin.token);
  console.log(`cleanup membership: HTTP ${d1.status}`);
  if (d1.status >= 300) failed = 1;
}
if (practitionerRef) {
  const d2 = await json(DIRECT, 'DELETE', `/fhir/R4/${practitionerRef}`, undefined, admin.token);
  console.log(`cleanup practitioner: HTTP ${d2.status}`);
  if (d2.status >= 300) failed = 1;
}
console.log(failed ? 'INVITE REHEARSAL FAIL' : 'INVITE REHEARSAL OK');
process.exit(failed);
