#!/usr/bin/env bun
// Task 130 / isolation-phase2 (local fake-data validation only): migrate an existing non-admin ProjectMembership that has NO
// accessPolicy and NO access[] (Medplum's legacy full-access fallback) onto
// the real "UCC Clinic Staff Policy", with one access[] entry per clinic the
// corresponding Practitioner has an active PractitionerRole for.
//
// Full plan, merged Task 100 prerequisites, and rollout/rollback rationale: .ai/PLAN-isolation-phase2.md.
// Do not run --apply before that plan's Step 0 preconditions are all true.
//
// Dry-run (default, no write, no credentials required beyond read access):
//   bun scripts/access-policy/migrate-staff-membership.mjs
//     -> surveys every eligible membership, prints membership references + the
//        clinic(s) it would be migrated to, and the live policy's parameter
//        discovery check (fails closed on any %token this script can't build).
//   bun scripts/access-policy/migrate-staff-membership.mjs --membership <id>
//     -> same, scoped to one membership (what --apply will do, without writing).
//
// Apply (one membership per invocation, never "all"):
//   MEDPLUM_ADMIN_EMAIL=... MEDPLUM_ADMIN_PASSWORD=... \
//     bun scripts/access-policy/migrate-staff-membership.mjs --apply --membership <id>
//
// Rollback (restores the exact original accessPolicy/access from the backup
// this script wrote before its own --apply):
//   MEDPLUM_ADMIN_EMAIL=... MEDPLUM_ADMIN_PASSWORD=... \
//     bun scripts/access-policy/migrate-staff-membership.mjs --apply --rollback --membership <id>
//
// Safety, matching the existing scripts/access-policy/*.mjs family:
// - localhost:8113 only, no path/query/credentials in MEDPLUM_BASE_URL.
// - --apply requires --membership <id> (exactly one; there is no "migrate
//   everything" mode -- that is deliberate, see the plan's Step 6).
// - Per-membership JSON backup outside the repo (0600) before any write;
//   --rollback refuses unless the live grants still exactly match what this
//   script itself wrote.
// - Exclusive lock file for the duration of an --apply run.
// - Refuses any membership that already has a non-empty accessPolicy/access
//   -- this script only ever adds the clinic policy to a currently-unpoliced
//   membership, never edits or replaces an existing one.
// - Refuses to build access[] if the live policy references a %parameter
//   this script has no builder for, rather than silently writing an
//   incomplete entry (see KNOWN_PARAMETER_BUILDERS below).
// - Never logs resource bodies, names, tokens, or passwords. A membership may
//   intentionally be unpolicied; operator review is required before each apply.
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { randomBytes, createHash } from 'node:crypto';

class SafeError extends Error {}
const fail = (message) => { throw new SafeError(message); };
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9.-]{1,64}$/.test(value);
const refId = (reference) => reference?.split('/')?.[1];

const CLINIC_POLICY_NAME = 'UCC Clinic Staff Policy';
const CLINIC_IDENTIFIER_SYSTEM = 'clinic';
const BACKUP_ROOT = '/workspace/ai-logs/task-isolation-phase2/backup';

// Every %token this script knows how to turn into an access[].parameter
// entry. If the live policy's criteria/writeConstraint reference a token not
// listed here, the script fails closed (see discoverRequiredTokens) instead
// of writing an access[] entry that silently omits a parameter a newer
// policy depends on. clinicWriteAccounts mirrors the anchored, dot-escaped
// regex union lib/fhir/admin-service.ts's withClinicMembershipAccess builds
// across every clinic on the SAME membership (not just the current entry) --
// confirmed by reading that helper; duplicated here rather than imported, see
// .ai/PLAN-isolation-phase2.md section 3 for why this script stays import-free.
const KNOWN_PARAMETER_BUILDERS = new Set(['clinicAccount', 'clinicOrganization', 'clinicWriteAccounts']);

function escapeForRegex(id) {
  return id.replace(/\./g, '[.]');
}

function buildParametersForClinic(clinic, allClinicAccountRefs) {
  const writeAccounts = '^(' + [...new Set(allClinicAccountRefs)].sort().map(escapeForRegex).join('|') + ')$';
  return [
    { name: 'clinicAccount', valueReference: { reference: clinic.accountRef } },
    { name: 'clinicOrganization', valueReference: { reference: clinic.organizationRef } },
    { name: 'clinicWriteAccounts', valueString: writeAccounts },
  ];
}

