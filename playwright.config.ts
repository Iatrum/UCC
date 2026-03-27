import { defineConfig, devices } from "@playwright/test";

const CLINIC_URL =
  process.env.EMR_CLINIC_URL || "https://apex-group.drhidayat.com";
const ADMIN_URL =
  process.env.EMR_ADMIN_URL || "https://admin.drhidayat.com";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  outputDir: "test-results",
  use: {
    headless: true,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    // ── Auth setup (runs once before all workflow tests) ────────────────
    {
      name: "auth-setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },

    // ── Clinic-context tests (dashboard, patients, consultation, orders) ─
    {
      name: "clinic",
      testMatch: /(?!admin)(?!credential-check)(?!emr-auth).*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: CLINIC_URL,
        storageState: "tests/e2e/.auth/clinic.json",
      },
      dependencies: ["auth-setup"],
    },

    // ── Admin-portal tests ──────────────────────────────────────────────
    {
      name: "admin",
      testMatch: /admin\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: ADMIN_URL,
        storageState: "tests/e2e/.auth/admin.json",
      },
      dependencies: ["auth-setup"],
    },

    // ── Lightweight smoke tests (no auth required) ──────────────────────
    {
      name: "smoke",
      testMatch: /(credential-check|emr-auth)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
