import { afterAll, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

// Fake data only. Task 691: valid device requests still succeed after the Task 690 hardening.
const hash = (k: string) => createHash("sha256").update(k).digest("hex");
const KEY = "ucc_dk_fake-task691-key";
const device = {
  resourceType: "Device", id: "dev-1", status: "active",
  identifier: [{ system: "clinic", value: "clinic-a" }, { system: "https://ucc.emr/device/api-key-sha256", value: hash(KEY) }],
  type: { coding: [{ system: "https://ucc.emr/xray/device-type", code: "dx" }, { system: "https://ucc.emr/poct/analyser-type", code: "fake" }] },
};
const fakeMedplum = { searchResources: async () => [device], searchOne: async () => undefined };
const calls: Record<string, unknown[]> = {};

const realImaging = { ...(await import("@/lib/fhir/imaging-service")) };
const realLab = { ...(await import("@/lib/fhir/lab-service")) };
mock.module("@/lib/server/medplum-admin", () => ({ getAdminMedplum: async () => fakeMedplum }));
mock.module("@/lib/module-registry", () => ({ isModuleEnabledForClinic: async () => true }));
mock.module("@/lib/fhir/imaging-service", () => ({
  ...realImaging,
  receiveImagingStudy: async (...a: unknown[]) => { calls.receive = a; return "study-1"; },
  createImagingReport: async (...a: unknown[]) => { calls.report = a; return "report-1"; },
}));
mock.module("@/lib/fhir/lab-service", () => ({
  ...realLab,
  receiveLabResults: async (...a: unknown[]) => { calls.lab = a; return "dr-1"; },
}));
afterAll(() => {
  mock.module("@/lib/fhir/imaging-service", () => realImaging);
  mock.module("@/lib/fhir/lab-service", () => realLab);
});

const { POST: receive } = await import("@/app/(routes)/api/imaging/receive/route");
const { POST: report } = await import("@/app/(routes)/api/imaging/report/route");
const { POST: labs } = await import("@/app/(routes)/api/labs/receive/route");

let n = 0;
const req = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3210${path}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, "x-forwarded-for": `192.0.2.${++n}`, ...headers },
  });

describe("device ingress happy paths (Task 691)", () => {
  test("imaging/receive with a valid study is stored, scoped to the device clinic", async () => {
    const res = await receive(req("/api/imaging/receive", { serviceRequestId: "sr-1", study: { studyUid: "1.2.840.1", series: [{ seriesUid: "1.2.3" }] } }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(calls.receive?.[0]).toBe("sr-1");
    expect(calls.receive?.[3]).toBe("clinic-a");
  });

  test("imaging/receive accepts the key in the body (legacy apiKey) too", async () => {
    const res = await receive(req("/api/imaging/receive", { apiKey: KEY, serviceRequestId: "sr-1", study: { studyUid: "1.2", series: [] } }, { authorization: "" }));
    expect(res.status).toBe(200);
  });

  test("imaging/report with valid text succeeds (status defaults to final)", async () => {
    const res = await report(req("/api/imaging/report", { imagingStudyId: "st-1", findings: "Clear lungs", impression: "Normal", radiologist: "Dr Fake" }));
    expect(res.status).toBe(200);
    expect(calls.report?.[3]).toBe("final");
    expect(calls.report?.[6]).toBe("clinic-a");
  });

  test("labs/receive with a valid payload succeeds", async () => {
    const res = await labs(req("/api/labs/receive", { serviceRequestId: "sr-2", results: [{ testCode: "GLU", testName: "Glucose", value: 5.4, unit: "mmol/L", status: "final" }] }));
    expect(res.status).toBe(200);
    expect(calls.lab?.[0]).toBe("sr-2");
  });
});
