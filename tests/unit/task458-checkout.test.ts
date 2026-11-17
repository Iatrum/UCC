import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import {
  checkoutSubtotal,
  hasBillableItems,
  resolveCheckoutPatientId,
} from "../../lib/billing/checkout-guards";

// Task 458. Fake data only.
const consultations: Record<string, { id: string; patientId: string; clinic: string }> = {
  "enc-a": { id: "enc-a", patientId: "pat-a", clinic: "clinic-a" },
  "enc-b": { id: "enc-b", patientId: "pat-b", clinic: "clinic-b" },
};
const patients: Record<string, { id: string; fullName: string; clinic: string }> = {
  "pat-a": { id: "pat-a", fullName: "Fake A", clinic: "clinic-a" },
  "pat-b": { id: "pat-b", fullName: "Fake B", clinic: "clinic-b" },
};
let completeCalls = 0;
let stockResult: any;
let dispenseError: string | undefined;

mock.module("@/lib/server/medplum-auth", () => ({
  // Fake Medplum for the Task 504 consultation/patient ownership read (own clinic: pat-a / enc-a).
  requireClinicAuth: async () => ({
    clinicId: "clinic-a",
    medplum: {
      async readResource(type: string, id: string) {
        if (type === "Organization") return { resourceType: type, id };
        if (type === "Encounter" && id === "enc-a")
          return { resourceType: type, id, subject: { reference: "Patient/pat-a" }, identifier: [{ system: "clinic", value: "clinic-a" }] };
        if (type === "Patient" && id === "pat-a")
          return { resourceType: type, id, identifier: [{ system: "clinic", value: "clinic-a" }] };
        throw new Error("not found");
      },
      async searchOne(type: string) { return type === "HealthcareService" ? { resourceType: type, id: "acct-a" } : undefined; },
      async searchResources() { return []; },
      async createResource(resource: unknown) { return resource; },
    },
  }),
  getCurrentProfile: async () => null,
}));
mock.module("@/lib/fhir/consultation-service", () => ({
  getConsultationFromMedplum: async (id: string, clinicId: string) => {
    const c = consultations[id];
    return c && c.clinic === clinicId ? c : null;
  },
  updateConsultationInMedplum: async () => {},
}));
mock.module("@/lib/fhir/patient-service", () => ({
  getPatientFromMedplum: async (id: string, clinicId: string) => {
    const p = patients[id];
    return p && p.clinic === clinicId ? p : null;
  },
}));
mock.module("@/lib/fhir/billing-service", () => ({
  completeCheckoutInvoice: async () => {
    completeCalls++;
    return { invoice: { id: "inv-1", invoiceNumber: "INV-1" }, stock: stockResult, dispenseError };
  },
  generateInvoiceNumber: async () => "INV-1",
  deleteInvoice: async () => {},
  getInvoiceNumber: async () => "INV-1",
  getInvoice: async () => null,
  getPatientInvoices: async () => [],
  getConsultationInvoice: async () => null,
  voidInvoice: async () => {},
}));

const orders = await import("@/app/api/orders/route");
const billing = await import("@/app/api/billing/route");
const get = (qs: string) => orders.GET(new NextRequest(`http://localhost/api/orders${qs}`));

beforeEach(() => {
  completeCalls = 0;
  stockResult = undefined;
  dispenseError = undefined;
});

