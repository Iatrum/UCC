import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const po = (id: string, clinic: string, extra: Record<string, unknown> = {}) => ({
  resourceType: "Basic",
  id,
  code: { coding: [{ system: "urn:iatrum:resource-type", code: "purchase-order" }] },
  identifier: [{ system: "clinic", value: clinic }],
  extension: [{ url: "urn:iatrum:purchase-order/data", valueString: JSON.stringify({ supplierName: id, ...extra }) }],
});
const otherBasic = (id: string, clinic: string) => ({
  resourceType: "Basic",
  id,
  code: { coding: [{ system: "urn:other", code: "something" }] },
  identifier: [{ system: "clinic", value: clinic }],
});

let store: any[] = [];
const searchCalls: any[] = [];
const fakeMedplum = {
  async readResource(_t: string, id: string) {
    const r = store.find((x) => x.id === id);
    if (!r) throw new Error("not found");
    return r;
  },
  deleteResource: mock(async () => {}),
  updateResource: mock(async (r: any) => r),
  createResource: mock(async (r: any) => r),
  // Honours the clinic identifier filter server-side and pages by _count.
  async *searchResourcePages(_t: string, params: Record<string, string>) {
    searchCalls.push(params);
    const [, clinic] = params.identifier ? params.identifier.split("|") : [null, null];
    const [csys, ccode] = params.code.split("|");
    const all = store.filter(
      (r) =>
        (!clinic || r.identifier?.some((i: any) => i.system === "clinic" && i.value === clinic)) &&
        r.code?.coding?.some((c: any) => c.system === csys && c.code === ccode)
    );
    const n = Number(params._count);
    for (let i = 0; i < all.length; i += n) yield all.slice(i, i + n);
  },
};

mock.module("@/lib/server/medplum-admin", () => ({ getAdminMedplum: async () => fakeMedplum }));
// PATCH/DELETE short-circuit with 403 while purchasing is switched off, which
// would hide the clinic/type 404 guard. Enable it so the guard is what we test.
mock.module("@/lib/purchasing", () => ({
  INVENTORY_PURCHASING_ENABLED: true,
  INVENTORY_PURCHASING_DISABLED_ERROR: "Inventory purchasing is temporarily disabled",
}));
mock.module("@/lib/server/medplum-auth", () => ({ requireClinicAuth: async () => ({ clinicId: "clinic-a" }) }));

const { GET, DELETE, PATCH } = await import("@/app/api/purchases/route");
const { listClinicPurchaseOrders } = await import("@/lib/server/purchase-orders");

const get = (qs = "") => GET(new NextRequest(`http://localhost/api/purchases${qs}`));

beforeEach(() => {
  store = [];
  searchCalls.length = 0;
  fakeMedplum.deleteResource.mockClear();
  fakeMedplum.updateResource.mockClear();
});

describe("GET /api/purchases list is clinic-scoped server-side", () => {
  test("search carries the clinic identifier filter", async () => {
    store = [po("a1", "clinic-a")];
    await get();
    expect(searchCalls[0].identifier).toBe("clinic|clinic-a");
  });

  test("other clinics' orders cannot crowd out a clinic's own; all pages followed", async () => {
    // 600 newer orders from clinic-b, then 250 of clinic-a (> one page of 100, and > old 500 cap overall)
    const b = Array.from({ length: 600 }, (_, i) => po(`b${i}`, "clinic-b"));
    const a = Array.from({ length: 250 }, (_, i) => po(`a${i}`, "clinic-a"));
    store = [...b, ...a];
    const body = await (await get()).json();
    expect(body.purchaseOrders).toHaveLength(250);
    expect(body.purchaseOrders.every((o: any) => String(o.id).startsWith("a"))).toBe(true);
  });

  test("helper drops foreign / non-PO resources even if the server returned them", async () => {
    const leaky = {
      async *searchResourcePages() {
        yield [po("a1", "clinic-a"), po("b1", "clinic-b"), otherBasic("x", "clinic-a")];
      },
    };
    const res = await listClinicPurchaseOrders(leaky as any, "clinic-a");
    expect(res.map((r) => r.id)).toEqual(["a1"]);
  });
});

describe("same-clinic Basic that is not a purchase order -> 404", () => {
  test("GET ?id= returns 404, not 500", async () => {
    store = [otherBasic("x", "clinic-a")];
    const res = await get("?id=x");
    expect(res.status).toBe(404);
  });

  test("GET ?id= of a real PO still works; other clinic's PO is 404", async () => {
    store = [po("a1", "clinic-a"), po("b1", "clinic-b")];
    expect((await get("?id=a1")).status).toBe(200);
    expect((await get("?id=b1")).status).toBe(404);
  });

  test("DELETE never deletes a non-PO Basic", async () => {
    store = [otherBasic("x", "clinic-a")];
    const res = await DELETE(new NextRequest("http://localhost/api/purchases?id=x", { method: "DELETE" }));
    expect(res.status).toBe(404);
    expect(fakeMedplum.deleteResource).not.toHaveBeenCalled();
  });

  test("DELETE of another clinic's PO is 404 and deletes nothing", async () => {
    store = [po("b1", "clinic-b")];
    const res = await DELETE(new NextRequest("http://localhost/api/purchases?id=b1", { method: "DELETE" }));
    expect(res.status).toBe(404);
    expect(fakeMedplum.deleteResource).not.toHaveBeenCalled();
  });

  test("PATCH of a non-PO Basic is 404 and updates nothing", async () => {
    store = [otherBasic("x", "clinic-a")];
    const res = await PATCH(
      new NextRequest("http://localhost/api/purchases", {
        method: "PATCH",
        body: JSON.stringify({ id: "x", notes: "tamper" }),
      })
    );
    expect(res.status).toBe(404);
    expect(fakeMedplum.updateResource).not.toHaveBeenCalled();
  });

  test("PATCH of another clinic's PO is 404 and updates nothing", async () => {
    store = [po("b1", "clinic-b")];
    const res = await PATCH(
      new NextRequest("http://localhost/api/purchases", {
        method: "PATCH",
        body: JSON.stringify({ id: "b1", notes: "tamper" }),
      })
    );
    expect(res.status).toBe(404);
    expect(fakeMedplum.updateResource).not.toHaveBeenCalled();
  });
});
