/**
 * Inventory module E2E tests
 *
 * Covers the authenticated /inventory workspace without creating live stock
 * records:
 *   1. Overview loads with inventory and purchase metrics
 *   2. Main tabs expose items, purchases, suppliers, and procedures panels
 *   3. Medication search handles an empty result
 *   4. Add medication dialog validates required fields and can be cancelled
 *   5. Inventory API rejects unauthenticated callers
 */

import { expect, request as playwrightRequest, test } from "@playwright/test";

test.describe("Inventory module", () => {
  test.beforeEach(async ({ page }) => {
    const response = await page.goto("/inventory", { waitUntil: "domcontentloaded" });

    expect(response?.status() ?? 0).toBeLessThan(400);
    await expect(page).not.toHaveURL(/\/(login|landing)/);
    await expect(page.getByRole("heading", { name: /^inventory$/i })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("overview loads inventory and purchase metrics", async ({ page }) => {
    await expect(page.getByText(/existing stock management/i)).toBeVisible();
    await expect(page.getByText(/^in stock$/i).first()).toBeVisible();
    await expect(page.getByText(/^out of stock$/i).first()).toBeVisible();
    await expect(page.getByText(/^order soon$/i).first()).toBeVisible();
    await expect(page.getByText(/^purchases$/i).first()).toBeVisible();
    await expect(page.getByText(/^inventory$/i).first()).toBeVisible();
  });

  test("tabs expose the main inventory work areas", async ({ page }) => {
    await page.getByRole("tab", { name: /^items$/i }).click();
    await expect(page.getByText(/medication inventory/i).first()).toBeVisible();
    await expect(page.getByPlaceholder(/search medications/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /add medication/i })).toBeVisible();

    await page.getByRole("tab", { name: /^purchases$/i }).click();
    await expect(page.getByText(/purchase documents/i).first()).toBeVisible();
    await expect(page.getByPlaceholder(/search orders, supplier, item/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /create new/i })).toBeVisible();

    await page.getByRole("tab", { name: /^suppliers$/i }).click();
    await expect(page.getByText(/^suppliers$/i).first()).toBeVisible();
    await expect(page.getByPlaceholder(/search suppliers/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /add supplier/i })).toBeVisible();

    await page.getByRole("tab", { name: /^procedures$/i }).click();
    await expect(page.getByText(/procedures and charges/i).first()).toBeVisible();
  });

  test("medication search shows a clear empty state", async ({ page }) => {
    await page.getByRole("tab", { name: /^items$/i }).click();
    await page.getByPlaceholder(/search medications/i).fill(`ZZZ-INVENTORY-E2E-${Date.now()}`);

    await expect(page.getByText(/no medications match the current filter/i)).toBeVisible();
  });

  test("add medication dialog validates required fields and cancels cleanly", async ({ page }) => {
    await page.getByRole("tab", { name: /^items$/i }).click();
    await page.getByRole("button", { name: /add medication/i }).click();

    const dialog = page.getByRole("dialog", { name: /add new medication/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/medication name/i)).toBeVisible();
    await expect(dialog.getByText(/^category$/i)).toBeVisible();
    await expect(dialog.getByLabel(/initial stock/i)).toBeVisible();
    await expect(dialog.getByLabel(/unit price/i)).toBeVisible();

    await dialog.getByRole("button", { name: /save medication/i }).click();
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: /^cancel$/i }).click();
    await expect(dialog).toBeHidden();
  });

  test("inventory API rejects unauthenticated callers", async ({ page }) => {
    const anonymousRequest = await playwrightRequest.newContext({
      baseURL: new URL(page.url()).origin,
      storageState: { cookies: [], origins: [] },
    });

    try {
      const response = await anonymousRequest.get("/api/inventory");
      expect([401, 403]).toContain(response.status());
    } finally {
      await anonymousRequest.dispose();
    }
  });
});
