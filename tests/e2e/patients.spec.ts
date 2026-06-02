/**
 * Registration workflow E2E (YEZZA-style wizard)
 *
 * Covers:
 *  1. Registration page renders step wizard and patient type switch
 *  2. New patient -> Visit Information -> consultation handoff
 *  3. Existing patient search/select inside registration wizard
 */

import { test, expect, type Page } from "@playwright/test";

const RUN_ID = String(Date.now()).slice(-5).padStart(5, "0");
const TEST_NAME = `[E2E] Reg ${RUN_ID}`;
const TEST_NRIC = `900101-10-${RUN_ID.slice(-4)}`;
const TEST_PHONE = `01234${RUN_ID}`;

async function selectGender(page: any, gender: "male" | "female") {
  const trigger = page.getByRole("combobox").nth(1);
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await trigger.click();
  await page.keyboard.press("ArrowDown");
  if (gender === "female") {
    await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Enter");
}

async function createPatientViaApi(page: Page, name: string, nric: string): Promise<string> {
  const response = await page.request.post("/api/patients", {
    data: {
      fullName: name,
      nric,
      dateOfBirth: "1990-01-01",
      gender: "male",
      phone: `012${String(Date.now()).slice(-7)}`,
      address: "",
      medicalHistory: {
        allergies: [],
        conditions: [],
        medications: [],
      },
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok() || typeof data?.patientId !== "string") {
    throw new Error(`Failed to create patient for profile drawer test: ${response.status()}`);
  }
  return data.patientId;
}

test.describe("Registration wizard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/patients/new", { waitUntil: "domcontentloaded" });
  });

  test("renders patient and visit steps", async ({ page }) => {
    await expect(
      page.getByText(/new patient registration/i).first()
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole("button", { name: /1\. patient information/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /2\. visit information/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /add new patient/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /search existing patient/i })).toBeVisible();

    await page.screenshot({ path: "test-results/registration-wizard-initial.png" });
  });

  test("creates new patient and reaches visit information step", async ({ page }) => {
    await page.goto("/patients/new", { waitUntil: "domcontentloaded" });

    await page.fill('input[name="fullName"]', TEST_NAME);
    const nricInput = page.locator('input[name="nric"]').first();
    await nricInput.fill(TEST_NRIC);
    await selectGender(page, "male");
    await page.fill('input[placeholder*="contact number" i], input[name="phone"]', TEST_PHONE);
    await page.getByRole("button", { name: /continue to visit information/i }).click();

    await expect(
      page.getByRole("heading", { name: /visit information/i })
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(new RegExp(TEST_NAME, "i")).first()).toBeVisible({ timeout: 10_000 });
  });

  test("existing patient mode can search and select inside step 1", async ({ page }) => {
    await page.goto("/patients/new", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /search existing patient/i }).click();
    const searchInput = page.getByPlaceholder(/search by name, nric, or phone/i);
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await searchInput.fill(TEST_NRIC.slice(0, 6));
    await expect(
      page.locator("button").filter({ hasText: /NRIC:/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("existing patient consultation handoff submits successfully", async ({ page }) => {
    await page.goto("/patients/new", { waitUntil: "domcontentloaded" });

    // create patient first
    await page.fill('input[name="fullName"]', `${TEST_NAME} Existing`);
    await page.fill('input[name="nric"]', `900101-10-${String(Number(RUN_ID.slice(-4)) + 1).padStart(4, "0")}`);
    await selectGender(page, "male");
    await page.fill('input[placeholder*="contact number" i], input[name="phone"]', `01235${RUN_ID}`);
    await page.getByRole("button", { name: /continue to visit information/i }).click();
    await page.getByRole("button", { name: /send to waiting area/i }).click();
    await page.waitForURL(/\/dashboard|\/patients\/[a-z0-9-]+$/, { timeout: 25_000 });

    // return and use existing mode
    await page.goto("/patients/new", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /search existing patient/i }).click();
    const existingSearch = page.getByPlaceholder(/search by name, nric, or phone/i);
    await existingSearch.fill(TEST_NAME);
    const pick = page.locator("button").filter({ hasText: new RegExp(`${TEST_NAME}`, "i") }).first();
    await expect(pick).toBeVisible({ timeout: 15_000 });
    await pick.click();
    await page.getByRole("button", { name: /continue to visit information/i }).click();
    await page.getByRole("button", { name: /send to waiting area/i }).click();
    await page.waitForURL(/\/dashboard|\/patients\/[a-z0-9-]+$/, { timeout: 25_000 });
  });
});

test.describe("Patient profile consult and treatment drawer", () => {
  test("prompts for consult first and posts multiple treatments to the signed consult", async ({ page }) => {
    const profileRunId = String(Date.now()).slice(-6);
    const patientName = `[E2E] Profile Drawer ${profileRunId}`;
    const patientNric = `910101-10-${profileRunId.slice(-4)}`;
    const signedConsultationId = `e2e-signed-consult-${profileRunId}`;
    let orderPayload: any = null;
    let draftEntries: any[] = [];

    await page.route("**/api/consultations/plan**", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        const body = await request.postDataJSON();
        const entry = body.entry;
        const nowIso = new Date().toISOString();
        const quantity = Number(entry.quantity || 1);
        const unitPrice = Number(entry.unitPrice || 0);
        draftEntries = [
          ...draftEntries.filter((item) => item.id !== entry.id),
          {
            ...entry,
            id: entry.id || `draft-${draftEntries.length + 1}`,
            quantity,
            unitPrice,
            lineTotal: Number((quantity * unitPrice).toFixed(2)),
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        ];
      }

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          persistenceAvailable: true,
          plan: {
            entries: draftEntries,
            summary: {
              subtotal: draftEntries.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0),
              total: draftEntries.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0),
              currency: "MYR",
              itemCount: draftEntries.length,
            },
          },
        }),
      });
    });

    await page.route("**/api/consultations", async (route) => {
      if (route.request().method() !== "POST") {
        return route.continue();
      }

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          consultationId: signedConsultationId,
          patientId: route.request().postDataJSON().patientId,
        }),
      });
    });

    await page.route("**/api/orders", async (route) => {
      if (route.request().method() !== "POST") {
        return route.continue();
      }

      orderPayload = await route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    const patientId = await createPatientViaApi(page, patientName, patientNric);
    await page.goto(`/patients/${patientId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: new RegExp(patientName, "i") })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("tab", { name: "Treatment" }).click();
    await expect(page.getByText(/please fill in and sign the consult before adding treatment/i)).toBeVisible();
    await expect(page.getByText(/no line items yet/i)).toBeHidden();

    await page.locator(".ProseMirror").first().fill("Profile drawer consult complaint.");
    await page.getByPlaceholder(/condition \(diagnosis\)/i).fill("Profile drawer diagnosis");
    await page.getByRole("button", { name: /^sign$/i }).click();

    await expect(page.getByText(/treatment is ready/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/no line items yet/i)).toBeVisible({ timeout: 10_000 });

    const treatmentSearch = page.locator('input[type="text"]').first();
    await treatmentSearch.fill("Consultation Fee");
    await page.getByRole("button", { name: /consultation fee/i }).first().click();
    await treatmentSearch.fill("Consultation Fee");
    await page.getByRole("button", { name: /consultation fee/i }).first().click();
    await expect(page.getByText(/consultation fee/i).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /^sign$/i }).click();

    await expect.poll(() => orderPayload?.consultationId).toBe(signedConsultationId);
    await expect.poll(() => orderPayload?.procedures?.length).toBe(2);
  });
});
