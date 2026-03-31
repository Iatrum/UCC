/**
 * Patient Lookup & Create Tests
 *
 * Covers:
 *  1. Patient list page loads and has a working search
 *  2. "New Patient" button is present and navigates correctly
 *  3. New patient form validates required fields
 *  4. Full happy-path: register a new patient and confirm the profile page loads
 *
 * Test patients are prefixed "[E2E]" and use a deterministic NRIC derived from
 * the test run timestamp so they never collide with real records.
 */

import { test, expect } from "@playwright/test";

// Unique suffix per test run (last 4 digits of ms timestamp)
const RUN_ID = String(Date.now()).slice(-4).padStart(4, "0");
const TEST_NAME = `E2E Test Patient ${RUN_ID}`;
// Valid Malaysian NRIC format: YYMMDD-SS-NNNN
// Using a clearly fake DOB (1990-01-01) + state code 01 + unique serial
const TEST_NRIC = `900101-01-${RUN_ID}`;
const TEST_PHONE = `0123456${RUN_ID}`;

async function selectGender(page: any, gender: "male" | "female") {
  const trigger = page.getByRole("combobox").first();
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await trigger.click();
  await page.keyboard.press("ArrowDown");
  if (gender === "female") {
    await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Enter");
}

// ── Patient list ─────────────────────────────────────────────────────────────

test.describe("Patient list", () => {
  test("page loads and shows a search input", async ({ page }) => {
    await page.goto("/patients", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: /^patients$/i })
    ).toBeVisible({ timeout: 15_000 });

    // Search / filter input — wait for client-side hydration
    const searchInput = page
      .getByPlaceholder(/search/i)
      .or(page.locator('input[type="search"]'))
      .or(page.locator('input[type="text"]').first());
    await expect(searchInput.first()).toBeVisible({ timeout: 15_000 });

    await page.screenshot({ path: "test-results/patients-list.png" });
  });

  test("New Patient button navigates to /patients/new", async ({ page }) => {
    await page.goto("/patients", { waitUntil: "domcontentloaded" });

    const newBtn = page
      .getByRole("link", { name: /new patient/i })
      .or(page.getByRole("button", { name: /new patient/i }))
      .or(page.getByRole("link", { name: /register/i }))
      .first();

    await expect(newBtn).toBeVisible({ timeout: 10_000 });
    await newBtn.click();

    await page.waitForURL(/\/patients\/new/, { timeout: 10_000 });
    expect(page.url()).toContain("/patients/new");
  });
});

// ── New patient form validation ──────────────────────────────────────────────

test.describe("New patient form", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/patients/new", { waitUntil: "domcontentloaded" });
  });

  test("shows the registration form with required fields", async ({ page }) => {
    await expect(
      page.getByText(/new patient registration/i).first()
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.getByLabel(/full name/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('input[name="nric"]').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("combobox").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByLabel(/contact number/i).first()).toBeVisible({ timeout: 5_000 });

    await page.screenshot({ path: "test-results/new-patient-form.png" });
  });

  test("submit without required fields shows validation errors", async ({
    page,
  }) => {
    // Click submit without filling anything
    await page.click('button[type="submit"]');

    // At least one error message should appear
    const errorMsg = page.locator('[class*="text-red"], [class*="destructive"]');
    await expect(errorMsg.first()).toBeVisible({ timeout: 5_000 });
  });

  test("invalid NRIC format is rejected", async ({ page }) => {
    await page.fill('[name="fullName"], input[placeholder*="full name"]', "Test User");
    await page.fill('[name="nric"], input[placeholder*="NRIC"]', "12345"); // too short
    await page.click('button[type="submit"]');

    // Error message wording varies — match any inline validation feedback
    const nricError = page
      .getByText(/invalid nric/i)
      .or(page.getByText(/invalid format/i))
      .or(page.getByText(/nric.*format/i))
      .or(page.locator('[class*="text-red"], [class*="destructive"]').filter({ hasText: /nric|format|id/i }).first());
    await expect(nricError.first()).toBeVisible({ timeout: 10_000 });
  });
});

// ── Full happy-path: register and view patient profile ───────────────────────

test.describe("Patient registration — happy path", () => {
  test("creates a new patient and lands on their profile", async ({ page }) => {
    await page.goto("/patients/new", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByText(/new patient registration/i).first()
    ).toBeVisible({ timeout: 15_000 });

    // Full Name
    await page.fill('[name="fullName"], input[placeholder*="full name"]', TEST_NAME);

    // NRIC — keep dashes; the form validates YYMMDD-SS-NNNN format
    const nricInput = page.locator('input[name="nric"]').first();
    await nricInput.fill(TEST_NRIC);

    // Date of Birth is auto-filled from NRIC; no interaction needed.

    // Gender (Shadcn Select — click trigger then option)
    await selectGender(page, "male");

    // Contact number
    await page.fill(
      'input[placeholder*="contact number"], input[placeholder*="phone"]',
      TEST_PHONE
    );

    await page.screenshot({ path: "test-results/new-patient-filled.png" });

    // Submit
    await page.click('button[type="submit"]:not([type="button"])');

    // After save: redirect to /patients/{id}
    await page.waitForURL(
      (url) => /\/patients\/[a-z0-9-]+$/.test(url.pathname) && !url.pathname.endsWith("/new"),
      { timeout: 20_000 }
    );
    expect(page.url()).toMatch(/\/patients\/(?!new$)[a-z0-9-]+$/);

    // Patient profile should show the name we registered
    await expect(
      page.getByRole("heading", { name: new RegExp(TEST_NAME, "i") }).first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("link", { name: /new consultation/i })
    ).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: "test-results/patient-profile.png" });
  });
});
