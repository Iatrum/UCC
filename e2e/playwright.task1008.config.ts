import { defineConfig } from '@playwright/test';

// This targeted run logs in within the spec and needs no global seeding or saved session.
export default defineConfig({
  testDir: './tests',
  testMatch: 'task1008-clinic-flow.spec.ts',
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 25_000 },
  outputDir: process.env.UCC_REPORTS || '/tmp/ucc-task1008-e2e',
  use: {
    baseURL: process.env.EMR_CLINIC_URL || process.env.UCC_BASE_URL || 'http://127.0.0.1:3210',
    actionTimeout: 25_000,
    navigationTimeout: 60_000,
    trace: 'off',
    screenshot: 'off',
    launchOptions: process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {},
  },
});
