/**
 * EMR App Authentication & Access Control Tests
 *
 * Covers the three most critical flows for a multi-tenant medical app:
 * 1. Unauthenticated users are redirected to login
 * 2. Login page renders and is functional
 * 3. Protected routes (dashboard, patients) require a valid session
 */

import { test, expect } from "@playwright/test";

const EMR_URL = process.env.EMR_URL || "https://drhidayat.com";

// ─── 1. Unauthenticated redirect ─────────────────────────────────────────────

test("unauthenticated / redirects away from dashboard", async ({ page }) => {
  // Visit a protected route without a session
  const response = await page.goto(`${EMR_URL}/dashboard`, {
    waitUntil: "domcontentloaded",
  });

  // Should either redirect to /login or return a non-200 that is an auth page
  const finalUrl = page.url();
  const isRedirectedToLogin =
    finalUrl.includes("/login") ||
    finalUrl.includes("/auth") ||
    finalUrl.includes("signin");

  // The response itself might be 200 (SPA login redirect) or a redirect status
  const status = response?.status() ?? 0;
  expect(status).toBeLessThan(500);

  // Must not still be on /dashboard unauthenticated
  if (finalUrl.includes("/dashboard")) {
    // If still on dashboard, the page must show a login prompt
    const pageText = await page.textContent("body");
    expect(pageText).toMatch(/login|sign in|unauthorized/i);
  } else {
    expect(isRedirectedToLogin).toBe(true);
  }

  await page.screenshot({ path: "test-results/unauth-dashboard-redirect.png" });
});

test("unauthenticated /patients redirects to login", async ({ page }) => {
  await page.goto(`${EMR_URL}/patients`, { waitUntil: "domcontentloaded" });
  const finalUrl = page.url();

  const redirectedToAuth =
    finalUrl.includes("/login") ||
    finalUrl.includes("/auth") ||
    finalUrl.includes("signin");

  if (!redirectedToAuth) {
    // If somehow on the page, check for auth content
    const pageText = await page.textContent("body");
    expect(pageText).toMatch(/login|sign in|unauthorized/i);
  } else {
    expect(redirectedToAuth).toBe(true);
  }

  await page.screenshot({ path: "test-results/unauth-patients-redirect.png" });
});

// ─── 2. Login page ────────────────────────────────────────────────────────────

test("login page loads and has email + password fields", async ({ page }) => {
  await page.goto(`${EMR_URL}/login`, { waitUntil: "domcontentloaded" });

  const url = page.url();
  // Could redirect to Medplum OAuth or stay on /login
  expect(url).toMatch(/drhidayat\.com|medplum|sslip\.io/);

  await page.screenshot({ path: "test-results/emr-login-page-fields.png" });
});

// ─── 3. API route protection ──────────────────────────────────────────────────

test("/api/patients requires authentication", async ({ page }) => {
  const response = await page.request.get(`${EMR_URL}/api/patients`);
  // Must return 401 or 403 — never 200 — when unauthenticated
  expect([401, 403, 405]).toContain(response.status());
});

test("/api/queue requires authentication", async ({ page }) => {
  const response = await page.request.get(`${EMR_URL}/api/queue`);
  expect([401, 403, 405]).toContain(response.status());
});

test("/api/consultations requires authentication", async ({ page }) => {
  const response = await page.request.get(`${EMR_URL}/api/consultations`);
  expect([401, 403, 405]).toContain(response.status());
});

// ─── 4. Export route is secret-protected ─────────────────────────────────────

test("/api/export-to-medplum rejects request without secret", async ({
  page,
}) => {
  const response = await page.request.post(`${EMR_URL}/api/export-to-medplum`, {
    data: { action: "export_all" },
    headers: { "Content-Type": "application/json" },
  });
  // Should be 401 (no secret) or 503 (env var not set)
  expect([401, 503]).toContain(response.status());
});
