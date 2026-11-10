#!/usr/bin/env bun
// Task 090 Phase 1.4: backfill meta.accounts (the field the UCC Clinic Staff
// Policy's _compartment=%clinicAccount criteria actually matches on) for
// existing resources that predate the $set-accounts call on their own
// create/update path, or were created before that call existed.
//
// This is the sibling of scripts/backfill-clinic-identifiers.ts, which only
// ever sets the app-level `identifier: clinic|<slug>` field -- never calls
// $set-accounts. Running that script does NOT fix the gap this one closes,
// and running this one does not touch `identifier`. Either order, either
// independently; both are safe to re-run (idempotent).
//
// Dry-run by default:
//   bun scripts/access-policy/backfill-clinic-accounts.mjs
// Apply updates:
//   APPLY=true bun scripts/access-policy/backfill-clinic-accounts.mjs
//
// Safety: localhost:8113 only (same guard as apply-local-staff-policy.mjs);
// own admin login via MEDPLUM_ADMIN_EMAIL/MEDPLUM_ADMIN_PASSWORD; a write
// lock while APPLY=true so two runs can't race; never logs resource bodies,
// only resourceType/id/clinicId/counts.
import fs from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';

class SafeError extends Error {}
const fail = (message) => { throw new SafeError(message); };

const APPLY = process.env.APPLY === 'true';
const EVIDENCE_DIR = '/workspace/ai-logs/task90-phase1/backfill-accounts';

const base = new URL(process.env.MEDPLUM_BASE_URL || 'http://localhost:8113');
if (
  !['http:', 'https:'].includes(base.protocol) ||
  !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) ||
  base.port !== '8113' || base.username || base.password ||
  base.pathname !== '/' || base.search || base.hash
) fail('Only localhost Medplum on port 8113 is allowed');

const ADMIN_EMAIL = process.env.MEDPLUM_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.MEDPLUM_ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) fail('MEDPLUM_ADMIN_EMAIL and MEDPLUM_ADMIN_PASSWORD required');

const CLINIC_IDENTIFIER_SYSTEM = 'clinic';

// Every resource type the UCC Clinic Staff Policy scopes by
// _compartment=%clinicAccount (scripts/setup-access-policies.ts's
// clinicCompartmentRule list, plus Provenance added in Phase 1.1). Kept as a
// hand-maintained mirror, same as backfill-clinic-identifiers.ts's own
// RESOURCE_TYPES list -- if the policy's list changes, update both.
const RESOURCE_TYPES = [
  'Patient', 'Encounter', 'Observation', 'Condition', 'Procedure',
  'MedicationRequest', 'MedicationStatement', 'AllergyIntolerance',
  'ServiceRequest', 'DiagnosticReport', 'ImagingStudy', 'DocumentReference',
  'Appointment', 'Invoice', 'Task', 'Basic', 'ChargeItemDefinition',
  'Medication', 'Communication', 'QuestionnaireResponse', 'Schedule', 'Slot',
  'Provenance',
];

const localFetch = (url, init) => {
  if (new URL(url).origin !== base.origin) fail('Nonlocal request refused');
  return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) });
};

