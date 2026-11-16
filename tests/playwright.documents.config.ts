import { loadEnvConfig } from '@next/env';
import { defineConfig } from '@playwright/test';
loadEnvConfig(process.cwd());
const medplumURL = new URL(process.env.MEDPLUM_BASE_URL || 'http://invalid');
if (!['localhost', '127.0.0.1'].includes(medplumURL.hostname) || medplumURL.port !== '8113') throw new Error('Document tests require the fake-data dev Medplum on port 8113');
const baseURL = process.env.UCC_BASE_URL || 'http://127.0.0.1:3218';
const url = new URL(baseURL);
if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Document tests require a local fake-data app');
export default defineConfig({
  testDir: './e2e', testMatch: 'issued-documents.spec.ts', timeout: 120_000,
  workers: 1, retries: 0, reporter: 'list', outputDir: '../test-results/documents',
  use: { baseURL, headless: true, launchOptions: { args: ['--disable-dev-shm-usage'] } },
});
