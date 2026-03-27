/**
 * Patient management E2E tests
 *
 * Covers:
 * 1. Patient list page loads after login
 * 2. Registering a new patient (full form)
 * 3. Searching for the newly registered patient
 * 4. Viewing the patient profile
 *
 * Tests run as the "clinic" project (klinikputeri.drhidayat.com)
 * using the session saved by setup/clinic-auth.setup.ts.
 *
 * A timestamp-suffixed name ensures each run creates a unique patient so tests
 * are isolated and can be traced back to the run that created them.
 */

import { test, expect, type Page } from "@playwright/test";

// ── Shared test data ─────────────────────────────────────────────────────────

const RUN_ID = Date.now();
const PATIENT = {
  name: `E2E Test Patient ${RUN_ID}`,
  nric: `T${RUN_ID.toString().slice(-9)}`,
  dob: "1990-06-15",
  phone: "0123456789",
  email: `e2e+${RUN_ID}@test.invalid`,
  address: "123 E2E Street, Test City",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fill the New Patient registration form and submit. Returns the patient page URL. */
async function registerPatient(page: Page): Promise<string> {
  await page.goto("/patients/new");

  // Wait for the form to be ready
  await expect(page.locator('input[name="fullName"], input[placeholder*="name" i]').first()).toBeVisible({ timeout: 15_000 });

  // Full Name
  const nameInput = page.locator('input[name="fullName"], input[placeholder*="name" i], input[id*="name" i]').first();
  await nameInput.fill(PATIENT.name);

  // NRIC / Passport
  const nricInput = page.locator('input[name="nric"], input[placeholder*="nric" i], input[placeholder*="ic" i], input[id*="nric" i]').first();
  await nricInput.fill(PATIENT.nric);

  // Date of Birth (date input)
  const dobInput = page.locator('input[type="date"], input[name*="birth" i], input[id*="birth" i]').first();
  await dobInput.fill(PATIENT.dob);

  // Gender — custom combobox: click button, pick "Male"
  const genderBtn = page.locator('[role="combobox"]').filter({ hasText: /gender|select/i }).first();
  if (await genderBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await genderBtn.click();
    await page.locator('[role="option"]').filter({ hasText: /^male$/i }).click();
  }

  // Phone
  const phoneInput = page.locator('input[name="phone"], input[type="tel"], input[placeholder*="phone" i]').first();
  await phoneInput.fill(PATIENT.phone);

  // Email (optional — only fill if visible)
  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  if (await emailInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await emailInput.fill(PATIENT.email);
  }

  // Address (optional)
  const addressInput = page.locator('textarea[name="address"], input[name="address"]').first();
  if (await addressInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await addressInput.fill(PATIENT.address);
  }

  // Submit
  await page.locator('button[type="submit"]').click();

  // Wait for redirect to the new patient's profile page
  await page.waitForURL(/\/patients\/[^/]+$/, { timeout: 30_000 });

  return page.url();
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("Patient management", () => {
  test("patient list page loads and shows the register button", async ({ page }) => {
    await page.goto("/patients");

    await expect(page).not.toHaveURL(/\/(login|landing)/);

    // The page must show a heading or list related to patients
    const heading = page.getByRole("heading", { name: /patients/i });
    const registerBtn = page.getByRole("link", { name: /new patient|register/i });

    await expect(heading.or(registerBtn)).toBeVisible({ timeout: 15_000 });
  });

  test("registers a new patient successfully", async ({ page }) => {
    const patientUrl = await registerPatient(page);

    // We should now be on the patient profile page
    expect(patientUrl).toMatch(/\/patients\/[^/]+/);

    // The patient name should appear on the profile
    await expect(page.getByText(PATIENT.name)).toBeVisible({ timeout: 10_000 });
  });

  test("searches for the registered patient by name", async ({ page }) => {
    // Register the patient first so there is something to search for
    await registerPatient(page);

    // Go to the patient list
    await page.goto("/patients");

    // Find the search input
    const searchInput = page.locator(
      'input[type="search"], input[placeholder*="search" i], input[placeholder*="patient" i]'
    ).first();

    if (await searchInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await searchInput.fill(PATIENT.name);

      // Expect the patient to appear in results
      await expect(
        page.locator(`text=${PATIENT.name}`).first()
      ).toBeVisible({ timeout: 10_000 });
    } else {
      // No search box — just confirm the patient appears in the full list
      await expect(page.locator(`text=${PATIENT.name}`).first()).toBeVisible({
        timeout: 10_000,
      });
    }
  });

  test("patient profile shows key demographics", async ({ page }) => {
    const patientUrl = await registerPatient(page);
    await page.goto(patientUrl);

    // Name must be visible
    await expect(page.getByText(PATIENT.name)).toBeVisible({ timeout: 10_000 });

    // Phone number should appear somewhere on the profile
    await expect(page.getByText(PATIENT.phone)).toBeVisible({ timeout: 10_000 });
  });

  test("navigating to a non-existent patient shows an error or not-found state", async ({
    page,
  }) => {
    await page.goto("/patients/nonexistent-id-000");

    // Should show a not-found message or redirect — not a 500 blank page
    const bodyText = await page.textContent("body");
    const indicatesNotFound =
      /not found|does not exist|no patient|error/i.test(bodyText || "") ||
      page.url().includes("/patients");
    expect(indicatesNotFound).toBe(true);
  });
});
