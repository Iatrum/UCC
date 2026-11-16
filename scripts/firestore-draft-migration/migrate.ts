#!/usr/bin/env bun
// Task 365: migrate legacy Firestore treatment-plan drafts into the Medplum unsigned-draft store (PR #235).
// Plan: .ai/PLAN-firestore-draft-migration.md   Operator steps: .ai/RUNBOOK-firestore-draft-migration.md
//
// Dry-run is the default and writes nothing to Medplum:
//   bun scripts/firestore-draft-migration/migrate.ts --input <export.json> --clinic <clinicId>
// Apply (writes; one clinic per run; a manifest is saved for rollback):
//   bun scripts/firestore-draft-migration/migrate.ts --input <export.json> --clinic <clinicId> --apply
// Rollback of one apply run (dry-run unless --apply is added):
//   bun scripts/firestore-draft-migration/migrate.ts --rollback --manifest <manifest.json> --clinic <clinicId> [--apply]
//
// Options: --since <ISO date>  --owners <owners.json>  --limit <n>  --report <path>  --manifest <path>
//          --owner-from-encounter-author    (opt-in owner fallback, see the plan section 4)
//          --allow-remote-host <hostname>   (required for anything other than localhost:8113)
// Env: MEDPLUM_BASE_URL, MEDPLUM_CLIENT_ID, MEDPLUM_CLIENT_SECRET (a project-admin client; never printed).
//
// Never prints draft contents, names, patient ids, tokens or secrets. Console lines carry counts and hashed
// source ids only; the legacy document ids needed to build an owners file go to the 0600 --report file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MedplumClient, OperationOutcomeError, isGone, isNotFound } from '@medplum/core';
import {
  MANIFEST_FORMAT, PreconditionError, SafeError, assertAllowedBaseUrl, migrate, parseExport, rollback, summarize,
  type FhirClient, type Manifest, type Resource,
} from './core';

const fail = (message: string): never => { throw new SafeError(message); };
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs(argv: string[]) {
  const flags = new Set(['--apply', '--rollback', '--owner-from-encounter-author']);
  const values = new Set(['--input', '--clinic', '--since', '--owners', '--limit', '--report', '--manifest', '--allow-remote-host']);
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg in out) fail(`Repeated argument: ${arg}`);
    if (flags.has(arg)) out[arg] = true;
    else if (values.has(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) fail(`Missing value for ${arg}`);
      out[arg] = value;
    } else fail(`Unknown argument: ${arg}`);
  }
  return out;
}
/** Files that name patients or documents must live outside the repository and be private to the operator. */
function privatePath(value: string, label: string) {
  const resolved = path.resolve(value);
  if (resolved === REPO_ROOT || resolved.startsWith(REPO_ROOT + path.sep)) fail(`${label} must be outside the repository`);
  return resolved;
}
function writePrivate(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
}
function readJson(file: string, label: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fail(`Cannot read ${label}`); }
}

