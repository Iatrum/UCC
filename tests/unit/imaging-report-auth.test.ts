import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { OperationOutcomeError, notFound } from "@medplum/core";
import { createHash } from "node:crypto";

// Fake data only. Task 355: POST /api/imaging/report must fail closed with per-device key auth.
const hash = (k: string) => createHash("sha256").update(k).digest("hex");
const HASH_SYSTEM = "https://ucc.emr/device/api-key-sha256";
const XRAY_TYPE = "https://ucc.emr/xray/device-type";
const KEY_A = "ucc_dk_fake-clinic-a-key";
const KEY_POCT = "ucc_dk_fake-poct-analyser-key";
const KEY_REVOKED = "ucc_dk_fake-revoked-key";
const KEY_INACTIVE = "ucc_dk_fake-inactive-key";

const xrayDevice = (id: string, clinic: string, key: string, status = "active", withHash = true) => ({
  resourceType: "Device", id, status,
  identifier: [{ system: "clinic", value: clinic }, ...(withHash ? [{ system: HASH_SYSTEM, value: hash(key) }] : [])],
  type: { coding: [{ system: XRAY_TYPE, code: "dx" }] },
});
const devices = [
  xrayDevice("dev-a", "clinic-a", KEY_A),
  xrayDevice("dev-inactive", "clinic-a", KEY_INACTIVE, "inactive"),
  { resourceType: "Device", id: "dev-poct", status: "active",
    identifier: [{ system: "clinic", value: "clinic-a" }, { system: HASH_SYSTEM, value: hash(KEY_POCT) }],
    type: { coding: [{ system: "https://ucc.emr/poct/analyser-type", code: "glucose" }] } },
  // KEY_REVOKED: the Device exists but its hash was removed, so the key matches nothing.
  xrayDevice("dev-revoked", "clinic-a", KEY_REVOKED, "active", false),
];
const clinicId = (c: string) => [{ system: "clinic", value: c }];
const store: Record<string, any> = {
  "ServiceRequest/sr-a": { resourceType: "ServiceRequest", id: "sr-a", identifier: clinicId("clinic-a") },
  "ServiceRequest/sr-b": { resourceType: "ServiceRequest", id: "sr-b", identifier: clinicId("clinic-b") },
  "ImagingStudy/is-a": { resourceType: "ImagingStudy", id: "is-a", identifier: clinicId("clinic-a"), basedOn: [{ reference: "ServiceRequest/sr-a" }], subject: { reference: "Patient/p-a" } },
  "ImagingStudy/is-b": { resourceType: "ImagingStudy", id: "is-b", identifier: clinicId("clinic-b"), basedOn: [{ reference: "ServiceRequest/sr-b" }], subject: { reference: "Patient/p-b" } },
  // Study stamped clinic-a but based on a clinic-b order (inconsistent): must still be refused.
  "ImagingStudy/is-mixed": { resourceType: "ImagingStudy", id: "is-mixed", identifier: clinicId("clinic-a"), basedOn: [{ reference: "ServiceRequest/sr-b" }], subject: { reference: "Patient/p-b" } },
  "ImagingStudy/is-orphan": { resourceType: "ImagingStudy", id: "is-orphan", identifier: clinicId("clinic-a"), subject: { reference: "Patient/p-a" } },
  "ImagingStudy/is-unstamped": { resourceType: "ImagingStudy", id: "is-unstamped", basedOn: [{ reference: "ServiceRequest/sr-a" }], subject: { reference: "Patient/p-a" } },
};
const created: any[] = [];
const fake: any = {
  async searchResources(type: string, query: any) {
    if (type !== "Device") return [];
    const wanted = String(query.identifier).split("|")[1];
    return devices.filter((d) => d.identifier.some((i) => i.system === HASH_SYSTEM && i.value === wanted));
  },
  async readResource(type: string, id: string) {
    const r = store[`${type}/${id}`] ?? created.find((c, i) => `new-${i + 1}` === id && c.resourceType === type);
    if (!r) throw new OperationOutcomeError(notFound);
    return r;
  },
  async createResource(r: any) { created.push(r); return { ...r, id: `new-${created.length}` }; },
  async updateResource(r: any) { return r; },
  async post() { return {}; },
};

let pacsEnabled = true;
const registry = await import("@/lib/module-registry");
const realAdmin = await import("@/lib/server/medplum-admin");
mock.module("@/lib/server/medplum-admin", () => ({ ...realAdmin, getAdminMedplum: async () => fake }));
mock.module("@/lib/module-registry", () => ({ ...registry, isModuleEnabledForClinic: async () => pacsEnabled }));

