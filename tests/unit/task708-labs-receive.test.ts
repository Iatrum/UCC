import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { NextRequest } from "next/server";
import { OperationOutcomeError, notFound } from "@medplum/core";
import { DEVICE_KEY_HASH_SYSTEM, hashDeviceKey } from "@/lib/fhir/device-keys";
import { POCT_TYPE_SYSTEM } from "@/lib/fhir/poct-device";
import * as admin from "@/lib/server/medplum-admin";
import * as modules from "@/lib/module-registry";

const { POST } = await import("../../app/(routes)/api/labs/receive/route");
const clinicId = "fake-lab-clinic-a";
const otherClinicId = "fake-lab-clinic-b";
const key = "ucc_dk_fake-task708-analyser";
const result = { testCode: "2339-0", testName: "Glucose", value: 5, unit: "mmol/L" };
const device = {
  resourceType: "Device",
  id: "fake-task708-analyser",
  status: "active",
  identifier: [
    { system: "clinic", value: clinicId },
    { system: DEVICE_KEY_HASH_SYSTEM, value: hashDeviceKey(key) },
  ],
  type: { coding: [{ system: POCT_TYPE_SYSTEM, code: "glucose" }] },
};

const searchResources = mock(async (_type: string, _query: Record<string, string>) => [device]);
const readResource = mock(async (_type: string, id: string) => {
  if (id === "fake-missing-order") throw new OperationOutcomeError(notFound);
  return {
    resourceType: "ServiceRequest",
    id,
    identifier: [{ system: "clinic", value: otherClinicId }],
    subject: { reference: "Patient/fake-other-clinic-patient" },
  };
});
const rejectWrite = () => { throw new Error("Rejected lab requests must never write"); };
const executeBatch = mock(rejectWrite);
const createResource = mock(rejectWrite);
const post = mock(rejectWrite);
const updateResource = mock(rejectWrite);
const writes = [executeBatch, createResource, post, updateResource];
const medplum = { searchResources, readResource, executeBatch, createResource, post, updateResource };
const restorers: (() => void)[] = [];
let requestNumber = 0;

beforeEach(() => {
  searchResources.mockClear();
  readResource.mockClear();
  writes.forEach((write) => write.mockClear());
  const adminSpy = spyOn(admin, "getAdminMedplum").mockResolvedValue(medplum as never);
  const modulesSpy = spyOn(modules, "isModuleEnabledForClinic").mockResolvedValue(true);
  restorers.push(() => adminSpy.mockRestore(), () => modulesSpy.mockRestore());
});

afterEach(() => {
  restorers.splice(0).forEach((restore) => restore());
});

function receive(serviceRequestId: string, statuses: { status?: unknown }[]) {
  return POST(new NextRequest("http://localhost/api/labs/receive", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${++requestNumber}`,
      "x-clinic-id": otherClinicId,
    },
    body: JSON.stringify({
      serviceRequestId,
      clinicId: otherClinicId,
      results: statuses.map((status) => ({ ...result, ...status })),
    }),
  }));
}

describe("POST /api/labs/receive", () => {
  test.each([
    ["missing", {}, "is required"],
    ["invalid", { status: "complete" }, "must be one of"],
  ] as const)("rejects %s result status before looking up the order", async (_name, status, message) => {
    const response = await receive("fake-foreign-order", [{ status: "final" }, status]);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toStartWith(`results[1].status ${message}`);
    expect(searchResources).toHaveBeenCalledWith("Device", {
      identifier: `${DEVICE_KEY_HASH_SYSTEM}|${hashDeviceKey(key)}`,
      _count: "2",
    }, { cache: "no-cache" });
    expect(readResource).not.toHaveBeenCalled();
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  });

  test("treats a foreign order like a missing order even when the request claims its clinic", async () => {
    const foreign = await receive("fake-foreign-order", [{ status: "final" }]);
    const missing = await receive("fake-missing-order", [{ status: "final" }]);

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: "Order not found" });
    expect(await missing.json()).toEqual({ error: "Order not found" });
    expect(readResource.mock.calls.map(([, id]) => id)).toEqual(["fake-foreign-order", "fake-missing-order"]);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  });
});
