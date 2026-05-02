/**
 * Documents API clinic scoping tests
 *
 * Verifies that /api/documents enforces clinic ownership via patient.
 * A request for a patient that does not belong to the current clinic
 * must return 404.
 */

import { test, expect } from "@playwright/test";

const CLINIC_URL = process.env.EMR_CLINIC_URL || "https://demo.drhidayat.com";

test.describe("Documents API clinic scoping", () => {
  test("GET with unknown patientId returns 404", async ({ request }) => {
    const res = await request.get(
      `${CLINIC_URL}/api/documents?patientId=nonexistent-patient-id-00000`
    );
    expect(res.status()).toBe(404);
  });

  test("POST with unknown patientId returns 404", async ({ request }) => {
    const res = await request.post(`${CLINIC_URL}/api/documents`, {
      data: {
        patientId: "nonexistent-patient-id-00000",
        title: "Test Doc",
        url: "https://example.com/doc.pdf",
        contentType: "application/pdf",
      },
    });
    expect(res.status()).toBe(404);
  });

  test("PATCH with unknown document id returns 404", async ({ request }) => {
    const res = await request.patch(`${CLINIC_URL}/api/documents`, {
      data: { id: "nonexistent-document-id-00000", title: "Updated" },
    });
    expect(res.status()).toBe(404);
  });

  test("DELETE with unknown document id returns 404", async ({ request }) => {
    const res = await request.delete(`${CLINIC_URL}/api/documents`, {
      data: { id: "nonexistent-document-id-00000" },
    });
    expect(res.status()).toBe(404);
  });
});
