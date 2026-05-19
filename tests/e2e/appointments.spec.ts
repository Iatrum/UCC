/**
 * Appointment workflow E2E tests
 *
 * Covers:
 *   1. Appointments page renders for authenticated clinic staff
 *   2. New appointment form can schedule a patient appointment
 *   3. Appointment list links to check-in; reschedule works from appointment detail
 */

import { expect, test, type Page } from "@playwright/test";

const DEFAULT_CLINICIAN = "Dr. Sarah Wong";

let patientCounter = 0;

type TestPatient = {
  id: string;
  name: string;
  nric: string;
  phone: string;
  reason: string;
};

type TestPractitioner = {
  id: string;
  name: string;
};

function futureSlot(minutesFromNow = 90): Date {
  const date = new Date(Date.now() + minutesFromNow * 60 * 1000);
  date.setSeconds(0, 0);
  return date;
}

function uniqueFutureSlot(daysFromNow = 30): Date {
  const seed = Date.now() + patientCounter * 7919;
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow + 365 + (seed % 365));
  date.setHours(8 + (seed % 9), (Math.floor(seed / 9) % 12) * 5, 0, 0);
  return date;
}

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatTimeInput(date: Date): string {
  return date.toTimeString().slice(0, 5);
}

function buildPatientInput(): Omit<TestPatient, "id"> {
  patientCounter += 1;
  const runId = `${Date.now()}-${patientCounter}`;
  const serial = String((Number(String(Date.now()).slice(-4)) + patientCounter) % 10000).padStart(4, "0");

  return {
    name: `Appointment E2E ${runId}`,
    nric: `900101-10-${serial}`,
    phone: `01288${serial}`,
    reason: `E2E appointment follow-up ${runId}`,
  };
}

async function createTestPatient(page: Page): Promise<TestPatient> {
  const patient = buildPatientInput();
  const response = await page.request.post("/api/patients", {
    data: {
      fullName: patient.name,
      nric: patient.nric,
      dateOfBirth: "1990-01-01",
      gender: "female",
      phone: patient.phone,
      address: "Appointment E2E Address",
    },
  });
  const data = await response.json().catch(() => ({}));

  expect(response.ok(), JSON.stringify(data)).toBe(true);
  expect(typeof data?.patientId).toBe("string");

  return { ...patient, id: data.patientId };
}

async function createTestAppointment(
  page: Page,
  patient: TestPatient,
  scheduledAt = futureSlot(120)
): Promise<string> {
  const response = await page.request.post("/api/appointments", {
    data: {
      patientId: patient.id,
      patientName: patient.name,
      patientContact: patient.phone,
      clinician: DEFAULT_CLINICIAN,
      reason: patient.reason,
      type: "Follow-up",
      notes: `Created by appointment E2E for ${patient.name}`,
      scheduledAt: scheduledAt.toISOString(),
      status: "booked",
      durationMinutes: 30,
    },
  });
  const data = await response.json().catch(() => ({}));

  expect(response.ok(), JSON.stringify(data)).toBe(true);
  expect(typeof data?.appointmentId).toBe("string");

  return data.appointmentId;
}

async function getPreferredPractitioner(page: Page): Promise<TestPractitioner> {
  const response = await page.request.get("/api/practitioners");
  const data = await response.json().catch(() => ({}));
  expect(response.ok(), JSON.stringify(data)).toBe(true);

  const practitioners = data.practitioners || [];
  expect(practitioners.length).toBeGreaterThan(0);

  const preferred =
    practitioners.find((p: any) => p.name === DEFAULT_CLINICIAN) ||
    practitioners[0];

  expect(typeof preferred.id).toBe("string");
  expect(typeof preferred.name).toBe("string");

  return { id: preferred.id, name: preferred.name };
}

async function selectByVisibleOption(page: Page, triggerIndex: number, optionName: RegExp | string): Promise<void> {
  await page.locator('button[role="combobox"]').nth(triggerIndex).click();
  await page.getByRole("option", { name: optionName }).click();
}

