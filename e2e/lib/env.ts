import fs from 'node:fs'; import path from 'node:path';
export const BASE = process.env.UCC_BASE_URL || 'http://localhost:3210';
export const MEDPLUM = process.env.MEDPLUM_URL || 'http://localhost:8113/';
export const USER = process.env.UCC_USER || 'doctor@ucc.local';
export const PASSWORD = process.env.UCC_PASSWORD || fs.readFileSync(path.join(import.meta.dirname, '../.secrets/pw'), 'utf8').trim();
export const MEDPLUM_ADMIN = { email: process.env.MEDPLUM_ADMIN_EMAIL || 'admin@example.com', password: process.env.MEDPLUM_ADMIN_PASSWORD || 'medplum_admin' };
export const EVIDENCE = process.env.UCC_EVIDENCE || '/workspace/iatrum-ucc-evidence/e2e';
// Minute granularity collided when two gates ran in the same minute against the shared dev Medplum (two queue rows with one name): add seconds + a numeric random tail (api.spec derives an NRIC from RUN digits).
export const RUN = process.env.UCC_RUN_ID || new Date().toISOString().replace(/[-:T.Z]/g, '').slice(4, 14) + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
fs.mkdirSync(EVIDENCE, { recursive: true });
