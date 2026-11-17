import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { buildStockNotice, computeLineStock } from "../../lib/billing/checkout-stock";

// Task 504. Fake data only. Clinic A is the caller; enc-a belongs to pat-a, enc-b/pat-b to clinic B.
const own = [{ system: "clinic", value: "clinic-a" }];
const foreign = [{ system: "clinic", value: "clinic-b" }];
const store: Record<string, any> = {
  "Encounter/enc-a": { resourceType: "Encounter", id: "enc-a", identifier: own, subject: { reference: "Patient/pat-a" } },
  "Encounter/enc-a2": { resourceType: "Encounter", id: "enc-a2", identifier: own, subject: { reference: "Patient/pat-a2" } },
  "Encounter/enc-b": { resourceType: "Encounter", id: "enc-b", identifier: foreign, subject: { reference: "Patient/pat-b" } },
  "Patient/pat-a": { resourceType: "Patient", id: "pat-a", identifier: own },
  "Patient/pat-a2": { resourceType: "Patient", id: "pat-a2", identifier: own },
  "Patient/pat-b": { resourceType: "Patient", id: "pat-b", identifier: foreign },
};
const events: string[] = [];
let clinic: string | undefined = "clinic-a";

const fakeMedplum = {
  async readResource(type: string, id: string) {
    events.push(`read:${type}/${id}`);
    if (type === "Organization") return { resourceType: type, id };
    const r = store[`${type}/${id}`];
    if (!r) throw Object.assign(new Error("not found"), { outcome: { id: "not-found" } });
    return structuredClone(r);
  },
  async createResource(r: any) { events.push(`write:create:${r.resourceType}`); return r; },
  async updateResource(r: any) { events.push(`write:update:${r.resourceType}`); return r; },
  async searchOne(type: string) { return type === "HealthcareService" ? { resourceType: type, id: "acct-a" } : undefined; },
};

const realAuth = await import("@/lib/server/medplum-auth");
mock.module("@/lib/server/medplum-auth", () => ({
  ...realAuth,
  requireClinicAuth: async () => ({ medplum: fakeMedplum, clinicId: clinic }),
  getCurrentProfile: async () => null,
}));
afterAll(() => {
  mock.module("@/lib/server/medplum-auth", () => realAuth);
});

const billing = await import("@/app/api/billing/route");
const post = (patientId: string, consultationId: string) =>
  billing.POST(
    new NextRequest("http://localhost/api/billing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        consultationId, patientId, paymentMethod: "cash", paidAmount: 10, totalAmount: 10,
        items: [{ id: "i1", name: "Fake Med", type: "Item", quantity: 1, price: 10 }],
      }),
    })
  );
const writes = () => events.filter((e) => e.startsWith("write:"));

beforeEach(() => {
  events.length = 0;
  clinic = "clinic-a";
});

describe("POST /api/billing patient/consultation ownership (Task 504)", () => {
  test("own patient, but another patient's consultation: 404 and zero writes (no exception Task either)", async () => {
    const res = await post("pat-a", "enc-a2");
    expect(res.status).toBe(404);
    expect(writes()).toEqual([]);
  });

  test("foreign clinic consultation and patient: 404, zero writes", async () => {
    const res = await post("pat-b", "enc-b");
    expect(res.status).toBe(404);
    expect(writes()).toEqual([]);
  });

  test("own consultation with a foreign patient id: 404, zero writes", async () => {
    const res = await post("pat-b", "enc-a");
    expect(res.status).toBe(404);
    expect(writes()).toEqual([]);
  });

  test("unknown consultation: 404, zero writes", async () => {
    const res = await post("pat-a", "enc-missing");
    expect(res.status).toBe(404);
    expect(writes()).toEqual([]);
  });

  test("no clinic context: 403, zero writes", async () => {
    clinic = undefined;
    const res = await post("pat-a", "enc-a");
    expect(res.status).toBe(403);
    expect(writes()).toEqual([]);
  });
});

describe("checkout stock helpers (Task 504)", () => {
  const catalog = [
    { id: "m1", name: "Paracetamol", strengths: ["500mg"], stock: 2, unit: "tablet" },
    { id: "m2", name: "Dup", stock: 5 },
    { id: "m3", name: "dup", stock: 5 },
  ];
  test("matches by name or name+strength and flags low stock, summing lines of one medicine", () => {
    const r = computeLineStock(
      [
        { id: "a", name: "Paracetamol 500mg", type: "Item", quantity: 1 },
        { id: "b", name: "paracetamol", type: "Item", quantity: 2 },
        { id: "c", name: "Dup", type: "Item", quantity: 1 },
        { id: "d", name: "Unknown", type: "Item", quantity: 1 },
        { id: "e", name: "Consult", type: "Service", quantity: 1 },
      ],
      catalog
    );
    expect(r.get("a")).toMatchObject({ match: "matched", onHand: 2, needed: 3, low: true, unit: "tablet" });
    expect(r.get("b")?.low).toBe(true);
    expect(r.get("c")?.match).toBe("ambiguous");
    expect(r.get("d")?.match).toBe("unmatched");
    expect(r.has("e")).toBe(false);
  });
  test("enough stock is not low", () => {
    const r = computeLineStock([{ id: "a", name: "Paracetamol", type: "Item", quantity: 2 }], catalog);
    expect(r.get("a")?.low).toBe(false);
  });
  test("buildStockNotice", () => {
    expect(buildStockNotice({ stockNegative: [], stockUnresolved: [], stockError: null })).toBeNull();
    expect(buildStockNotice({ stockNegative: ["X"] })).toMatchObject({ severe: false });
    const n = buildStockNotice({ stockNegative: ["X"], stockUnresolved: ["Y"], stockError: "boom" })!;
    expect(n.severe).toBe(true);
    expect(n.lines.length).toBe(3);
  });
});
