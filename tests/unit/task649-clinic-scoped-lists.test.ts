import { afterAll, describe, expect, it, mock } from "bun:test";
import { NextRequest } from "next/server";

// Task 649: list routes must put the clinic in the Medplum search and follow every page.
// Fake data only; a fake Medplum client replays the search semantics (AND of repeated params, paging).
type Row = { resourceType: string; id: string; identifier?: { system: string; value: string }[]; code?: any; name?: string };

const PAGE = 100;
let store: Row[] = [];
let searches: URLSearchParams[] = [];
let currentClinic = "clinic-a";

function matches(row: Row, key: string, value: string): boolean {
  const [system, val] = value.split("|");
  if (key === "identifier") return !!row.identifier?.some((i) => i.system === system && i.value === val);
  if (key === "code") return !!row.code?.coding?.some((c: any) => c.system === system && c.code === val);
  return true;
}

const fakeMedplum = {
  async *searchResourcePages(type: string, query: URLSearchParams | Record<string, string>) {
    const q = query instanceof URLSearchParams ? query : new URLSearchParams(query);
    searches.push(q);
    const size = Number(q.get("_count") ?? 20);
    const hits = store.filter(
      (r) => r.resourceType === type && [...q.entries()].every(([k, v]) => !["identifier", "code"].includes(k) || matches(r, k, v))
    );
    for (let i = 0; i < hits.length; i += size) yield hits.slice(i, i + size);
  },
  // The old behaviour: one page only. Must not be used by the routes any more.
  async searchResources() {
    throw new Error("single-page searchResources must not be used");
  },
};

const realAuth = await import("../../lib/server/medplum-auth.ts?task649");
const realAdmin = await import("../../lib/server/medplum-admin.ts?task649");
mock.module("@/lib/server/medplum-auth", () => ({
  ...realAuth,
  requireClinicAuth: async () => ({ clinicId: currentClinic }),
}));
mock.module("@/lib/server/medplum-admin", () => ({ ...realAdmin, getAdminMedplum: async () => fakeMedplum }));
const suppliers = await import("../../app/api/suppliers/route");
const insurers = await import("../../app/api/settings/insurers/route");
const { searchAllPages } = await import("../../lib/server/search-all");
afterAll(() => {
  mock.module("@/lib/server/medplum-auth", () => realAuth);
  mock.module("@/lib/server/medplum-admin", () => realAdmin);
});

const supplier = (id: string, clinic: string): Row => ({
  resourceType: "Organization",
  id,
  name: `Supplier ${id}`,
  identifier: [
    { system: "urn:iatrum:organization-type", value: "supplier" },
    { system: "clinic", value: clinic },
  ],
});
const insurer = (id: string, clinic: string): Row => ({
  resourceType: "Basic",
  id,
  code: { coding: [{ system: "urn:iatrum:resource-type", code: "settings-insurer" }] },
  identifier: [{ system: "clinic", value: clinic }],
  ...({ extension: [{ url: "urn:iatrum:settings/insurer", valueString: JSON.stringify({ name: `Ins ${id}`, value: id }) }] } as any),
});

const get = (url: string) => new NextRequest(`http://localhost${url}`);

describe("GET /api/suppliers", () => {
  it("returns only the own clinic and scopes the search itself", async () => {
    store = [supplier("a1", "clinic-a"), supplier("b1", "clinic-b"), supplier("a2", "clinic-a")];
    searches = [];
    currentClinic = "clinic-a";
    const res = await suppliers.GET(get("/api/suppliers"));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.suppliers.map((s: any) => s.id).sort()).toEqual(["a1", "a2"]);
    expect(body.suppliers[0]).toMatchObject({ id: expect.any(String), name: expect.stringContaining("Supplier") });
    expect(searches[0].getAll("identifier")).toContain("clinic|clinic-a");
    expect(searches[0].getAll("identifier")).toContain("urn:iatrum:organization-type|supplier");
  });

  it("does not truncate beyond 200 rows (own clinic 450, foreign 300 interleaved)", async () => {
    store = [];
    for (let i = 0; i < 450; i++) {
      store.push(supplier(`a${i}`, "clinic-a"));
      if (i < 300) store.push(supplier(`b${i}`, "clinic-b"));
    }
    currentClinic = "clinic-a";
    const body = await (await suppliers.GET(get("/api/suppliers"))).json();
    expect(body.suppliers).toHaveLength(450);
    expect(new Set(body.suppliers.map((s: any) => s.id)).size).toBe(450);
  });

  it("never returns foreign rows, even if the search layer returned them", async () => {
    store = [supplier("b1", "clinic-b"), supplier("b2", "clinic-b")];
    currentClinic = "clinic-a";
    expect((await (await suppliers.GET(get("/api/suppliers"))).json()).suppliers).toEqual([]);
    // Defence in depth: a leaky fake that ignores the clinic filter must still be filtered in code.
    const leaky = { async *searchResourcePages() { yield [supplier("b1", "clinic-b"), supplier("a1", "clinic-a")]; } };
    mock.module("@/lib/server/medplum-admin", () => ({ ...realAdmin, getAdminMedplum: async () => leaky }));
    const route = await import("../../app/api/suppliers/route?leaky");
    const body = await (await route.GET(get("/api/suppliers"))).json();
    expect(body.suppliers.map((s: any) => s.id)).toEqual(["a1"]);
    mock.module("@/lib/server/medplum-admin", () => ({ ...realAdmin, getAdminMedplum: async () => fakeMedplum }));
  });
});

describe("GET /api/settings/insurers", () => {
  it("is clinic-scoped, complete past 500 rows, and own clinic only", async () => {
    store = [];
    for (let i = 0; i < 520; i++) store.push(insurer(`a${i}`, "clinic-a"));
    for (let i = 0; i < 50; i++) store.push(insurer(`b${i}`, "clinic-b"));
    searches = [];
    currentClinic = "clinic-a";
    const body = await (await insurers.GET(get("/api/settings/insurers"))).json();
    expect(body.insurers).toHaveLength(520);
    expect(body.insurers.every((i: any) => i.id.startsWith("a"))).toBe(true);
    expect(searches[0].get("identifier")).toBe("clinic|clinic-a");
    expect(searches.length).toBe(1);
  });
});

describe("searchAllPages", () => {
  it("follows every page and sends the page size as _count", async () => {
    store = Array.from({ length: 250 }, (_, i) => supplier(`s${i}`, "clinic-a"));
    searches = [];
    const out = await searchAllPages(fakeMedplum as any, "Organization", { identifier: "clinic|clinic-a" });
    expect(out).toHaveLength(250);
    expect(searches[0].get("_count")).toBe(String(PAGE));
  });
});