const { POST } = await import("../../app/(routes)/api/imaging/report/route");

const payload = (over: Record<string, unknown> = {}) => ({ imagingStudyId: "is-a", findings: "Fake findings", impression: "Fake impression", ...over });
const call = (body: unknown, headers: Record<string, string> = {}, raw?: string) =>
  POST(new NextRequest("http://localhost/api/imaging/report", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw ?? JSON.stringify(body) }));
const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

beforeEach(() => { created.length = 0; pacsEnabled = true; });
afterAll(() => {
  mock.module("@/lib/server/medplum-admin", () => realAdmin);
  mock.module("@/lib/module-registry", () => registry);
});

describe("POST /api/imaging/report is device-key authenticated and clinic-scoped", () => {
  test("401 with no key, even when PACS_API_KEY is unset (no longer fails open)", async () => {
    delete process.env.PACS_API_KEY;
    expect((await call(payload())).status).toBe(401);
    expect((await call(payload(), { "x-device-key": "" })).status).toBe(401);
    expect(created).toHaveLength(0);
  });

  test("401 on malformed, unknown, revoked, inactive, and wrong-type (POCT) keys; legacy body apiKey is treated the same", async () => {
    for (const key of ["not-a-device-key", "ucc_dk_fake-unknown-key", KEY_REVOKED, KEY_INACTIVE, KEY_POCT]) {
      expect((await call(payload(), bearer(key))).status).toBe(401);
      expect((await call(payload({ apiKey: key }))).status).toBe(401);
    }
    expect(created).toHaveLength(0);
  });

  test("a legacy PACS_API_KEY value in the body no longer authenticates", async () => {
    process.env.PACS_API_KEY = "shared-legacy-key";
    try {
      expect((await call(payload({ apiKey: "shared-legacy-key" }))).status).toBe(401);
    } finally { delete process.env.PACS_API_KEY; }
    expect(created).toHaveLength(0);
  });

  test("a bad JSON body without a key is 401 (auth first); with a valid key it is 400", async () => {
    expect((await call(undefined, {}, "{not json")).status).toBe(401);
    expect((await call(undefined, bearer(KEY_A), "{not json")).status).toBe(400);
  });

  test("403 when the PACS module toggle is off for the device's clinic", async () => {
    pacsEnabled = false;
    expect((await call(payload(), bearer(KEY_A))).status).toBe(403);
    expect(created).toHaveLength(0);
  });

  test("403 when the study or its order belongs to another clinic (all key transports)", async () => {
    for (const imagingStudyId of ["is-b", "is-mixed"]) {
      expect((await call(payload({ imagingStudyId }), bearer(KEY_A))).status).toBe(403);
      expect((await call(payload({ imagingStudyId }), { "x-device-key": KEY_A })).status).toBe(403);
      expect((await call(payload({ imagingStudyId, apiKey: KEY_A }))).status).toBe(403);
    }
    expect(created).toHaveLength(0);
  });

  test("403 (fail closed) when the study has no clinic identifier or no originating order", async () => {
    for (const imagingStudyId of ["is-unstamped", "is-orphan"]) {
      expect((await call(payload({ imagingStudyId }), bearer(KEY_A))).status).toBe(403);
    }
    expect(created).toHaveLength(0);
  });

  test("400 on missing/invalid fields after auth; nothing is written", async () => {
    expect((await call(payload({ imagingStudyId: undefined }), bearer(KEY_A))).status).toBe(400);
    expect((await call(payload({ findings: "" }), bearer(KEY_A))).status).toBe(400);
    expect((await call(payload({ status: "amended" }), bearer(KEY_A))).status).toBe(400);
    expect(created).toHaveLength(0);
  });

  test("a valid clinic-a key reports on a clinic-a study; the clinic stamp comes from the Device", async () => {
    const res = await call(payload({ status: "preliminary", radiologist: "Dr Fake" }), bearer(KEY_A));
    expect(res.status).toBe(200);
    const report = created.find((r) => r.resourceType === "DiagnosticReport");
    expect(report.identifier).toEqual([{ system: "clinic", value: "clinic-a" }]);
    expect(report.status).toBe("preliminary");
    expect(report.imagingStudy).toEqual([{ reference: "ImagingStudy/is-a" }]);
    expect((await call(payload(), { "x-device-key": KEY_A })).status).toBe(200);
  });
});
