/**
 * EMR App Authentication & Access Control Tests
 *
 * Covers the three most critical flows for a multi-tenant medical app:
 * 1. Unauthenticated users are redirected to login
 * 2. Login page renders and is functional
 * 3. Protected routes (dashboard, patients) require a valid session
 */

import { test, expect } from "@playwright/test";
import { expectAuthRedirectOrBlock } from "./support/auth";
import { EMR_URL } from "./support/env";

test.describe("EMR authentication and access control", () => {
  const protectedPages = ["/dashboard", "/patients"];
  const protectedApis = ["/api/patients", "/api/queue", "/api/consultations"];

  for (const path of protectedPages) {
    test(`unauthenticated ${path} redirects or blocks access`, async ({ page }) => {
      await expectAuthRedirectOrBlock(page, `${EMR_URL}${path}`);
    });
  }

  test("login page loads and has email + password fields", async ({ page }) => {
    await page.goto(`${EMR_URL}/login`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  for (const path of protectedApis) {
    test(`${path} requires authentication`, async ({ request }) => {
      const response = await request.get(`${EMR_URL}${path}`);
      expect([401, 403, 405]).toContain(response.status());
    });
  }

  test("/api/export-to-medplum rejects request without secret", async ({ request }) => {
    const response = await request.post(`${EMR_URL}/api/export-to-medplum`, {
      data: { action: "export_all" },
      headers: { "Content-Type": "application/json" },
    });
    expect([401, 503]).toContain(response.status());
  });
});
