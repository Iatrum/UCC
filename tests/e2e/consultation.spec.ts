/**
 * Consultation Flow Tests
 *
 * Creates a fresh test patient, then exercises the consultation page:
 *  1. Form renders with the correct heading and all key fields
 *  2. Empty submission is rejected
 *  3. Happy-path: fills Chief Complaint + Diagnosis, submits → back to patient profile
 *
 * The patient is created once per describe block via beforeAll so we don't
 * accumulate extra FHIR resources unnecessarily.
 */

import { test, expect, type Page } from "@playwright/test";

const CLINIC_URL =
  process.env.EMR_CLINIC_URL || "https://klinikputeri.drhidayat.com";

const RUN_ID = String(Date.now()).slice(-4).padStart(4, "0");
const PATIENT_NAME = `E2E Consult Patient ${RUN_ID}`;
const PATIENT_NRIC = `850615-07-${RUN_ID}`;
const PATIENT_PHONE = `0197654${RUN_ID}`;

async function selectGender(page: Page, gender: "male" | "female"): Promise<void> {
  const trigger = page.getByRole("combobox").first();
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await trigger.click();
  await page.keyboard.press("ArrowDown");
  if (gender === "female") {
    await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Enter");
}

/** Register a new test patient and return their profile URL. */
async function registerTestPatient(page: Page): Promise<string> {
  await page.goto(`${CLINIC_URL}/patients/new`, { waitUntil: "domcontentloaded" });

  await page.fill(
    '[name="fullName"], input[placeholder*="full name"]',
    PATIENT_NAME
  );

  const nricInput = page.locator('input[name="nric"]').first();
  // Keep dashes — form expects YYMMDD-SS-NNNN format
  await nricInput.fill(PATIENT_NRIC);

  await selectGender(page, "female");

  await page.fill(
    'input[placeholder*="contact number"], input[placeholder*="phone"]',
    PATIENT_PHONE
  );

  await page.click('button[type="submit"]');
  await page.waitForURL(
    (url) => /\/patients\/[a-z0-9-]+$/.test(url.pathname) && !url.pathname.endsWith("/new"),
    { timeout: 20_000 }
  );

  return page.url(); // e.g. https://apex-group.drhidayat.com/patients/abc123
}

// ── Consultation form ─────────────────────────────────────────────────────────

test.describe("Consultation form", () => {
  let patientUrl: string;
  let patientId: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      storageState: "tests/e2e/.auth/klinikputeri.json",
    });
    const page = await context.newPage();
    patientUrl = await registerTestPatient(page);
    patientId = patientUrl.split("/patients/")[1];
    await context.close();
  });

  test("consultation page renders correctly", async ({ page }) => {
    await page.goto(
      `${CLINIC_URL}/patients/${patientId}/consultation`,
      { waitUntil: "domcontentloaded" }
    );

    // Heading
    await expect(
      page.getByRole("heading", { name: /new consultation/i })
    ).toBeVisible({ timeout: 15_000 });

    // Key fields
    await expect(
      page.locator('textarea[placeholder*="Clinical notes"]')
    ).toBeVisible();
    await expect(
      page.locator('input[placeholder*="Condition"]').or(
        page.locator('input[placeholder*="diagnosis" i]')
      )
    ).toBeVisible();

    // Submit button
    await expect(
      page.getByRole("button", { name: /sign order/i })
    ).toBeVisible();

    await page.screenshot({ path: "test-results/consultation-form.png" });
  });

  test("submitting empty form shows validation error", async ({ page }) => {
    await page.goto(
      `${CLINIC_URL}/patients/${patientId}/consultation`,
      { waitUntil: "domcontentloaded" }
    );

    await page.getByRole("button", { name: /sign order/i }).click();

    // Toast / error for missing chief complaint + diagnosis
    await expect(
      page.getByText(/please fill in chief complaint and diagnosis/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("happy-path: fill and submit consultation → back to patient profile", async ({
    page,
  }) => {
    await page.goto(
      `${CLINIC_URL}/patients/${patientId}/consultation`,
      { waitUntil: "domcontentloaded" }
    );

    await expect(
      page.getByRole("heading", { name: /new consultation/i })
    ).toBeVisible({ timeout: 15_000 });

    // Fill Chief Complaint
    await page
      .locator('textarea[placeholder*="Clinical notes"]')
      .fill("E2E test: patient presents with mild headache for 2 days.");

    // Fill Diagnosis
    await page
      .locator('input[placeholder*="Condition"]').or(
        page.locator('input[placeholder*="diagnosis" i]')
      ).first()
      .fill("Tension-type headache (E2E)");

    await page.screenshot({ path: "test-results/consultation-filled.png" });

    // Submit
    await page.getByRole("button", { name: /sign order/i }).click();

    // After save → redirects to /patients/{id}
    await page.waitForURL(
      (url) =>
        url.pathname === `/patients/${patientId}` ||
        url.pathname.startsWith(`/patients/${patientId}`),
      { timeout: 20_000 }
    );

    // Back on the patient profile
    await expect(
      page.getByRole("heading", { name: new RegExp(PATIENT_NAME, "i") })
    ).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: "test-results/consultation-saved.png" });
  });
});
