import { test, expect } from "@playwright/test";

const MEDPLUM_UI_URL =
  process.env.MEDPLUM_UI_URL || "https://app.31-97-70-30.sslip.io";
const EMR_URL = process.env.EMR_URL || "https://drhidayat.com";

const ADMIN_EMAIL =
  process.env.MEDPLUM_ADMIN_EMAIL || "support@drhidayat.com";
const ADMIN_PASSWORD =
  process.env.MEDPLUM_ADMIN_PASSWORD || "UccMedplum!2026#";

const CLINIC_USERS = [
  {
    email: "klinikputeri.1773494478187@drhidayat.com",
    password: process.env.KLINIK_PUTERI_PASSWORD || "KlinikPuteri!2026",
    label: "Klinik Puteri Admin",
  },
  {
    email: "apex-group-admin@drhidayat.com",
    password: process.env.CLINIC_USER_PASSWORD || "ClinicUser!2026#",
    label: "Apex Group Admin",
  },
  {
    email: "beacon-group-admin@drhidayat.com",
    password: process.env.CLINIC_USER_PASSWORD || "ClinicUser!2026#",
    label: "Beacon Group Admin",
  },
];

// ─── 1. Site health ───────────────────────────────────────────────────────────

test("drhidayat.com landing page loads", async ({ page }) => {
  const response = await page.goto(EMR_URL, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBeLessThan(400);
  await expect(page).toHaveTitle(/UCC EMR/i);
  await page.screenshot({ path: "test-results/site-landing.png" });
});

// ─── 2. EMR Staff login ───────────────────────────────────────────────────────

test("EMR staff login page is accessible", async ({ page }) => {
  await page.goto(`${EMR_URL}/login`, { waitUntil: "domcontentloaded" });
  // Accept either a login form or a redirect to /landing (unauthenticated redirect is fine)
  const url = page.url();
  expect(url).toMatch(/drhidayat\.com/);
  await page.screenshot({ path: "test-results/emr-login-page.png" });
});

// ─── 3. Medplum self-hosted UI ────────────────────────────────────────────────

test("Medplum self-hosted UI loads", async ({ page }) => {
  const response = await page.goto(`${MEDPLUM_UI_URL}/signin`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  expect(response?.status()).toBeLessThan(400);
  await page.screenshot({ path: "test-results/medplum-signin-page.png" });
});

test("Medplum admin login: support@drhidayat.com", async ({ page }) => {
  await page.goto(`${MEDPLUM_UI_URL}/signin`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });

  // Fill email
  const emailInput = page.locator('input[name="email"], input[type="email"]').first();
  await emailInput.waitFor({ state: "visible" });
  await emailInput.fill(ADMIN_EMAIL);

  // Fill password
  const passwordInput = page
    .locator('input[name="password"], input[type="password"]')
    .first();
  await passwordInput.fill(ADMIN_PASSWORD);

  await page.screenshot({ path: "test-results/medplum-admin-filled.png" });

  // Submit
  await page.locator('button[type="submit"]').click();

  // Wait for navigation away from signin
  await page.waitForURL((url) => !url.href.includes("/signin"), {
    timeout: 15_000,
  });

  await page.screenshot({ path: "test-results/medplum-admin-logged-in.png" });
  expect(page.url()).not.toContain("/signin");
});

// ─── 4. Clinic user logins ────────────────────────────────────────────────────

for (const user of CLINIC_USERS) {
  test(`Medplum clinic user login: ${user.label}`, async ({ page }) => {
    await page.goto(`${MEDPLUM_UI_URL}/signin`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    const emailInput = page
      .locator('input[name="email"], input[type="email"]')
      .first();
    await emailInput.waitFor({ state: "visible" });
    await emailInput.fill(user.email);

    const passwordInput = page
      .locator('input[name="password"], input[type="password"]')
      .first();
    await passwordInput.fill(user.password);

    await page.screenshot({
      path: `test-results/medplum-${user.label.replace(/\s+/g, "-").toLowerCase()}-filled.png`,
    });

    await page.locator('button[type="submit"]').click();

    await page.waitForURL((url) => !url.href.includes("/signin"), {
      timeout: 15_000,
    });

    await page.screenshot({
      path: `test-results/medplum-${user.label.replace(/\s+/g, "-").toLowerCase()}-logged-in.png`,
    });

    expect(page.url()).not.toContain("/signin");
  });
}