function fhirClient(medplum: MedplumClient): FhirClient {
  const fresh = { cache: 'no-cache' as const, headers: { 'X-Medplum': 'extended' } };
  return {
    async read(type, id) {
      try { return await medplum.readResource(type as 'Patient', id, fresh) as unknown as Resource; }
      catch (error) {
        if (error instanceof OperationOutcomeError && (isNotFound(error.outcome) || isGone(error.outcome))) return undefined;
        throw error;
      }
    },
    async search(type, params) {
      return await medplum.searchResources(type as 'DocumentReference', { ...params, _count: '5' }, fresh) as unknown as Resource[];
    },
    async create(resource, ifNoneExist) {
      return await medplum.createResourceIfNoneExist(resource as never, ifNoneExist) as unknown as Resource;
    },
    async update(resource, ifMatchVersion) {
      if (!ifMatchVersion) throw new PreconditionError('version required');
      try {
        return await medplum.updateResource(resource as never, { headers: { 'If-Match': `W/"${ifMatchVersion}"` } }) as unknown as Resource;
      } catch (error) {
        if (error instanceof OperationOutcomeError && error.outcome.issue?.some(issue => issue.code === 'conflict' ||
            /precondition/i.test(`${error.outcome.id} ${issue.details?.text}`))) {
          throw new PreconditionError('version moved');
        }
        throw error;
      }
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = args['--apply'] === true;
  const clinicId = typeof args['--clinic'] === 'string' ? args['--clinic'] : fail('--clinic <clinicId> is required (one clinic per run)');
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(clinicId)) fail('Invalid --clinic');
  const baseUrl = assertAllowedBaseUrl(process.env.MEDPLUM_BASE_URL || 'http://localhost:8113',
    typeof args['--allow-remote-host'] === 'string' ? args['--allow-remote-host'] : undefined);
  const clientId = process.env.MEDPLUM_CLIENT_ID, clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) fail('MEDPLUM_CLIENT_ID and MEDPLUM_CLIENT_SECRET are required');

  const medplum = new MedplumClient({ baseUrl: baseUrl.toString(), cacheTime: 0 });
  try { await medplum.startClientLogin(clientId!, clientSecret!); } catch { fail('Medplum client login failed'); }
  const client = fhirClient(medplum);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultDir = path.join(os.homedir(), 'ucc-migration', 'firestore-drafts');
  console.log(`Medplum: ${baseUrl.host}   clinic: ${clinicId}   mode: ${args['--rollback'] ? 'ROLLBACK' : 'MIGRATE'} ${apply ? 'APPLY (writes)' : 'dry-run (no writes)'}`);

  if (args['--rollback']) {
    const manifestPath = typeof args['--manifest'] === 'string' ? privatePath(args['--manifest'], '--manifest') : fail('--rollback needs --manifest <path>');
    const outcomes = await rollback(client, readJson(manifestPath, 'manifest') as Manifest, { clinicId, apply });
    for (const o of outcomes) console.log(`${o.source.slice(0, 12)}  ${o.action}:${o.reason}${o.applied ? ' (written)' : ''}`);
    console.log(JSON.stringify(summarize(outcomes), null, 2));
    if (outcomes.some(o => o.action === 'error')) process.exitCode = 2;
    return;
  }

  const inputPath = typeof args['--input'] === 'string' ? privatePath(args['--input'], '--input') : fail('--input <export.json> is required');
  const exported = parseExport(readJson(inputPath, 'export'));
  const since = typeof args['--since'] === 'string' ? new Date(args['--since']) : undefined;
  if (since && Number.isNaN(since.getTime())) fail('Invalid --since');
  const limit = typeof args['--limit'] === 'string' ? Number(args['--limit']) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) fail('Invalid --limit');
  const owners = typeof args['--owners'] === 'string'
    ? readJson(privatePath(args['--owners'], '--owners'), 'owners file') as Record<string, string> : undefined;
  if (owners && (typeof owners !== 'object' || Array.isArray(owners))) fail('Owners file must be an object of legacyDocumentId -> practitionerId');
  const manifestPath = privatePath(typeof args['--manifest'] === 'string' ? args['--manifest']
    : path.join(defaultDir, `manifest-${clinicId}-${stamp}.json`), '--manifest');
  if (apply && fs.existsSync(manifestPath)) fail('Manifest path already exists; choose a new one');

  console.log(`Export: ${exported.count} legacy documents, exported ${exported.exportedAt}`);
  const result = await migrate(client, exported.drafts, { clinicId, since, owners, apply, limit,
    ownerFromEncounterAuthor: args['--owner-from-encounter-author'] === true });
  for (const o of result.outcomes) {
    if (o.action !== 'skip') console.log(`${o.source.slice(0, 12)}  ${o.action}:${o.reason}${o.ownerSource ? `  owner:${o.ownerSource}` : ''}${o.applied ? ' (written)' : ''}`);
  }
  console.log(JSON.stringify(summarize(result.outcomes), null, 2));
  if (apply && result.manifest.length) {
    writePrivate(manifestPath, { format: MANIFEST_FORMAT, clinicId, createdAt: new Date().toISOString(), entries: result.manifest } satisfies Manifest);
    console.log(`Rollback manifest (${result.manifest.length} drafts): ${manifestPath}`);
  }
  if (typeof args['--report'] === 'string') {
    const reportPath = privatePath(args['--report'], '--report');
    writePrivate(reportPath, result.outcomes.map(({ source, legacyId, action, reason, applied, ownerSource, candidateOwner }) =>
      ({ source, legacyId, action, reason, applied, ownerSource, candidateOwner })));
    console.log(`Report with legacy document ids (private, delete after use): ${reportPath}`);
  }
  if (result.aborted) { console.error(`ABORTED: ${result.aborted}. Nothing further was written. See the runbook, section "If it aborts".`); process.exitCode = 3; }
  else if (result.outcomes.some(o => o.action === 'error')) process.exitCode = 2;
  if (!apply) console.log('Dry-run only. Re-run with --apply to write.');
}

main().catch(error => {
  // Unknown errors may embed resource bodies or tokens; print their type only.
  console.error(error instanceof SafeError ? `Error: ${error.message}` : `Failed (${error?.constructor?.name ?? 'unknown error'})`);
  process.exit(1);
});
