import { defineConfig } from '@playwright/test';
// Reports live OUTSIDE the app repo: files written inside it make the Next dev watcher reload pages mid-test.
const R = process.env.UCC_REPORTS || '/workspace/ai-logs/e2e-reports';
export default defineConfig({
  testDir: './tests', globalSetup: './global-setup.ts', workers: 1, fullyParallel: false, retries: 0,
  timeout: 15 * 60_000, expect: { timeout: 30_000 },
  outputDir: R + '/artifacts',
  reporter: [['list'], ['json', { outputFile: R + '/results.json' }], ['html', { outputFolder: R + '/html', open: 'never' }]],
  use: {
    storageState: '.secrets/state.json',
    baseURL: process.env.UCC_BASE_URL || 'http://localhost:3210',
    viewport: { width: 1440, height: 900 }, navigationTimeout: 240_000, actionTimeout: 45_000,
    screenshot: 'only-on-failure', trace: 'retain-on-failure', headless: true,
    launchOptions: process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {},
  },
});
