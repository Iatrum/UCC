#!/usr/bin/env bun
// Task 365: READ-ONLY export of the legacy Firestore collection `consultation_treatment_plans` to a private JSON
// file that migrate.ts consumes. This is the only script in this task that talks to Firebase, it only ever calls
// collection.get(), and it is run by the operator on production (see .ai/RUNBOOK-firestore-draft-migration.md).
// It has never been run against a real Firebase project by an AI agent.
//
//   bun scripts/firestore-draft-migration/export-firestore.ts --project <firebaseProjectId> --out <path outside repo>
//
// Credentials: the same env the app uses (FIREBASE_SERVICE_ACCOUNT, or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL +
// FIREBASE_PRIVATE_KEY). --project must equal the credential's project id, so a wrong env file cannot be exported
// by accident. The output contains treatment drafts tied to patient ids: it is written 0600 and must be deleted
// after the migration is verified.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPORT_FORMAT, LEGACY_COLLECTION, toExportRecord, type ExportFile } from './core';

const fail = (message: string): never => { console.error(`Error: ${message}`); process.exit(1); };
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function credentialFromEnv(): { projectId?: string; clientEmail?: string; privateKey?: string } {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    try {
      const parsed = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
      return { projectId: parsed.project_id, clientEmail: parsed.client_email, privateKey: String(parsed.private_key || '').replace(/\\n/g, '\n') };
    } catch { fail('FIREBASE_SERVICE_ACCOUNT is not valid JSON or base64 JSON'); }
  }
  return { projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') };
}

async function main() {
  const argv = process.argv.slice(2);
  const given: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--project', '--out'].includes(argv[i]) || !argv[i + 1] || argv[i] in given) fail('Usage: --project <id> --out <path>');
    given[argv[i]] = argv[i + 1];
  }
  const value = (flag: string) => given[flag];
  const project = value('--project') || fail('--project <firebaseProjectId> is required');
  const out = path.resolve(value('--out') || fail('--out <path> is required'));
  if (out === REPO_ROOT || out.startsWith(REPO_ROOT + path.sep)) fail('--out must be outside the repository');
  if (fs.existsSync(out)) fail('--out already exists; choose a new path');
  const credential = credentialFromEnv();
  if (!credential.projectId || !credential.clientEmail || !credential.privateKey) fail('Firebase service-account credentials are not set');
  if (credential.projectId !== project) fail('--project does not match the credential project id');

  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const app = initializeApp({ credential: cert(credential as never) }, 'task-365-readonly-export');
  const snapshot = await getFirestore(app).collection(LEGACY_COLLECTION).get(); // read-only
  const drafts = snapshot.docs.map(doc => toExportRecord(doc.id, doc.data()));
  const file: ExportFile = { format: EXPORT_FORMAT, collection: LEGACY_COLLECTION, exportedAt: new Date().toISOString(), count: drafts.length, drafts };
  fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
  fs.writeFileSync(out, JSON.stringify(file), { mode: 0o600, flag: 'wx' });
  const nonEmpty = drafts.filter(d => Array.isArray(d.entries) && d.entries.length > 0).length;
  console.log(`Exported ${drafts.length} documents (${nonEmpty} with at least one entry) from ${LEGACY_COLLECTION} to ${out}`);
  console.log('Firestore was only read. Delete the export file once the migration is verified.');
}
main().catch(error => { console.error(`Export failed (${error?.constructor?.name ?? 'unknown error'})`); process.exit(1); });