describe("GET /api/orders without patientId", () => {
  test("looks the patient up from the consultation", async () => {
    const res = await get("?consultationId=enc-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.patient.id).toBe("pat-a");
    expect(body.consultation.id).toBe("enc-a");
  });

  test("still works with a matching patientId", async () => {
    expect((await get("?consultationId=enc-a&patientId=pat-a")).status).toBe(200);
  });

  test("consultation from another clinic is not found", async () => {
    expect((await get("?consultationId=enc-b")).status).toBe(404);
    expect((await get("?consultationId=enc-b&patientId=pat-b")).status).toBe(404);
  });

  test("unknown consultation is not found", async () => {
    expect((await get("?consultationId=nope")).status).toBe(404);
  });

  test("mismatched or foreign patientId is not found", async () => {
    expect((await get("?consultationId=enc-a&patientId=pat-b")).status).toBe(404);
  });

  test("consultationId is still required", async () => {
    expect((await get("")).status).toBe(400);
  });
});

describe("resolveCheckoutPatientId", () => {
  test("rules", () => {
    expect(resolveCheckoutPatientId("p1", undefined)).toBe("p1");
    expect(resolveCheckoutPatientId("p1", "p1")).toBe("p1");
    expect(resolveCheckoutPatientId("p1", "p2")).toBeNull();
    expect(resolveCheckoutPatientId("", "p1")).toBeNull();
    expect(resolveCheckoutPatientId(undefined, undefined)).toBeNull();
  });
});

describe("no billable items", () => {
  test("hasBillableItems", () => {
    expect(hasBillableItems([])).toBe(false);
    expect(hasBillableItems([{ quantity: 1, price: 0 }])).toBe(false);
    expect(hasBillableItems([{ quantity: 0, price: 50 }])).toBe(false);
    expect(hasBillableItems([{ quantity: 2, price: 12.5 }])).toBe(true);
    expect(checkoutSubtotal([{ quantity: 3, price: 0.1 }])).toBe(0.3);
  });

  const post = (body: unknown) =>
    billing.POST(
      new NextRequest("http://localhost/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  const base = { consultationId: "enc-a", patientId: "pat-a", paymentMethod: "cash", paidAmount: 0, totalAmount: 0 };

  test("billing API rejects a RM 0 checkout and creates no invoice", async () => {
    const zero = await post({ ...base, items: [{ name: "Free", quantity: 1, price: 0 }] });
    expect(zero.status).toBe(400);
    expect((await zero.json()).error).toContain("No billable items");
    expect((await post({ ...base, items: [] })).status).toBe(400);
    expect(completeCalls).toBe(0);
  });

  test("billing API still accepts a real checkout", async () => {
    const ok = await post({ ...base, paidAmount: 25, totalAmount: 25, items: [{ name: "Consult", quantity: 1, price: 25 }] });
    expect(ok.status).toBe(200);
    expect(completeCalls).toBe(1);
  });
});

describe("POST /api/billing stock feedback (Task 504)", () => {
  const post = () =>
    billing.POST(
      new NextRequest("http://localhost/api/billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          consultationId: "enc-a", patientId: "pat-a", paymentMethod: "cash", paidAmount: 25, totalAmount: 25,
          items: [{ name: "Fake Med", type: "Item", quantity: 1, price: 25 }],
        }),
      })
    );

  test("returns stockNegative, stockUnresolved and stockError", async () => {
    stockResult = { adjusted: [], unmatched: ["Dup"], negativeStock: ["Fake Med"], unresolved: ["Dup"], retained: [] };
    dispenseError = "boom";
    const body = await (await post()).json();
    expect(body.success).toBe(true);
    expect(body.stockNegative).toEqual(["Fake Med"]);
    expect(body.stockUnresolved).toEqual(["Dup"]);
    expect(body.stockError).toBe("boom");
  });

  test("clean checkout returns empty stock fields", async () => {
    const body = await (await post()).json();
    expect(body.stockNegative).toEqual([]);
    expect(body.stockUnresolved).toEqual([]);
    expect(body.stockError).toBeNull();
  });

  test("a consultation that belongs to another patient is 404 and writes nothing", async () => {
    const res = await billing.POST(
      new NextRequest("http://localhost/api/billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          consultationId: "enc-a", patientId: "pat-b", paymentMethod: "cash", paidAmount: 25, totalAmount: 25,
          items: [{ name: "Fake Med", type: "Item", quantity: 1, price: 25 }],
        }),
      })
    );
    expect(res.status).toBe(404);
    expect(completeCalls).toBe(0);
  });
});
