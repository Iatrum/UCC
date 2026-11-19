import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

// Task 688: /api/suppliers clinic scope + the purchasing kill-switch. Fake data only.
const realAuth = await import("@/lib/server/medplum-auth");
const realAdminClient = await import("@/lib/server/medplum-admin");

type Org = { resourceType: "Organization"; id: string; [k: string]: any };
const org = (id: string, clinic: string, over: Partial<Org> = {}): Org => ({
  resourceType: "Organization", id, name: `Fake Supplier ${id}`,
  identifier: [{ system: "urn:iatrum:organization-type", value: "supplier" }, { system: "clinic", value: clinic }], ...over,
});

let clinic = "fake-clinic-a";
let orgs = new Map<string, Org>();
let writes: string[] = [];
let searches: URLSearchParams[] = [];
let seq = 0;
const fake: any = {
  async *searchResourcePages(_type: string, q: URLSearchParams) {
    searches.push(new URLSearchParams(q));
    // Deliberately ignores the clinic filter so the route's own re-filter is what is under test.
    yield [...orgs.values()];
  },
  async readResource(_t: string, id: string) {
    const r = orgs.get(id);
    if (!r) throw Object.assign(new Error("not found"), { name: "NotFoundError" });
    return structuredClone(r);
  },
  async createResource(r: Org) { writes.push("create"); const c = { ...structuredClone(r), id: `new-${++seq}` }; orgs.set(c.id, c); return structuredClone(c); },
  async updateResource(r: Org) { writes.push("update"); orgs.set(r.id, structuredClone(r)); return structuredClone(r); },
  async deleteResource(_t: string, id: string) { writes.push("delete"); orgs.delete(id); },
};
mock.module("@/lib/server/medplum-auth", () => ({ ...realAuth, requireClinicAuth: async () => ({ medplum: fake, clinicId: clinic }) }));
mock.module("@/lib/server/medplum-admin", () => ({ ...realAdminClient, getAdminMedplum: async () => fake }));
const ERR = "Inventory purchasing is temporarily disabled";
mock.module("@/lib/purchasing", () => ({ INVENTORY_PURCHASING_ENABLED: true, INVENTORY_PURCHASING_DISABLED_ERROR: ERR }));
const enabled = await import("../../app/api/suppliers/route?task688-enabled");

afterAll(() => {
  mock.module("@/lib/server/medplum-auth", () => realAuth);
  mock.module("@/lib/server/medplum-admin", () => realAdminClient);
  mock.module("@/lib/purchasing", () => ({ INVENTORY_PURCHASING_ENABLED: false, INVENTORY_PURCHASING_DISABLED_ERROR: ERR }));
});

beforeEach(() => {
  clinic = "fake-clinic-a";
  orgs = new Map([["s1", org("s1", "fake-clinic-a")], ["s2", org("s2", "fake-clinic-b")]]);
  writes = []; searches = []; seq = 0;
});

const req = (method: string, body?: unknown, qs = "") =>
  new NextRequest(`http://localhost/api/suppliers${qs}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("purchasing enabled", () => {
  test("GET searches with supplier AND clinic identifiers and re-filters foreign rows; maps fields", async () => {
    orgs.set("s1", org("s1", "fake-clinic-a", {
      telecom: [{ system: "phone", value: "0123" }, { system: "email", value: "a@fake.test" }],
      address: [{ text: "1 Fake St" }],
      extension: [{ url: "urn:iatrum:supplier/contactPerson", valueString: "Fake Person" }, { url: "urn:iatrum:supplier/notes", valueString: "n" }],
    }));
    const body = await (await enabled.GET(req("GET"))).json();
    expect(body.suppliers).toEqual([{ id: "s1", name: "Fake Supplier s1", contactPerson: "Fake Person", phone: "0123", email: "a@fake.test", address: "1 Fake St", notes: "n", createdAt: undefined, updatedAt: undefined }]);
    expect(searches[0].getAll("identifier")).toEqual(["urn:iatrum:organization-type|supplier", "clinic|fake-clinic-a"]);
  });

  test("POST requires a non-blank name (400) and stamps supplier + clinic identifiers", async () => {
    expect((await enabled.POST(req("POST", { name: "   " }))).status).toBe(400);
    expect((await enabled.POST(req("POST", {}))).status).toBe(400);
    expect(writes).toEqual([]);
    const res = await enabled.POST(req("POST", { name: "New Co", phone: "999", notes: "hi" }));
    const { supplier } = await res.json();
    expect(supplier).toMatchObject({ name: "New Co", phone: "999", notes: "hi" });
    const stored = orgs.get(supplier.id)!;
    expect(stored.identifier).toEqual([{ system: "urn:iatrum:organization-type", value: "supplier" }, { system: "clinic", value: "fake-clinic-a" }]);
    expect(stored.telecom).toEqual([{ system: "phone", value: "999" }]);
  });

  test("PATCH merges onto the existing record; clearing a field removes it", async () => {
    orgs.set("s1", org("s1", "fake-clinic-a", { telecom: [{ system: "phone", value: "0123" }, { system: "email", value: "a@fake.test" }] }));
    const res = await enabled.PATCH(req("PATCH", { id: "s1", name: "Renamed", phone: "" }));
    const { supplier } = await res.json();
    expect(supplier).toMatchObject({ id: "s1", name: "Renamed", email: "a@fake.test" });
    expect(supplier.phone).toBeUndefined();
    expect(orgs.get("s1")!.identifier).toContainEqual({ system: "clinic", value: "fake-clinic-a" });
  });

  test("PATCH/DELETE: missing id 400, unsafe id rejected, foreign clinic 404 with no write", async () => {
    expect((await enabled.PATCH(req("PATCH", { name: "x" }))).status).toBe(400);
    expect((await enabled.DELETE(req("DELETE"))).status).toBe(400);
    expect((await enabled.PATCH(req("PATCH", { id: "a|b", name: "x" }))).status).toBeGreaterThanOrEqual(400);
    expect((await enabled.DELETE(req("DELETE", undefined, "?id=a%7Cb"))).status).toBeGreaterThanOrEqual(400);
    expect((await enabled.PATCH(req("PATCH", { id: "s2", name: "hijack" }))).status).toBe(404);
    expect((await enabled.DELETE(req("DELETE", undefined, "?id=s2"))).status).toBe(404);
    expect(writes).toEqual([]);
    expect(orgs.get("s2")!.name).toBe("Fake Supplier s2");
  });

  test("DELETE removes the owner's supplier", async () => {
    expect((await enabled.DELETE(req("DELETE", undefined, "?id=s1"))).status).toBe(200);
    expect(orgs.has("s1")).toBe(false);
    expect(writes).toEqual(["delete"]);
  });
});
