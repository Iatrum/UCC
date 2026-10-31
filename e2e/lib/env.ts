import fs from 'node:fs'; import path from 'node:path';
export const BASE = process.env.UCC_BASE_URL || 'http://localhost:3210';
export const MEDPLUM = process.env.MEDPLUM_URL || 'http://localhost:8113/';
export const USER = process.env.UCC_USER || 'doctor@ucc.local';
export const PASSWORD = process.env.UCC_PASSWORD || fs.readFileSync(path.join(import.meta.dirname, '../.secrets/pw'), 'utf8').trim();
export const MEDPLUM_ADMIN = { email: process.env.MEDPLUM_ADMIN_EMAIL || 'admin@example.com', password: process.env.MEDPLUM_ADMIN_PASSWORD || 'medplum_admin' };
export const EVIDENCE = process.env.UCC_EVIDENCE || '/workspace/iatrum-ucc-evidence/e2e';
export const RUN = process.env.UCC_RUN_ID || new Date().toISOString().replace(/[-:T.Z]/g, '').slice(4, 12);
fs.mkdirSync(EVIDENCE, { recursive: true });
// Fake local POCT device key (git-ignored file, generated on the box). Sent as x-api-key.
export const POCT_KEY = (() => { try { return fs.readFileSync(path.join(import.meta.dirname, '../.secrets/poct_key'), 'utf8').trim(); } catch { return ''; } })();
