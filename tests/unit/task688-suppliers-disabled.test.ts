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
// Other unit files mock this flag to true and leave it in Bun's shared module cache, so pin the real value (false)
// and load a private route instance.
mock.module("@/lib/purchasing", () => ({ INVENTORY_PURCHASING_ENABLED: false, INVENTORY_PURCHASING_DISABLED_ERROR: ERR }));
const disabled = await import("../../app/api/suppliers/route?task688-disabled");

afterAll(() => {
  mock.module("@/lib/server/medplum-auth", () => realAuth);
  mock.module("@/lib/server/medplum-admin", () => realAdminClient);
});

beforeEach(() => {
  clinic = "fake-clinic-a";
  orgs = new Map([["s1", org("s1", "fake-clinic-a")], ["s2", org("s2", "fake-clinic-b")]]);
  writes = []; searches = []; seq = 0;
});

const req = (method: string, body?: unknown, qs = "") =>
  new NextRequest(`http://localhost/api/suppliers${qs}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("purchasing disabled (current setting, real flag)", () => {
  test("POST, PATCH and DELETE answer 403 and write nothing", async () => {
    for (const res of [
      await disabled.POST(req("POST", { name: "X" })),
      await disabled.PATCH(req("PATCH", { id: "s1", name: "Y" })),
      await disabled.DELETE(req("DELETE", undefined, "?id=s1")),
    ]) {
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(ERR);
    }
    expect(writes).toEqual([]);
  });
  test("GET still lists this clinic's suppliers", async () => {
    expect((await (await disabled.GET(req("GET"))).json()).suppliers.map((s: any) => s.id)).toEqual(["s1"]);
  });
});