let token;
async function login() {
  const verifier = randomBytes(32).toString('base64url');
  const loginRes = await localFetch(new URL('auth/login', base), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: ADMIN_EMAIL, password: ADMIN_PASSWORD,
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

async function request(relative, method = 'GET', body) {
  const url = new URL(relative, base);
  if (url.origin !== base.origin || !url.pathname.startsWith('/')) fail('Nonlocal request refused');
  const res = await localFetch(url, {
    method,
    // X-Medplum: extended is required to see meta.accounts/meta.account on
    // reads at all (the server strips both from every non-extended
    // response, confirmed from the live container's bundled server source,
    // removeHiddenFields) -- without it this script can't tell an
    // already-stamped resource from an unstamped one.
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/fhir+json', 'X-Medplum': 'extended' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => undefined);
  return { status: res.status, json };
}

async function searchAll(resourceType, extraParams = '') {
  const results = [];
  let next = `fhir/R4/${resourceType}?_count=1000${extraParams}`;
  const visited = new Set();
  while (next) {
    if (visited.has(next)) fail('Repeated search page');
    visited.add(next);
    const { status, json } = await request(next);
    if (status !== 200 || json?.resourceType !== 'Bundle') fail(`Search failed for ${resourceType} (${status})`);
    for (const entry of json.entry ?? []) {
      if (entry.resource) results.push(entry.resource);
    }
    next = json.link?.find((l) => l.relation === 'next')?.url;
    if (next) next = next.replace(/^.*\/fhir\/R4\//, 'fhir/R4/');
  }
  return results;
}

const refId = (reference) => reference?.split('/')?.[1];
const hasAccounts = (resource) => Boolean(resource.meta?.accounts?.length || resource.meta?.account);
const clinicIdentifierOf = (resource) =>
  resource.identifier?.find((identifier) => identifier.system === CLINIC_IDENTIFIER_SYSTEM)?.value;

async function setAccounts(resourceType, id, accountRef) {
  const { status } = await request(`fhir/R4/${resourceType}/${id}/$set-accounts`, 'POST', {
    resourceType: 'Parameters',
    parameter: [
      { name: 'accounts', valueReference: { reference: accountRef } },
      { name: 'propagate', valueBoolean: resourceType === 'Patient' },
    ],
  });
  return status;
}

async function main() {
  await login();

  let lockFd;
  if (APPLY) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true, mode: 0o700 });
    try { lockFd = fs.openSync(`${EVIDENCE_DIR}/apply.lock`, 'wx', 0o600); }
    catch { fail('Another apply run is in progress (apply.lock present)'); }
  }

  try {
    // clinic identifier (slug) -> HealthcareService/<id> account reference.
    const healthcareServices = await searchAll('HealthcareService');
    const accountByClinic = new Map();
    for (const hs of healthcareServices) {
      const clinicId = clinicIdentifierOf(hs);
      if (clinicId && hs.id) accountByClinic.set(clinicId, `HealthcareService/${hs.id}`);
    }
    console.log(`clinics with a resolvable HealthcareService account: ${accountByClinic.size}`);

    // Same inference chain as backfill-clinic-identifiers.ts: own identifier
    // -> managingOrganization/serviceProvider -> encounter/basedOn/
    // imagingStudy reference walk -> patient/subject reference walk. Built
    // fresh here (not reused from the sibling script) because this script
    // backfills a different field and must not assume the identifier
    // backfill has already run.
    const patientClinic = new Map();
    const encounterClinic = new Map();
    const requestClinic = new Map();
    const studyClinic = new Map();

    const patients = await searchAll('Patient');
    for (const patient of patients) {
      const clinicId = clinicIdentifierOf(patient) || refId(patient.managingOrganization?.reference);
      if (patient.id && clinicId) patientClinic.set(patient.id, clinicId);
    }

    const encounters = await searchAll('Encounter');
    for (const encounter of encounters) {
      const patientId = refId(encounter.subject?.reference);
      const clinicId =
        clinicIdentifierOf(encounter) ||
        refId(encounter.serviceProvider?.reference) ||
        (patientId ? patientClinic.get(patientId) : undefined);
      if (encounter.id && clinicId) encounterClinic.set(encounter.id, clinicId);
    }

    const serviceRequests = await searchAll('ServiceRequest');
    for (const sr of serviceRequests) {
      const patientId = refId(sr.subject?.reference);
      const encounterId = refId(sr.encounter?.reference);
      const clinicId =
        clinicIdentifierOf(sr) ||
        (encounterId ? encounterClinic.get(encounterId) : undefined) ||
        (patientId ? patientClinic.get(patientId) : undefined);
      if (sr.id && clinicId) requestClinic.set(sr.id, clinicId);
    }

    const studies = await searchAll('ImagingStudy');
    for (const study of studies) {
      const patientId = refId(study.subject?.reference);
      const encounterId = refId(study.encounter?.reference);
      const basedOnId = refId(study.basedOn?.[0]?.reference);
      const clinicId =
        clinicIdentifierOf(study) ||
        (basedOnId ? requestClinic.get(basedOnId) : undefined) ||
        (encounterId ? encounterClinic.get(encounterId) : undefined) ||
        (patientId ? patientClinic.get(patientId) : undefined);
      if (study.id && clinicId) studyClinic.set(study.id, clinicId);
    }

    let checked = 0;
    let alreadyStamped = 0;
    let updated = 0;
    let unresolved = 0;
    const unresolvedDetail = [];

    for (const resourceType of RESOURCE_TYPES) {
      const resources = resourceType === 'Patient' ? patients
        : resourceType === 'Encounter' ? encounters
        : resourceType === 'ServiceRequest' ? serviceRequests
        : resourceType === 'ImagingStudy' ? studies
        : await searchAll(resourceType);

      for (const resource of resources) {
        checked += 1;
        if (hasAccounts(resource)) { alreadyStamped += 1; continue; }

        const patientId = refId(resource.subject?.reference) || refId(resource.patient?.reference);
        const encounterId = refId(resource.encounter?.reference) || refId(resource.context?.reference);
        const basedOnId = refId(resource.basedOn?.[0]?.reference);
        const studyId = refId(resource.imagingStudy?.[0]?.reference);
        const targetId = refId(resource.target?.[0]?.reference); // Provenance

        const clinicId =
          clinicIdentifierOf(resource) ||
          refId(resource.managingOrganization?.reference) ||
          refId(resource.serviceProvider?.reference) ||
          (encounterId ? encounterClinic.get(encounterId) : undefined) ||
          (basedOnId ? requestClinic.get(basedOnId) : undefined) ||
          (studyId ? studyClinic.get(studyId) : undefined) ||
          (patientId ? patientClinic.get(patientId) : undefined) ||
          // Provenance has no subject of its own -- resolve via whichever
          // target it audits, checking every map (type-agnostic on purpose,
          // target can be any clinical resource type).
          (targetId && (encounterClinic.get(targetId) || requestClinic.get(targetId) || studyClinic.get(targetId) || patientClinic.get(targetId)));

        const accountRef = clinicId ? accountByClinic.get(clinicId) : undefined;

        if (!accountRef) {
          unresolved += 1;
          unresolvedDetail.push(`${resourceType}/${resource.id} (clinicId=${clinicId ?? 'none'})`);
          continue;
        }

        updated += 1;
        console.log(`${APPLY ? 'Stamping' : 'Would stamp'} ${resourceType}/${resource.id} -> ${accountRef}`);
        if (APPLY) {
          const status = await setAccounts(resourceType, resource.id, accountRef);
          if (status !== 200) {
            unresolved += 1;
            updated -= 1;
            unresolvedDetail.push(`${resourceType}/${resource.id} ($set-accounts failed, status=${status})`);
          }
        }
      }
    }

    const summary = { checked, alreadyStamped, updated, unresolved, apply: APPLY };
    console.log(JSON.stringify(summary, null, 2));
    if (unresolvedDetail.length) {
      console.log('Unresolved (first 50):');
      for (const line of unresolvedDetail.slice(0, 50)) console.log(`  ${line}`);
    }
  } finally {
    if (lockFd !== undefined) {
      try { fs.closeSync(lockFd); } catch { /* best effort */ }
      try { fs.unlinkSync(`${EVIDENCE_DIR}/apply.lock`); } catch { /* best effort */ }
    }
  }
}

main().catch((error) => {
  if (error instanceof SafeError) console.error(error.message);
  else console.error('Stopped; inspect locally without printing credentials or response bodies');
  process.exitCode = 1;
});
