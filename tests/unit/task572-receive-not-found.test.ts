import { describe, expect, it } from "bun:test";
import { OperationOutcomeError, notFound as notFoundOutcome } from "@medplum/core";
import { readDeviceOrderOrNotFound } from "../../lib/fhir/clinic-tenancy";
import { receiveLabResults } from "../../lib/fhir/lab-service";
import { receiveImagingStudy } from "../../lib/fhir/imaging-service";
import { NotFoundError } from "../../lib/server/route-helpers";

function fakeMedplum(order?: any) {
  const writes: string[] = [];
  const client: any = {
    readResource: async () => {
      if (!order) throw new OperationOutcomeError(notFoundOutcome);
      return order;
    },
    createResource: async () => { writes.push("create"); },
    updateResource: async () => { writes.push("update"); },
    executeBatch: async () => { writes.push("batch"); },
    searchResources: async () => [],
    searchOne: async () => undefined,
  };
  return { client, writes };
}
const foreignOrder = { resourceType: "ServiceRequest", id: "sr1", identifier: [{ system: "clinic", value: "other-clinic" }] };
const study: any = { studyUid: "1.2.3" };
const results: any = [{ testCode: "x", testName: "x", value: 1, status: "final" }];

async function msg(p: Promise<unknown>) {
  try { await p; } catch (e: any) { return { name: e?.name, message: e?.message }; }
  return null;
}

describe("Task 572: unknown/foreign order => NotFoundError, zero writes", () => {
  it("unknown order id", async () => {
    const { client, writes } = fakeMedplum();
    await expect(readDeviceOrderOrNotFound(client, "nope", "c1")).rejects.toBeInstanceOf(NotFoundError);
    expect(writes).toEqual([]);
  });
  it("foreign clinic is indistinguishable from unknown", async () => {
    const unknown = await msg(readDeviceOrderOrNotFound(fakeMedplum().client, "nope", "c1"));
    const foreign = await msg(readDeviceOrderOrNotFound(fakeMedplum(foreignOrder).client, "sr1", "c1"));
    expect(foreign).toEqual(unknown);
    expect(foreign?.name).toBe("NotFoundError");
  });
  it("untagged order is NotFound too", async () => {
    const r = await msg(readDeviceOrderOrNotFound(fakeMedplum({ resourceType: "ServiceRequest", id: "s" }).client, "s", "c1"));
    expect(r?.name).toBe("NotFoundError");
  });
  it("own-clinic order is returned", async () => {
    const own = { resourceType: "ServiceRequest", id: "s", identifier: [{ system: "clinic", value: "c1" }] };
    expect(await readDeviceOrderOrNotFound(fakeMedplum(own).client, "s", "c1")).toBe(own as any);
  });
  it("non-404 read errors still propagate", async () => {
    const client: any = { readResource: async () => { throw new Error("boom"); } };
    await expect(readDeviceOrderOrNotFound(client, "s", "c1")).rejects.toThrow("boom");
  });
  it("receiveLabResults / receiveImagingStudy: NotFound and no writes", async () => {
    for (const order of [undefined, foreignOrder]) {
      const a = fakeMedplum(order);
      expect((await msg(receiveLabResults("sr1", results, undefined, a.client, "c1")))?.name).toBe("NotFoundError");
      expect(a.writes).toEqual([]);
      const b = fakeMedplum(order);
      expect((await msg(receiveImagingStudy("sr1", study, b.client, "c1")))?.name).toBe("NotFoundError");
      expect(b.writes).toEqual([]);
    }
  });
});