async function main() {
  const args = process.argv.slice(2);
  const known = new Set(['--apply', '--rollback', '--membership']);
  if (args.filter(a => a === '--membership').length > 1) fail('Exactly one --membership is allowed');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--membership') { if (!validId(args[++i])) fail('Invalid --membership id'); continue; }
    if (!known.has(args[i])) fail(`Unknown argument: ${args[i]}`);
  }
  const apply = args.includes('--apply');
  const rollback = args.includes('--rollback');
  const membershipFlagIndex = args.indexOf('--membership');
  const membershipArg = membershipFlagIndex >= 0 ? args[membershipFlagIndex + 1] : undefined;
  if (apply && !validId(membershipArg)) fail('--apply requires an explicit --membership <id> (exactly one; no bulk mode)');
  if (rollback && !apply) fail('--rollback only makes sense together with --apply');
  if (membershipArg !== undefined && !validId(membershipArg)) fail('Invalid --membership id');

  const base = new URL(process.env.MEDPLUM_BASE_URL || 'http://localhost:8113');
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) ||
    base.port !== '8113' || base.username || base.password ||
    base.pathname !== '/' || base.search || base.hash
  ) fail('Only localhost Medplum on port 8113 is allowed');

  if (apply && (!process.env.MEDPLUM_ADMIN_EMAIL || !process.env.MEDPLUM_ADMIN_PASSWORD)) {
    fail('MEDPLUM_ADMIN_EMAIL and MEDPLUM_ADMIN_PASSWORD required for --apply');
  }

  const localFetch = (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? input : input.url;
    if (new URL(url).origin !== base.origin) fail('Nonlocal request refused');
    return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) });
  };

  let token;
  async function login() {
    if (!process.env.MEDPLUM_ADMIN_EMAIL || !process.env.MEDPLUM_ADMIN_PASSWORD) fail('Admin credentials required');
    const verifier = randomBytes(32).toString('base64url');
    const loginRes = await localFetch(new URL('auth/login', base), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.MEDPLUM_ADMIN_EMAIL, password: process.env.MEDPLUM_ADMIN_PASSWORD,
        codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
        codeChallengeMethod: 'S256',
      }),
    });
    if (!loginRes.ok) fail(`Admin login failed (${loginRes.status})`);
    const loginJson = await loginRes.json();
    if (!loginJson.code) fail('Admin login code required');
    const tokenRes = await localFetch(new URL('oauth2/token', base), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: loginJson.code, code_verifier: verifier }),
    });
    if (!tokenRes.ok) fail('Admin token exchange failed');
    const tok = await tokenRes.json();
    if (!tok.access_token) fail('Admin token required');
    token = tok.access_token;
  }

  async function request(relative, method = 'GET', body, extraHeaders = {}) {
    const url = new URL(relative, base);
    if (url.origin !== base.origin || !url.pathname.startsWith('/')) fail('Nonlocal request refused');
    const headers = { 'Content-Type': 'application/fhir+json', ...extraHeaders };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await localFetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json().catch(() => undefined);
    return { status: res.status, json };
  }

  async function searchAll(relativeStart) {
    const results = [];
    let next = relativeStart;
    const visited = new Set();
    while (next) {
      if (visited.has(next)) fail('Repeated search page');
      visited.add(next);
      const { status, json } = await request(next);
      if (status !== 200 || json?.resourceType !== 'Bundle') fail(`Search failed (${status})`);
      for (const entry of json.entry ?? []) if (entry.resource) results.push(entry.resource);
      next = json.link?.find((l) => l.relation === 'next')?.url;
      if (next && new URL(next, base).origin !== base.origin) fail('Nonlocal pagination refused');
    }
    return results;
  }

  if (apply) await login();

  // --- Discover every %token the live policy actually depends on today, and
  // refuse to proceed if it depends on one this script has no builder for.
  async function discoverRequiredTokens() {
    // Scan every page and compare exact names locally, same caution
    // apply-local-staff-policy.mjs already takes: no assumption that the
    // server supports a `name` search parameter on AccessPolicy.
    const all = await searchAll('fhir/R4/AccessPolicy?_count=100');
    const named = all.filter((p) => p.name === CLINIC_POLICY_NAME);
    if (named.length === 0) fail(`AccessPolicy "${CLINIC_POLICY_NAME}" not found -- run scripts/setup-access-policies.ts first`);
    if (named.length > 1) fail('Ambiguous clinic policy name');
    const policy = named[0];
    if (!validId(policy.id)) fail('Clinic policy id invalid');
    const tokens = new Set();
    for (const match of JSON.stringify(policy.resource ?? []).matchAll(/%([A-Za-z][A-Za-z0-9]*)/g)) tokens.add(match[1]);
    // The installed repository binds these variables during write evaluation.
    const runtimeVariables = new Set(['before', 'after', 'profile', 'patient']);
    const unknown = [...tokens].filter((t) => !KNOWN_PARAMETER_BUILDERS.has(t) && !runtimeVariables.has(t));
    if (unknown.length) fail(`Live policy references unsupported parameter(s): ${unknown.join(', ')} -- extend KNOWN_PARAMETER_BUILDERS and review before running`);
    if (!tokens.has('clinicWriteAccounts')) fail('Live policy lacks merged Task 100 write containment; refresh the local clinic policy first');
    for (const type of ['Encounter', 'Observation', 'ServiceRequest']) {
      const rules = policy.resource?.filter(r => r.resourceType === type) ?? [];
      if (!rules.some(r => r.interaction?.includes('create') && r.readonlyFields?.includes('meta') && r.writeConstraint?.some(c => c.expression?.includes('%clinicWriteAccounts'))) ||
          !rules.some(r => r.interaction?.includes('update') && r.writeConstraint?.some(c => c.expression?.includes('%before') && c.expression?.includes('%after')))) {
        fail(`Live ${type} rules lack merged write guards`);
      }
    }
    console.log('Live policy parameters and Task 100 write guards verified');
    return { policyId: policy.id, policyReference: `AccessPolicy/${policy.id}`, tokens };
  }

  // --- Resolve a Practitioner's active clinics: PractitionerRole -> Organization -> clinic identifier -> HealthcareService account.
  async function resolveClinicsForPractitioner(practitionerId) {
    const roles = await searchAll(`fhir/R4/PractitionerRole?practitioner=Practitioner/${practitionerId}&active=true&_count=100`);
    if (roles.some(r => !/^Organization\/[A-Za-z0-9.-]{1,64}$/.test(r.organization?.reference ?? ''))) fail('Active role has no valid clinic organization reference');
    const organizationIds = [...new Set(roles.map((r) => refId(r.organization.reference)))];
    const clinics = [];
    const unresolved = [];
    for (const orgId of organizationIds.sort()) {
      if (!validId(orgId)) fail('Invalid clinic organization reference');
      const { status, json: organization } = await request(`fhir/R4/Organization/${orgId}`);
      const clinicId = status === 200 ? organization?.identifier?.find((i) => i.system === CLINIC_IDENTIFIER_SYSTEM)?.value : undefined;
      if (!clinicId) { unresolved.push(`Organization/${orgId} (no clinic identifier or not found)`); continue; }
      const { status: hsStatus, json: hsBundle } = await request(
        `fhir/R4/HealthcareService?identifier=${CLINIC_IDENTIFIER_SYSTEM}|${encodeURIComponent(clinicId)}&_count=2`
      );
      const accounts = hsStatus === 200 ? (hsBundle?.entry ?? []).map((e) => e.resource) : [];
      if (accounts.length !== 1 || !validId(accounts[0]?.id) || accounts[0].providedBy?.reference !== `Organization/${orgId}`) { unresolved.push(`clinic '${clinicId}' (expected exactly one HealthcareService account, found ${accounts.length})`); continue; }
      clinics.push({
        clinicId,
        organizationRef: `Organization/${orgId}`,
        accountId: accounts[0].id,
        accountRef: `HealthcareService/${accounts[0].id}`,
      });
    }
    return { clinics, unresolved };
  }

  function grants(member) {
    return { accessPolicy: member.accessPolicy ?? null, access: member.access ?? null };
  }

  async function survey(projectId, onlyMembershipId) {
    const { policyReference } = await discoverRequiredTokens();
    const memberships = await searchAll(`fhir/R4/ProjectMembership?project=Project/${projectId}&_count=500`);
    let eligibleCount = 0;
    let unresolvedCount = 0;
    for (const member of memberships) {
      if (onlyMembershipId && member.id !== onlyMembershipId) continue;
      if (member.project?.reference !== `Project/${projectId}` || member.admin) continue;
      if (!member.profile?.reference?.startsWith('Practitioner/')) continue;
      if (member.accessPolicy || member.access?.length) {
        if (onlyMembershipId) {
          const { clinics, unresolved } = await resolveClinicsForPractitioner(refId(member.profile.reference));
          const expected = clinics.map(clinic => ({ policy: { reference: policyReference }, parameter: buildParametersForClinic(clinic, clinics.map(c => c.accountRef)) }));
          if (unresolved.length || !clinics.length || member.accessPolicy || !isDeepStrictEqual(member.access, expected)) fail('Membership has different existing grants; review by hand');
          console.log('Membership already has the expected policy');
          return;
        }
        continue;
      }
      eligibleCount += 1;
      const practitionerId = refId(member.profile.reference);

      const { clinics, unresolved } = await resolveClinicsForPractitioner(practitionerId);
      if (unresolved.length || !clinics.length) unresolvedCount += 1;
      console.log(`ProjectMembership/${member.id} (${member.profile.reference})`);
      if (clinics.length) {
        console.log(`  would migrate to policy ${policyReference}, clinics: ${clinics.map((c) => c.clinicId).join(', ')}`);
        console.log(JSON.stringify({ access: clinics.map(clinic => ({ policy: { reference: policyReference }, parameter: buildParametersForClinic(clinic, clinics.map(c => c.accountRef)) })) }));
      }
      if (unresolved.length) console.log(`  UNRESOLVED (will refuse --apply until fixed): ${unresolved.join('; ')}`);
      if (!clinics.length && !unresolved.length) console.log('  no active PractitionerRole found -- nothing to migrate, needs operator decision');
    }
    console.log(`Eligible (non-admin, no existing accessPolicy/access) memberships found: ${eligibleCount}`);
    if (unresolvedCount) fail(`Unresolved clinic assignments for ${unresolvedCount} membership(s); operator review required`);
    if (eligibleCount === 0 && onlyMembershipId) fail('Membership not eligible: missing, admin, non-Practitioner profile, or already has grants');
  }

  async function applyOne(membershipId) {
    const me = await request('auth/me');
    if (me.status !== 200 || !me.json?.membership?.admin) fail('Expected admin of selected local project');
    const projectId = me.json.project?.id;
    if (!validId(projectId)) fail('Project id invalid');

    const { status: memberStatus, json: member } = await request(`fhir/R4/ProjectMembership/${membershipId}`);
    if (memberStatus !== 200) fail('ProjectMembership not found');
    if (member.admin || member.project?.reference !== `Project/${projectId}` || !member.profile?.reference?.startsWith('Practitioner/')) {
      fail('Expected a non-admin staff membership in the selected project');
    }

    fs.mkdirSync(BACKUP_ROOT, { recursive: true, mode: 0o700 });
    fs.chmodSync(BACKUP_ROOT, 0o700);
    const lockFile = `${BACKUP_ROOT}/apply.lock`;
    let lock;
    try { lock = fs.openSync(lockFile, 'wx', 0o600); }
    catch { fail('Another apply run is in progress (apply.lock present)'); }

    try {
      const backupFile = `${BACKUP_ROOT}/${projectId}-${membershipId}.json`;
      const backup = fs.existsSync(backupFile) ? JSON.parse(fs.readFileSync(backupFile, 'utf8')) : undefined;
      if (backup && (backup.projectId !== projectId || backup.membershipId !== membershipId)) fail('Backup identity mismatch');

      // Rollback must remain available even if the policy was changed or removed.
      if (rollback) {
        if (!backup) fail('Backup required for rollback');
        const original = grants(backup.membership);
        if (isDeepStrictEqual(grants(member), original)) { console.log('Already restored'); return; }
        if (!isDeepStrictEqual(grants(member), { accessPolicy: null, access: backup.writtenAccess })) fail('Grant drift since this script wrote it; rollback refused');
        const restored = { ...member };
        for (const field of ['accessPolicy', 'access']) {
          if (original[field] === null) delete restored[field]; else restored[field] = original[field];
        }
        if (!member.meta?.versionId) fail('Membership version required');
        const { status: restoreStatus } = await request(`fhir/R4/ProjectMembership/${membershipId}`, 'PUT', restored, { 'If-Match': `W/"${member.meta.versionId}"` });
        if (restoreStatus !== 200) fail(`Rollback write failed (${restoreStatus})`);
        const verified = await request(`fhir/R4/ProjectMembership/${membershipId}`);
        if (verified.status !== 200 || !isDeepStrictEqual(grants(verified.json), original)) fail('Rollback read-back mismatch');
        console.log('Restored original membership grants');
        return;
      }

      const { policyReference } = await discoverRequiredTokens();
      if (member.accessPolicy || member.access?.length) fail('Membership already has grants -- out of scope for this script, review by hand');
      if (backup) fail('A backup already exists for this membership but it is not currently migrated -- investigate before re-running');

      const practitionerId = refId(member.profile.reference);
      const { clinics, unresolved } = await resolveClinicsForPractitioner(practitionerId);
      if (unresolved.length) fail(`Cannot resolve every clinic for this practitioner: ${unresolved.join('; ')}`);
      if (!clinics.length) fail('No active PractitionerRole found -- not eligible for migration (needs an operator decision, not a default grant)');

      const allAccountRefs = clinics.map((c) => c.accountRef);
      const access = clinics.map((clinic) => ({
        policy: { reference: policyReference },
        parameter: buildParametersForClinic(clinic, allAccountRefs),
      }));

      console.log(`Would write access[] for ${clinics.length} clinic(s): ${clinics.map((c) => c.clinicId).join(', ')}`);
      fs.writeFileSync(backupFile, JSON.stringify({
        projectId, membershipId, membership: { accessPolicy: member.accessPolicy ?? null, access: member.access ?? null },
        writtenAccess: access,
      }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });

      const updated = { ...member, access };
      delete updated.accessPolicy;
      if (!member.meta?.versionId) fail('Membership version required');
      const { status: writeStatus } = await request(`fhir/R4/ProjectMembership/${membershipId}`, 'PUT', updated, { 'If-Match': `W/"${member.meta.versionId}"` });
      if (writeStatus !== 200) fail(`Migration write failed (${writeStatus}); backup already recorded at ${backupFile}`);
      const verified = await request(`fhir/R4/ProjectMembership/${membershipId}`);
      if (verified.status !== 200 || !isDeepStrictEqual(grants(verified.json), { accessPolicy: null, access })) fail('Migration read-back mismatch; inspect backup before continuing');
      console.log('Applied clinic staff policy to membership');
    } finally {
      fs.closeSync(lock);
      fs.unlinkSync(lockFile);
    }
  }

  if (!apply) {
    // Dry run: survey mode needs a project id, obtained from a read-only
    // auth/me on whatever credentials are available; if none, fall back to
    // requiring MEDPLUM_ADMIN_EMAIL/PASSWORD same as apply (a dry run still
    // needs to read ProjectMembership/PractitionerRole/Organization, which
    // are not publicly readable).
    if (!process.env.MEDPLUM_ADMIN_EMAIL || !process.env.MEDPLUM_ADMIN_PASSWORD) {
      fail('Dry run still needs read access: set MEDPLUM_ADMIN_EMAIL and MEDPLUM_ADMIN_PASSWORD');
    }
    await login();
    const me = await request('auth/me');
    if (me.status !== 200 || !me.json?.project?.id) fail('Could not resolve the current project');
    await survey(me.json.project.id, membershipArg);
    console.log('Dry run only; no writes were made.');
    return;
  }

  await applyOne(membershipArg);
}

main().catch((error) => {
  if (error instanceof SafeError) console.error(error.message);
  else console.error('Stopped; inspect locally without printing credentials or response bodies');
  process.exitCode = 1;
});
