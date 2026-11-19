import { expect, test } from '@playwright/test';

test('dashboard loads appointments and billing while browser auth is pending', async ({ page }) => {
  let releaseAuth!: () => void;
  const authGate = new Promise<void>((resolve) => { releaseAuth = resolve; });
  await page.route('**/api/auth/me', async (route) => {
    await authGate;
    await route.continue();
  });

  try {
    const [appointments, billable] = await Promise.all([
      page.waitForResponse('**/api/appointments', { timeout: 10_000 }),
      page.waitForResponse('**/api/orders/billable', { timeout: 10_000 }),
      page.waitForRequest('**/api/auth/me', { timeout: 10_000 }),
      page.goto('/dashboard', { waitUntil: 'domcontentloaded' }),
    ]);
    expect(appointments.ok()).toBe(true);
    expect(billable.ok()).toBe(true);
    const [appointmentPayload, billablePayload] = await Promise.all([
      appointments.json(),
      billable.json(),
    ]);
    expect(Array.isArray(appointmentPayload.appointments)).toBe(true);
    expect(Array.isArray(billablePayload.consultations)).toBe(true);
  } finally {
    releaseAuth();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
