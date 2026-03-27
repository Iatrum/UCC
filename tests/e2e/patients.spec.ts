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

// ── Patient list ─────────────────────────────────────────────────────────────

test.describe("Patient list", () => {
  test("page loads and shows a search input", async ({ page }) => {
    await page.goto("/patients", { waitUntil: "domcontentloaded" });

    // Heading or title
    await expect(
      page
        .getByRole("heading", { name: /patient/i })
        .or(page.getByText(/patient/i).first())
    ).toBeVisible({ timeout: 15_000 });

    // Search / filter input
    const searchInput = page
      .getByPlaceholder(/search/i)
      .or(page.locator('input[type="search"]'))
      .or(page.locator('input[type="text"]').first());
    await expect(searchInput.first()).toBeVisible();

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
      page.getByRole("heading", { name: /new patient registration/i })
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.getByLabel(/full name/i)).toBeVisible();
    await expect(page.getByLabel(/nric/i).first()).toBeVisible();
    await expect(page.getByLabel(/gender/i)).toBeVisible();
    await expect(page.getByLabel(/contact number/i)).toBeVisible();

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

    const nricError = page.getByText(/invalid nric/i);
    await expect(nricError).toBeVisible({ timeout: 5_000 });
  });
});

// ── Full happy-path: register and view patient profile ───────────────────────

test.describe("Patient registration — happy path", () => {
  test("creates a new patient and lands on their profile", async ({ page }) => {
    await page.goto("/patients/new", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: /new patient registration/i })
    ).toBeVisible({ timeout: 15_000 });

    // Full Name
    await page.fill('[name="fullName"], input[placeholder*="full name"]', TEST_NAME);

    // NRIC — the form auto-formats as user types
    const nricInput = page
      .getByLabel(/nric/i)
      .or(page.locator('input[placeholder*="NRIC"]'))
      .first();
    await nricInput.fill(TEST_NRIC.replace(/-/g, ""));

    // Date of Birth is auto-filled from NRIC; no interaction needed.

    // Gender (Shadcn Select — click trigger then option)
    await page.getByLabel(/gender/i).click();
    await page.getByRole("option", { name: /male/i }).first().click();

    // Contact number
    await page.fill(
      'input[placeholder*="contact number"], input[placeholder*="phone"]',
      TEST_PHONE
    );

    await page.screenshot({ path: "test-results/new-patient-filled.png" });

    // Submit
    await page.click('button[type="submit"]:not([type="button"])');

    // After save: redirect to /patients/{id}
    await page.waitForURL(/\/patients\/[a-z0-9-]+$/, { timeout: 20_000 });
    expect(page.url()).toMatch(/\/patients\/[a-z0-9-]+$/);

    // Patient profile should show the name we registered
    await expect(page.getByText(TEST_NAME)).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: "test-results/patient-profile.png" });
  });
});
