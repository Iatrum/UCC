#!/usr/bin/env bun
// Global User sessions, not clinical resources. Dry-run by default. See Task 5 runbook.
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

class RecoveryError extends Error {}
function requireTrue(ok, message) { if (!ok) throw new RecoveryError(message); }
const idPattern = /^[A-Za-z0-9-]{1,64}$/;

export async function revokeStaffSessions(options, env = process.env, fetcher = fetch) {
  const base = new URL(env.MEDPLUM_BASE_URL || 'http://127.0.0.1:8113');
  requireTrue(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password &&
    base.pathname === '/' && !base.search && !base.hash, 'Use a bare Medplum origin');
  const local = base.origin === 'http://127.0.0.1:8113';
  requireTrue(local || (base.protocol === 'https:' && options.allowRemote === base.origin), 'Remote origin requires explicit --allow-remote');
  requireTrue(idPattern.test(options.user || '') && idPattern.test(options.operatorProject || ''), 'Supply User and operator Project IDs');
  requireTrue(!options.verifyFakeSession || options.apply, 'Fake-session verification requires --apply');
  requireTrue(Boolean(env.MEDPLUM_ADMIN_EMAIL && env.MEDPLUM_ADMIN_PASSWORD), 'Supply operator credentials through hidden prompts');
  async function request(token, value, method = 'GET', body, headers = {}) {
    const url = new URL(value, base);
    // Dev advertises localhost in next links; all requests stay at 127.0.0.1.
    if (local && url.origin === 'http://localhost:8113') url.hostname = '127.0.0.1';
    requireTrue(url.origin === base.origin && !url.username && !url.password &&
      (url.pathname === '/auth/login' || url.pathname === '/oauth2/token' || url.pathname === '/auth/me' ||
       /^\/fhir\/R4\/Login(?:\/[A-Za-z0-9-]+)?$/.test(url.pathname)), 'Unsafe request or pagination link');
    const response = await fetcher(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'content-type': 'application/fhir+json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : body instanceof URLSearchParams ? body.toString() : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json().catch(() => undefined) };
  }
  async function signIn(email, password, project, offline = false) {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const auth = await request(null, '/auth/login', 'POST', { email, password, projectId: project,
      scope: offline ? 'openid offline_access' : 'openid', codeChallenge: crypto.createHash('sha256').update(verifier).digest('base64url'), codeChallengeMethod: 'S256' });
    requireTrue(auth.status === 200 && auth.json?.code, 'Login failed; check credentials/project or wait after HTTP 429');
    const tokens = await request(null, '/oauth2/token', 'POST', new URLSearchParams({
      grant_type: 'authorization_code', code: auth.json.code, code_verifier: verifier,
    }), { 'content-type': 'application/x-www-form-urlencoded' });
    requireTrue(tokens.status === 200 && tokens.json?.access_token, 'Token exchange failed');
    const me = await request(tokens.json.access_token, '/auth/me');
    requireTrue(me.status === 200 && me.json?.project?.id === project, 'Login identity/project check failed');
    return { ...tokens.json, me: me.json };
  }
  const operator = await signIn(env.MEDPLUM_ADMIN_EMAIL, env.MEDPLUM_ADMIN_PASSWORD, options.operatorProject);
  requireTrue(operator.me.project.superAdmin === true && operator.me.membership?.admin === true, 'Dedicated super-admin operator required');
  const userRef = `User/${options.user}`;
  requireTrue(operator.me.membership.user?.reference && operator.me.membership.user.reference !== userRef, 'Cannot revoke the recovery operator');
  let probe;
  if (options.verifyFakeSession) {
    requireTrue(Boolean(env.UCC_PROBE_EMAIL && env.UCC_PROBE_PASSWORD && env.UCC_PROBE_PROJECT), 'Supply disposable fake staff credentials and project');
    probe = await signIn(env.UCC_PROBE_EMAIL, env.UCC_PROBE_PASSWORD, env.UCC_PROBE_PROJECT, true);
    requireTrue(probe.me.membership?.user?.reference === userRef && probe.me.project.superAdmin !== true &&
      probe.me.membership.admin !== true && probe.refresh_token, 'Fake staff identity or refresh token check failed');
    // Prove refresh works before revocation and keep the rotated refresh token.
    const refreshed = await request(null, '/oauth2/token', 'POST', new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: probe.refresh_token,
    }), { 'content-type': 'application/x-www-form-urlencoded' });
    requireTrue(refreshed.status === 200 && refreshed.json?.refresh_token && refreshed.json?.access_token, 'Pre-revocation refresh failed');
    probe.rotated = refreshed.json;
  }
  async function inventory() {
    let next = `/fhir/R4/Login?user=${encodeURIComponent(userRef)}&_count=100`;
    const visited = new Set(), ids = new Set(), result = [];
    while (next) {
      const url = new URL(next, base);
      requireTrue(url.pathname === '/fhir/R4/Login', 'Unexpected pagination resource');
      requireTrue(!visited.has(url.href) && visited.size < 10000, 'Invalid pagination');
      visited.add(url.href);
      const page = await request(operator.access_token, url.href);
      requireTrue(page.status === 200 && page.json?.resourceType === 'Bundle' && page.json.type === 'searchset' &&
        (page.json.entry === undefined || Array.isArray(page.json.entry)) &&
        (page.json.link === undefined || Array.isArray(page.json.link)), 'Invalid Login search response');
      for (const entry of page.json.entry || []) {
        const login = entry.resource;
        requireTrue(login?.resourceType === 'Login' && idPattern.test(login.id || '') &&
          login.user?.reference === userRef && !ids.has(login.id) &&
          (login.revoked === undefined || typeof login.revoked === 'boolean') &&
          typeof login.meta?.versionId === 'string' && /^[A-Za-z0-9.-]+$/.test(login.meta.versionId), 'Unsafe Login search result');
        ids.add(login.id); result.push(login);
      }
      const links = (page.json.link || []).filter(l => l.relation === 'next');
      requireTrue(links.length <= 1 && (!links.length || typeof links[0].url === 'string' && links[0].url.length > 0), 'Invalid next link');
      next = links[0]?.url;
    }
    return { records: result, pages: visited.size };
  }
  const before = await inventory(); // Validate every page before the first write.
  const active = before.records.filter(login => login.revoked !== true);
  if (!options.apply) return { mode: 'PREVIEW', pages: before.pages, found: before.records.length, toRevoke: active.length };
  for (const login of active) {
    const saved = await request(operator.access_token, `/fhir/R4/Login/${login.id}`, 'PUT', { ...login, revoked: true },
      { 'If-Match': `W/"${login.meta.versionId}"` });
    requireTrue(saved.status === 200 && saved.json?.id === login.id && saved.json.revoked === true, 'Revocation failed; keep maintenance active and rerun preview (HTTP 412 means concurrent change)');
  }
  const after = await inventory();
  const afterIds = new Set(after.records.map(login => login.id));
  requireTrue(before.records.every(login => afterIds.has(login.id)) && after.records.every(login => login.revoked === true), 'Sessions missing or active/new sessions remain; keep new logins stopped and rerun');
  if (probe) {
    for (const token of [probe.access_token, probe.rotated.access_token]) {
      requireTrue((await request(token, '/auth/me')).status === 401, 'Old access token still works; keep maintenance active');
    }
    const refresh = await request(null, '/oauth2/token', 'POST', new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: probe.rotated.refresh_token,
    }), { 'content-type': 'application/x-www-form-urlencoded' });
    requireTrue(refresh.status === 400 && refresh.json?.error === 'invalid_grant', 'Refresh not rejected as revoked; keep maintenance active');
  }
  return { mode: 'APPLIED', pages: before.pages, found: before.records.length, revoked: active.length,
    fakeSessionVerified: Boolean(probe) };
}

export function parseOptions(args) {
  const options = {}, seen = new Set();
  const values = { '--user': 'user', '--operator-project': 'operatorProject', '--allow-remote': 'allowRemote' };
  const flags = { '--apply': 'apply', '--verify-fake-session': 'verifyFakeSession' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    requireTrue(!seen.has(arg), 'Repeated argument'); seen.add(arg);
    if (Object.hasOwn(flags, arg)) options[flags[arg]] = true;
    else {
      requireTrue(Object.hasOwn(values, arg) && args[i + 1] && !args[i + 1].startsWith('--'), 'Unknown argument or missing value');
      options[values[arg]] = args[++i];
    }
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await revokeStaffSessions(parseOptions(process.argv.slice(2))))); }
  catch (error) {
    console.error(`ERROR: ${error instanceof RecoveryError ? error.message : 'Session recovery stopped (network or invalid response)'}. Keep maintenance active; run preview after resolving the cause.`);
    process.exitCode = 2;
  }
}
