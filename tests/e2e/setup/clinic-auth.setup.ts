/**
 * Clinic authentication setup
 *
 * Logs in to the demo clinic once and persists the session cookie
 * to tests/e2e/.auth/demo.json so that all clinic tests can reuse it
 * without paying the login round-trip cost on every test.
 *
 * Run automatically as a dependency of the "clinic" project in playwright.config.ts.
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";
import { DEMO_CLINIC_URL, DEMO_CLINIC_EMAIL, DEMO_CLINIC_PASSWORD } from "../support/env";

const SESSION_FILE = path.join(__dirname, "../.auth/demo.json");

setup("authenticate as Demo staff", async ({ page }) => {
  const response = await page.request.post(`${DEMO_CLINIC_URL}/api/auth/login`, {
    data: {
      email: DEMO_CLINIC_EMAIL,
      password: DEMO_CLINIC_PASSWORD,
    },
    timeout: 30_000,
  });
  expect(response.ok()).toBeTruthy();

  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${DEMO_CLINIC_URL}/api/auth/me`, {
          headers: {
            Cookie: (await page.context().cookies())
              .map((cookie) => `${cookie.name}=${cookie.value}`)
              .join("; "),
          },
        });
        return res.status();
      },
      { timeout: 30_000, intervals: [1000, 2000, 3000] }
    )
    .toBe(200);

  await page.goto(`${DEMO_CLINIC_URL}/dashboard`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  // Confirm a dashboard element is visible (proves login was accepted)
  await expect(page).not.toHaveURL(/\/(login|landing)/);

  // Persist cookies + localStorage so tests can reuse the session
  await page.context().storageState({ path: SESSION_FILE });
});
