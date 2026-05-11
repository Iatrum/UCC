/**
 * One-off script: log in as demo admin and delete clinics by name.
 * Run with: bun tests/dev-scripts/delete-clinics.ts
 */

import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const EMAIL = "demo@iatrum.com";
const PASSWORD = "demouser123";
const CLINICS_TO_DELETE = ["e2e clinic", "klinikputeri"];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // ── 1. Log in ────────────────────────────────────────────────────────────
  console.log("→ Logging in...");
  const loginRes = await page.request.post(`${BASE}/api/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  if (!loginRes.ok()) {
    const body = await loginRes.text();
    throw new Error(`Login failed (${loginRes.status()}): ${body}`);
  }
  console.log("✓ Logged in");

  // ── 2. Fetch clinic list ─────────────────────────────────────────────────
  const listRes = await page.request.get(`${BASE}/api/admin/clinics`);
  if (!listRes.ok()) {
    const body = await listRes.text();
    throw new Error(`Failed to list clinics (${listRes.status()}): ${body}`);
  }
  const { clinics } = await listRes.json();
  console.log(`✓ Found ${clinics.length} clinic(s) total`);

  // ── 3. Delete matching clinics ───────────────────────────────────────────
  for (const target of CLINICS_TO_DELETE) {
    const match = clinics.find(
      (c: any) => c.name?.toLowerCase().includes(target.toLowerCase())
    );

    if (!match) {
      console.log(`  ⚠  No clinic found matching "${target}" — skipping`);
      continue;
    }

    console.log(`→ Deleting "${match.name}" (id: ${match.id})...`);
    const delRes = await page.request.delete(`${BASE}/api/admin/clinics/${match.id}`);
    if (delRes.ok()) {
      console.log(`  ✓ Deleted "${match.name}"`);
    } else {
      const body = await delRes.text();
      console.error(`  ✗ Failed to delete "${match.name}" (${delRes.status()}): ${body}`);
    }
  }

  await browser.close();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