async function selectPreferredOrFirstOption(
  page: Page,
  triggerIndex: number,
  preferredName: RegExp | string
): Promise<string> {
  await page.locator('button[role="combobox"]').nth(triggerIndex).click();

  const preferredOption = page.getByRole("option", { name: preferredName }).first();
  if (await preferredOption.isVisible().catch(() => false)) {
    const selected = (await preferredOption.textContent())?.trim() || "";
    await preferredOption.click();
    return selected;
  }

  const firstAvailableOption = page.getByRole("option").filter({ hasNotText: /loading/i }).first();
  await expect(firstAvailableOption).toBeVisible({ timeout: 20_000 });
  const selected = (await firstAvailableOption.textContent())?.trim() || "";
  await firstAvailableOption.click();
  return selected;
}

async function appointmentRowFor(page: Page, patientName: string) {
  const patientTitle = page.getByText(patientName, { exact: true }).first();
  await expect(patientTitle).toBeVisible({ timeout: 20_000 });
  return patientTitle.locator(
    'xpath=ancestor::*[.//*[self::a or self::button][contains(normalize-space(.), "Check-in")] and .//a[contains(normalize-space(.), "View")]][1]'
  );
}

test.describe("Appointment workflow", () => {
  test("appointments page is accessible and links to new appointment form", async ({ page }) => {
    test.setTimeout(60_000);
    const response = await page.goto("/appointments", { waitUntil: "domcontentloaded" });

    expect(response?.status() ?? 0).toBeLessThan(400);
    await expect(page).not.toHaveURL(/\/(login|landing)/);
    await expect(page.getByRole("heading", { name: /^appointments$/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: /new appointment/i })).toBeVisible();

    await page.getByRole("link", { name: /new appointment/i }).click();
    await expect(page).toHaveURL(/\/appointments\/new/);
    await expect(page.getByText(/schedule new appointment/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/available slots/i)).toBeVisible();
  });

  test("schedules a new appointment from the replacement form", async ({ page }) => {
    test.setTimeout(60_000);
    const patient = await createTestPatient(page);
    const slot = uniqueFutureSlot();

    await page.goto("/appointments/new", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/schedule new appointment/i)).toBeVisible({ timeout: 15_000 });

    const patientCombobox = page.locator('button[role="combobox"]').first();
    await expect(patientCombobox).toBeEnabled({ timeout: 20_000 });
    await patientCombobox.click();
    await page.getByPlaceholder(/search patient/i).fill(patient.name);
    await page.getByText(patient.name, { exact: true }).click();

    await page.locator('input[type="date"]').fill(formatDateInput(slot));
    await page.locator('input[type="time"]').fill(formatTimeInput(slot));
    const clinicianName = await selectPreferredOrFirstOption(page, 2, DEFAULT_CLINICIAN);
    await selectByVisibleOption(page, 3, /follow-up/i);
    await page.getByPlaceholder(/follow-up consultation/i).fill(patient.reason);
    await page.getByPlaceholder(/preparation instructions|notes/i).fill("Bring prior lab results.");

    const createAppointment = page.waitForResponse(
      (response) =>
        response.url().includes("/api/scheduling/manual-book") &&
        response.request().method() === "POST",
      { timeout: 30_000 }
    );
    await page.getByRole("button", { name: /create appointment/i }).click();
    const appointmentResponse = await createAppointment;
    const data = await appointmentResponse.json().catch(() => ({}));

    expect(appointmentResponse.ok(), JSON.stringify(data)).toBe(true);
    expect(typeof data?.appointmentId).toBe("string");
    expect(typeof data?.slotId).toBe("string");
    await expect(page).toHaveURL(new RegExp(`/appointments/${data.appointmentId}`), { timeout: 20_000 });
    await expect(page.locator("main").getByText(patient.name).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(clinicianName).first()).toBeVisible();
  });

  test("new-v1 schedules through slot-backed manual booking", async ({ page }) => {
    test.setTimeout(60_000);
    const patient = await createTestPatient(page);
    const slot = uniqueFutureSlot();

    await page.goto("/appointments/new-v1", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/schedule new appointment/i)).toBeVisible({ timeout: 15_000 });

    const patientCombobox = page.locator('button[role="combobox"]').first();
    await expect(patientCombobox).toBeEnabled({ timeout: 20_000 });
    await patientCombobox.click();
    await page.getByPlaceholder(/search patient/i).fill(patient.name);
    await page.getByText(patient.name, { exact: true }).click();

    await page.locator('input[type="date"]').fill(formatDateInput(slot));
    await page.locator('input[type="time"]').fill(formatTimeInput(slot));
    const clinicianName = await selectPreferredOrFirstOption(page, 2, DEFAULT_CLINICIAN);
    await selectByVisibleOption(page, 3, /follow-up/i);
    await page.getByPlaceholder(/follow-up consultation/i).fill(patient.reason);
    await page.getByPlaceholder(/preparation instructions|notes/i).fill("Bring prior lab results.");

    const createAppointment = page.waitForResponse(
      (response) =>
        response.url().includes("/api/scheduling/manual-book") &&
        response.request().method() === "POST",
      { timeout: 30_000 }
    );
    await page.getByRole("button", { name: /create appointment/i }).click();
    const appointmentResponse = await createAppointment;
    const data = await appointmentResponse.json().catch(() => ({}));

    expect(appointmentResponse.ok(), JSON.stringify(data)).toBe(true);
    expect(typeof data?.appointmentId).toBe("string");
    expect(typeof data?.slotId).toBe("string");
    await expect(page).toHaveURL(new RegExp(`/appointments/${data.appointmentId}`), { timeout: 20_000 });
    await expect(page.locator("main").getByText(patient.name).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(clinicianName).first()).toBeVisible();
  });

  test("new-v1 shows simple slots and selecting one fills the appointment time", async ({ page }) => {
    test.setTimeout(60_000);
    const slot = uniqueFutureSlot(75);

    await page.goto("/appointments/new-v1", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/schedule new appointment/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Select clinician")).toBeVisible({ timeout: 20_000 });

    await selectPreferredOrFirstOption(page, 2, DEFAULT_CLINICIAN);
    await page.locator('input[type="date"]').fill(formatDateInput(slot));

    const generateSlots = page.waitForResponse(
      (response) =>
        response.url().includes("/api/scheduling/slots/generate") &&
        response.request().method() === "POST",
      { timeout: 30_000 }
    );
    await page.getByRole("button", { name: /check slots/i }).click();
    const generateResponse = await generateSlots;
    const data = await generateResponse.json().catch(() => ({}));
    expect(generateResponse.ok(), JSON.stringify(data)).toBe(true);

    const slotButton = page.locator("button").filter({ hasText: /^\d{2}:\d{2}$/ }).first();
    await expect(slotButton).toBeVisible({ timeout: 20_000 });
    const slotTime = ((await slotButton.textContent()) || "").trim();
    expect(slotTime).toMatch(/^\d{2}:\d{2}$/);
    await slotButton.click();
    await expect(page.locator('input[type="time"]')).toHaveValue(slotTime);
  });

  test("new-v1 rejects overlapping active manual bookings for the same clinician", async ({ page }) => {
    test.setTimeout(60_000);
    const practitioner = await getPreferredPractitioner(page);
    const firstPatient = await createTestPatient(page);
    const secondPatient = await createTestPatient(page);
    const slot = uniqueFutureSlot(45);

    const firstBooking = await page.request.post("/api/scheduling/manual-book", {
      data: {
        patientId: firstPatient.id,
        practitionerId: practitioner.id,
        practitionerName: practitioner.name,
        scheduledAt: slot.toISOString(),
        durationMinutes: 30,
        reason: firstPatient.reason,
        type: "Follow-up",
        notes: "Created by appointment E2E for overlap guard.",
      },
    });
    const firstData = await firstBooking.json().catch(() => ({}));
    expect(firstBooking.ok(), JSON.stringify(firstData)).toBe(true);
    expect(typeof firstData?.appointmentId).toBe("string");

    const secondBooking = await page.request.post("/api/scheduling/manual-book", {
      data: {
        patientId: secondPatient.id,
        practitionerId: practitioner.id,
        practitionerName: practitioner.name,
        scheduledAt: new Date(slot.getTime() + 15 * 60 * 1000).toISOString(),
        durationMinutes: 30,
        reason: secondPatient.reason,
        type: "Follow-up",
        notes: "This should be rejected by the overlap guard.",
      },
    });
    const secondData = await secondBooking.json().catch(() => ({}));
    expect(secondBooking.status(), JSON.stringify(secondData)).toBeGreaterThanOrEqual(400);
    expect(String(secondData?.error || "")).toMatch(/overlap|unavailable/i);
  });

  test("check-in link from the list opens patient check-in; detail page can reschedule", async ({ page }) => {
    test.setTimeout(60_000);
    const patient = await createTestPatient(page);
    const appointmentId = await createTestAppointment(page, patient);

    await page.goto("/appointments", { waitUntil: "domcontentloaded" });
    const appointmentRow = await appointmentRowFor(page, patient.name);

    await appointmentRow.getByRole("button", { name: /check-in/i }).click();
    await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}/check-in`), { timeout: 20_000 });

    const beforeReschedule = await page.request
      .get(`/api/appointments?id=${appointmentId}`)
      .then((response) => response.json());

    await page.goto(`/appointments/${appointmentId}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("main").getByText(patient.name).first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /reschedule/i }).click();
    const dialog = page.getByRole("dialog", { name: /reschedule appointment/i });
    await expect(dialog).toBeVisible();

    const nextStart = new Date(beforeReschedule?.appointment?.scheduledAt);
    nextStart.setHours(nextStart.getHours() + 2);
    const pad = (n: number) => n.toString().padStart(2, "0");
    const localValue = `${nextStart.getFullYear()}-${pad(nextStart.getMonth() + 1)}-${pad(nextStart.getDate())}T${pad(nextStart.getHours())}:${pad(nextStart.getMinutes())}`;
    await dialog.getByLabel(/date and time/i).fill(localValue);

    const reschedule = page.waitForResponse(
      (response) =>
        response.url().includes("/api/appointments") &&
        response.request().method() === "PATCH",
      { timeout: 30_000 }
    );
    await dialog.getByRole("button", { name: /save changes/i }).click();
    const rescheduleResponse = await reschedule;
    expect(rescheduleResponse.ok()).toBe(true);

    await expect
      .poll(
        async () => {
          const response = await page.request.get(`/api/appointments?id=${appointmentId}`);
          const data = await response.json().catch(() => ({}));
          return data?.appointment?.scheduledAt || "";
        },
        { timeout: 20_000, intervals: [1000, 2000, 3000] }
      )
      .not.toBe(beforeReschedule?.appointment?.scheduledAt);
  });

  test("clinic scoping: GET by unknown patientId returns 404", async ({ page }) => {
    const res = await page.request.get("/api/appointments?patientId=nonexistent-patient-id-00000");
    expect(res.status()).toBe(404);
  });

  test("clinic scoping: GET by unknown appointmentId returns 404", async ({ page }) => {
    const res = await page.request.get("/api/appointments?id=nonexistent-appointment-id-00000");
    expect(res.status()).toBe(404);
  });

  test("clinic scoping: own clinic patient appointments are accessible", async ({ page }) => {
    const patient = await createTestPatient(page);
    const appointmentId = await createTestAppointment(page, patient);

    const res = await page.request.get(`/api/appointments?patientId=${patient.id}`);
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data.appointments.some((a: any) => a.id === appointmentId)).toBe(true);
  });

  test("clinic scoping: DELETE rejects unknown appointment", async ({ page }) => {
    const res = await page.request.delete("/api/appointments", {
      data: { appointmentId: "nonexistent-appointment-id-00000" },
    });
    expect(res.status()).toBe(404);
  });
});
