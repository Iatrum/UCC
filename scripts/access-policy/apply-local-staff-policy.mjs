import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { randomBytes, createHash } from 'node:crypto';

// No credentials, tokens, resource bodies, or server error objects may be logged.
class SafeError extends Error {}
const fail = (message) => { throw new SafeError(message); };
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9.-]{1,64}$/.test(value);
const desired = JSON.parse(fs.readFileSync(new URL('./ucc-local-staff-containment.json', import.meta.url)));
const backupRoot = '/workspace/ai-logs/task5/backup';
const grants = (member) => ({ accessPolicy: member.accessPolicy ?? null, access: member.access ?? null });

async function main() {
  const args = process.argv.slice(2);
  if (args.some((a) => !['--apply', '--rollback'].includes(a))) fail('Unknown argument');
  const apply = args.includes('--apply');
  const rollback = args.includes('--rollback');
  const base = new URL(process.env.MEDPLUM_BASE_URL || 'http://localhost:8113');
  if (!['http:', 'https:'].includes(base.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.port !== '8113' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) fail('Only localhost port 8113 is allowed');
  const projectId = process.env.TASK5_PROJECT_ID;
  const memberId = process.env.TASK5_MEMBERSHIP_ID;
  if (!validId(projectId) || !validId(memberId)) fail('Explicit TASK5_PROJECT_ID and TASK5_MEMBERSHIP_ID required');
  if (!process.env.TASK5_LOCAL_ADMIN_TOKEN && (!process.env.MEDPLUM_ADMIN_EMAIL || !process.env.MEDPLUM_ADMIN_PASSWORD)) fail('MEDPLUM_ADMIN_EMAIL and MEDPLUM_ADMIN_PASSWORD required');
  // Redirect refusal applies to login/code exchange as well as FHIR calls.
  const localFetch = (input, init) => {
    if (new URL(typeof input === 'string' || input instanceof URL ? input : input.url).origin !== base.origin) fail('Nonlocal request refused');
    return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) });
  };
  let token = process.env.TASK5_LOCAL_ADMIN_TOKEN;
  if (!token) {
    const verifier = randomBytes(32).toString('base64url');
    const loginResponse = await localFetch(new URL('auth/login', base), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: process.env.MEDPLUM_ADMIN_EMAIL, password: process.env.MEDPLUM_ADMIN_PASSWORD,
        codeChallenge: createHash('sha256').update(verifier).digest('base64url'), codeChallengeMethod: 'S256' })
    });
    if (!loginResponse.ok) fail(`Admin login failed (${loginResponse.status})`);
    const login = await loginResponse.json();
    if (!login.code) fail('Admin login code required');
    const tokenResponse = await localFetch(new URL('oauth2/token', base), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: login.code, code_verifier: verifier })
    });
    if (!tokenResponse.ok) fail('Admin token exchange failed');
    token = (await tokenResponse.json()).access_token;
    if (!token) fail('Admin token required');
  }
  async function request(relative, method = 'GET', body, headers = {}) {
    const url = new URL(relative, base);
    if (url.origin !== base.origin || !url.pathname.startsWith('/')) fail('Nonlocal request refused');
    const res = await localFetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/fhir+json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) fail(`Local request failed (${res.status})`);
    return res.json();
  }
  let lock;
  const lockFile = `${backupRoot}/apply.lock`;
  if (apply) {
    fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
    fs.chmodSync(backupRoot, 0o700);
    lock = fs.openSync(lockFile, 'wx', 0o600);
  }
  try {
    const me = await request('auth/me');
    // superAdmin projects are intentionally allowed; membership.admin is still required.
    if (!me.membership?.admin || me.project?.id !== projectId) fail('Expected admin of selected local project');
    const member = await request(`fhir/R4/ProjectMembership/${memberId}`);
    if (member.admin || member.project?.reference !== `Project/${projectId}` || !member.profile?.reference?.startsWith('Practitioner/')) fail('Expected non-admin staff in selected project');
    const file = `${backupRoot}/${projectId}-${memberId}.json`;
    const backup = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
    if (backup && (backup.projectId !== projectId || backup.memberId !== memberId || backup.membership?.id !== memberId || backup.membership?.project?.reference !== member.project.reference || backup.membership?.profile?.reference !== member.profile.reference || !validId(backup.policyId))) fail('Backup identity mismatch');
    const containmentGrants = (id) => ({ accessPolicy: { reference: `AccessPolicy/${id}` }, access: null });
    async function update(next) {
      if (!member.meta?.versionId) fail('Membership version required');
      await request(`fhir/R4/ProjectMembership/${memberId}`, 'PUT', next, { 'If-Match': `W/"${member.meta.versionId}"` });
    }
    if (rollback) {
      if (!backup) fail('Backup required for rollback');
      const original = grants(backup.membership);
      if (isDeepStrictEqual(grants(member), original)) { console.log('Already restored'); return; }
      if (!isDeepStrictEqual(grants(member), containmentGrants(backup.policyId))) fail('Grant drift; rollback refused');
      if (!apply) { console.log('Dry-run: rollback eligible; no writes'); return; }
      const restored = { ...member };
      for (const field of ['accessPolicy', 'access']) {
        if (original[field] === null) delete restored[field]; else restored[field] = original[field];
      }
      await update(restored);
      console.log('Restored original membership grants');
      return;
    }
    // Scan every page and compare exact names locally: no assumption about name search support.
    const matches = [];
    let next = 'fhir/R4/AccessPolicy?_count=100';
    const visited = new Set();
    while (next) {
      if (visited.has(next)) fail('Repeated policy page');
      visited.add(next);
      const bundle = await request(next);
      if (bundle.resourceType !== 'Bundle') fail('Expected policy search Bundle');
      for (const { resource } of bundle.entry || []) {
        if (resource?.resourceType === 'AccessPolicy' && resource.name === desired.name) matches.push(resource);
      }
      next = bundle.link?.find((link) => link.relation === 'next')?.url;
    }
    if (matches.length > 1) fail('Ambiguous policy name');
    let policy = matches[0];
    if (policy && (!validId(policy.id) || !isDeepStrictEqual(policy.resource, desired.resource) || Object.keys(policy).some((key) => !['resourceType', 'id', 'meta', 'name', 'resource'].includes(key)))) fail('Existing policy differs');
    if (backup && policy?.id !== backup.policyId) fail('Backup policy mismatch');
    if (policy && isDeepStrictEqual(grants(member), containmentGrants(policy.id))) { if (!backup) fail('Original backup required'); console.log('Already applied'); return; }
    if (member.accessPolicy || member.access?.length) fail('Existing access grants require separate review');
    if (backup && !isDeepStrictEqual(grants(member), grants(backup.membership))) fail('Original grants changed');
    if (!apply) { console.log('Dry-run: eligible local staff membership; no writes'); return; }
    if (!policy) policy = await request('fhir/R4/AccessPolicy', 'POST', desired);
    if (!validId(policy.id) || !isDeepStrictEqual(policy.resource, desired.resource)) fail('Unexpected created policy');
    if (!backup) fs.writeFileSync(file, JSON.stringify({ projectId, memberId, policyId: policy.id, membership: member }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    const updated = { ...member, accessPolicy: { reference: `AccessPolicy/${policy.id}` } };
    delete updated.access;
    await update(updated);
    console.log('Applied local staff containment');
  } finally { if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(lockFile); } }
}
main().catch((error) => { if (error instanceof SafeError) console.error(error.message); console.error('Stopped safely; check local configuration, grants, and private backup without printing secrets or response bodies'); process.exitCode = 1; });
