/**
 * Auth Setup — runs once before all workflow spec files.
 *
 * Logs in as both the clinic user and the admin user and persists the full
 * browser state (cookies + localStorage) so every downstream test starts
 * already authenticated.
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const CLINIC_URL =
  process.env.EMR_CLINIC_URL || "https://apex-group.drhidayat.com";
const ADMIN_URL =
  process.env.EMR_ADMIN_URL || "https://admin.drhidayat.com";

const CLINIC_EMAIL =
  process.env.CLINIC_EMAIL || "apex-group-admin@drhidayat.com";
const CLINIC_PASSWORD =
  process.env.CLINIC_PASSWORD || "ClinicUser!2026#";

const ADMIN_EMAIL =
  process.env.MEDPLUM_ADMIN_EMAIL || "support@drhidayat.com";
const ADMIN_PASSWORD =
  process.env.MEDPLUM_ADMIN_PASSWORD || "UccMedplum!2026#";

const AUTH_DIR = path.join(__dirname, ".auth");

// Ensure .auth directory exists
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

// ── Clinic user ────────────────────────────────────────────────────────────

setup("clinic user login", async ({ page }) => {
  await page.goto(`${CLINIC_URL}/login`, { waitUntil: "domcontentloaded" });

  // Verify we're on the login page
  await expect(
    page.getByRole("heading", { name: /welcome back/i })
  ).toBeVisible({ timeout: 15_000 });

  await page.fill("#email", CLINIC_EMAIL);
  await page.fill("#password", CLINIC_PASSWORD);
  await page.click('button[type="submit"]');

  // Clinic users land on /dashboard
  await page.waitForURL(`${CLINIC_URL}/dashboard`, { timeout: 20_000 });
  await expect(page).toHaveURL(`${CLINIC_URL}/dashboard`);

  await page.context().storageState({
    path: path.join(AUTH_DIR, "clinic.json"),
  });
});

// ── Admin user ─────────────────────────────────────────────────────────────

setup("admin user login", async ({ page }) => {
  // Admin logs in through any clinic subdomain; the app redirects them
  // to admin.drhidayat.com/admin once the isAdmin flag is detected.
  await page.goto(`${CLINIC_URL}/login`, { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { name: /welcome back/i })
  ).toBeVisible({ timeout: 15_000 });

  await page.fill("#email", ADMIN_EMAIL);
  await page.fill("#password", ADMIN_PASSWORD);
  await page.click('button[type="submit"]');

  // Admin is redirected to the admin subdomain
  await page.waitForURL(`${ADMIN_URL}/admin`, { timeout: 20_000 });
  await expect(page).toHaveURL(`${ADMIN_URL}/admin`);

  await page.context().storageState({
    path: path.join(AUTH_DIR, "admin.json"),
  });
});
