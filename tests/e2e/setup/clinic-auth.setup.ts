/**
 * Clinic authentication setup
 *
 * Logs in to klinikputeri.drhidayat.com once and persists the session cookie
 * to tests/e2e/.auth/klinikputeri.json so that all clinic tests can reuse it
 * without paying the login round-trip cost on every test.
 *
 * Run automatically as a dependency of the "clinic" project in playwright.config.ts.
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";
import { KLINIK_PUTERI_URL, KLINIK_PUTERI_EMAIL, KLINIK_PUTERI_PASSWORD } from "../support/env";

const SESSION_FILE = path.join(__dirname, "../.auth/klinikputeri.json");

setup("authenticate as Klinik Puteri staff", async ({ page }) => {
  await page.goto(`${KLINIK_PUTERI_URL}/login`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  // Fill and submit login form
  await page.locator('input[type="email"]').fill(KLINIK_PUTERI_EMAIL);
  await page.locator('input[type="password"]').fill(KLINIK_PUTERI_PASSWORD);
  await page.locator('button[type="submit"]').click();

  // Wait until we're no longer on /login
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 30_000,
  });

  // Confirm a dashboard element is visible (proves login was accepted)
  await expect(page).not.toHaveURL(/\/(login|landing)/);

  // Persist cookies + localStorage so tests can reuse the session
  await page.context().storageState({ path: SESSION_FILE });
});
