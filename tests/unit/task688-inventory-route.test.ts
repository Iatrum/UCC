import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { CLINIC_A, CLINIC_B, createMockMedplum, tenantResources } from "./helpers/mock-medplum";

// Task 688: /api/inventory route behaviour (clinic scope, validation -> 400, stock adjust via PATCH). Fake data only.
const realAuth = await import("@/lib/server/medplum-auth");
const realAdminClient = await import("@/lib/server/medplum-admin");

let clinic = CLINIC_A;
let db = createMockMedplum();
mock.module("@/lib/server/medplum-auth", () => ({
  ...realAuth,
  requireClinicAuth: async () => ({ medplum: db.client, clinicId: clinic }),
}));
mock.module("@/lib/server/medplum-admin", () => ({ ...realAdminClient, getAdminMedplum: async () => db.client }));

const { GET, POST, PATCH, DELETE } = await import("../../app/api/inventory/route");

afterAll(() => {
  mock.module("@/lib/server/medplum-auth", () => realAuth);
  mock.module("@/lib/server/medplum-admin", () => realAdminClient);
});

beforeEach(() => {
  clinic = CLINIC_A;
  db = createMockMedplum([...tenantResources(CLINIC_A), ...tenantResources(CLINIC_B)]);
});

const url = (qs = "") => `http://localhost/api/inventory${qs}`;
const send = (fn: typeof POST, method: string, body: unknown, qs = "") =>
  fn(new NextRequest(url(qs), { method, headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const item = (over: Record<string, unknown> = {}) => ({ name: "Fake Item", strengths: ["10mg"], stock: 5, minimumStock: 2, unitPrice: 1.2, ...over });
async function create(over: Record<string, unknown> = {}) {
  const res = await send(POST, "POST", item(over));
  return (await res.json()).medicationId as string;
}

describe("/api/inventory", () => {
  test("POST creates, applies defaults, GET list + by id return it; count matches", async () => {
    const id = await create();
    const list = await (await GET(new NextRequest(url()))).json();
    expect(list).toMatchObject({ success: true, count: 1 });
    expect(list.medications[0]).toMatchObject({ id, name: "Fake Item", stock: 5, minimumStock: 2, unit: "units", category: "" });
    const one = await (await GET(new NextRequest(url(`?id=${id}`)))).json();
    expect(one.medication.id).toBe(id);
  });

  test("POST validation errors are 400 with a message and write nothing", async () => {
    for (const body of [item({ name: "" }), item({ stock: 1.5 }), item({ stock: -1 }), item({ unitPrice: "x" }), item({ strengths: "10mg" }), "not-json", null]) {
      const res = await send(POST, "POST", body as never);
      expect(res.status).toBe(400);
      expect((await res.json()).success).toBe(false);
    }
    expect(db.creates("Medication")).toHaveLength(0);
  });

  test("PATCH adjusts stock (including to 0) and leaves other fields", async () => {
    const id = await create();
    const res = await send(PATCH, "PATCH", { medicationId: id, stock: 0 });
    expect(res.status).toBe(200);
    const m = (await (await GET(new NextRequest(url(`?id=${id}`)))).json()).medication;
    expect(m).toMatchObject({ stock: 0, minimumStock: 2, name: "Fake Item" });
  });

  test("PATCH needs medicationId (400), rejects fractional stock (400), unknown id is 404", async () => {
    const id = await create();
    expect((await send(PATCH, "PATCH", { stock: 1 })).status).toBe(400);
    expect((await send(PATCH, "PATCH", [])).status).toBe(400);
    expect((await send(PATCH, "PATCH", "garbage")).status).toBe(400);
    expect((await send(PATCH, "PATCH", { medicationId: id, stock: 2.5 })).status).toBe(400);
    expect((await send(PATCH, "PATCH", { medicationId: "nope", stock: 1 })).status).toBe(404);
    expect((await (await GET(new NextRequest(url(`?id=${id}`)))).json()).medication.stock).toBe(5);
  });

  test("another clinic sees nothing and cannot PATCH or DELETE (404), data unchanged", async () => {
    const id = await create();
    clinic = CLINIC_B;
    expect((await (await GET(new NextRequest(url()))).json()).count).toBe(0);
    expect((await GET(new NextRequest(url(`?id=${id}`)))).status).toBe(404);
    expect((await send(PATCH, "PATCH", { medicationId: id, stock: 99 })).status).toBe(404);
    expect((await send(DELETE, "DELETE", undefined as never, `?id=${id}`)).status).toBe(404);
    clinic = CLINIC_A;
    expect((await (await GET(new NextRequest(url(`?id=${id}`)))).json()).medication.stock).toBe(5);
  });

  test("GET with unsafe id or dispensesFor is 404 before any search", async () => {
    expect((await GET(new NextRequest(url("?id=a%7Cb")))).status).toBe(404);
    expect((await GET(new NextRequest(url("?dispensesFor=x%20y")))).status).toBe(404);
  });

  test("GET dispensesFor returns the audit list for the signed-in clinic", async () => {
    const res = await GET(new NextRequest(url("?dispensesFor=enc1")));
    expect(await res.json()).toEqual({ success: true, dispenses: [] });
  });

  test("DELETE requires id (400) and removes the item for the owner", async () => {
    const id = await create();
    expect((await send(DELETE, "DELETE", undefined as never)).status).toBe(400);
    expect((await send(DELETE, "DELETE", undefined as never, `?id=${id}`)).status).toBe(200);
    expect((await GET(new NextRequest(url(`?id=${id}`)))).status).toBe(404);
  });
});
