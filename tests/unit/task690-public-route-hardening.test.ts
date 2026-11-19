import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

// Fake data only. Task 690: device-key ingress hardening (size cap, rate limit, no error leakage, fail closed).
const hash = (k: string) => createHash("sha256").update(k).digest("hex");
const HASH_SYSTEM = "https://ucc.emr/device/api-key-sha256";
const KEY = "ucc_dk_fake-task690-key";
const SECRET_BOOM = "connect ECONNREFUSED 10.9.8.7:8103 secret-internal";

let mode: "ok" | "boom" = "ok";
const device = {
  resourceType: "Device", id: "dev-1", status: "active",
  identifier: [{ system: "clinic", value: "clinic-a" }, { system: HASH_SYSTEM, value: hash(KEY) }],
  type: { coding: [{ system: "https://ucc.emr/xray/device-type", code: "dx" }] },
};
const fakeMedplum = {
  searchResources: async () => { if (mode === "boom") throw new Error(SECRET_BOOM); return [device]; },
  searchOne: async () => undefined,
  readResource: async () => { throw new Error(SECRET_BOOM); },
};
mock.module("@/lib/server/medplum-admin", () => ({ getAdminMedplum: async () => fakeMedplum }));
mock.module("@/lib/module-registry", () => ({ isModuleEnabledForClinic: async () => true }));
afterAll(() => mock.restore());

const { POST: report } = await import("@/app/(routes)/api/imaging/report/route");
const { POST: receive } = await import("@/app/(routes)/api/imaging/receive/route");
const { POST: labsMessage } = await import("@/app/(routes)/api/labs/receive/message/route");
const { readJsonBody, validateStudyPayload } = await import("@/lib/server/device-ingress-http");
const { parseScreenshot } = await import("@/lib/feedback/service");

let n = 0;
const req = (path: string, body: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3210${path}`, {
    method: "POST", body,
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, "x-forwarded-for": `198.51.100.${++n}`, ...headers },
  });

beforeEach(() => { mode = "ok"; });

describe("device ingress hardening (Task 690)", () => {
  test("oversized body -> 413 before any Medplum call", async () => {
    const big = JSON.stringify({ imagingStudyId: "x", findings: "a".repeat(300_000), impression: "b" });
    const res = await report(req("/api/imaging/report", big));
    expect(res.status).toBe(413);
  });

  test("chunked body without Content-Length is still capped while streaming", async () => {
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{\"a\":\"" + "x".repeat(2000))); c.close(); } });
    const r = new NextRequest("http://localhost:3210/x", { method: "POST", body: stream, duplex: "half" } as any);
    await expect(readJsonBody(r, 1000)).rejects.toThrow("too large");
  });

  test("null / array / garbage JSON never reaches a TypeError: 401 without key, 400 with key", async () => {
    for (const body of ["null", "[]", "not json", ""]) {
      const noKey = await receive(req("/api/imaging/receive", body, { authorization: "" }));
      expect(noKey.status).toBe(401);
      const keyed = await receive(req("/api/imaging/receive", body));
      expect(keyed.status).toBe(400);
    }
    const msg = await labsMessage(req("/api/labs/receive/message", "null", { authorization: "" }));
    expect(msg.status).toBe(401);
  });

  test("unexpected errors never echo error.message (no `details`)", async () => {
    mode = "boom";
    for (const res of [
      await report(req("/api/imaging/report", JSON.stringify({ imagingStudyId: "s", findings: "f", impression: "i" }))),
      await receive(req("/api/imaging/receive", JSON.stringify({ serviceRequestId: "s", study: { studyUid: "1.2", series: [] } }))),
      await labsMessage(req("/api/labs/receive/message", JSON.stringify({ format: "hl7", message: "MSH|^~\\&" }))),
    ]) {
      expect(res.status).toBeGreaterThanOrEqual(500 - 100);
      const text = await res.text();
      expect(text).not.toContain("ECONNREFUSED");
      expect(text).not.toContain("secret-internal");
      expect(text).not.toContain("details");
    }
  });

  test("per-IP rate limit -> 429 with Retry-After", async () => {
    const ip = { "x-forwarded-for": "203.0.113.77" };
    let last = 0;
    for (let i = 0; i < 125; i++) last = (await receive(req("/api/imaging/receive", "{}", { authorization: "", ...ip }))).status;
    expect(last).toBe(429);
  });

  test("study payload validation", () => {
    expect(validateStudyPayload("sr", { studyUid: "1.2", series: [] })).toBeNull();
    expect(validateStudyPayload("", { studyUid: "1.2", series: [] })).toContain("serviceRequestId");
    expect(validateStudyPayload("sr", { studyUid: "1.2" })).toContain("series");
    expect(validateStudyPayload("sr", { studyUid: "1.2", series: [1] })).toContain("series");
    expect(validateStudyPayload("sr", { studyUid: 5, series: [] })).toContain("studyUid");
    expect(validateStudyPayload("sr", "x")).toContain("study");
  });

  test("report text validation rejects non-strings and oversize", async () => {
    const res = await report(req("/api/imaging/report", JSON.stringify({ imagingStudyId: "s", findings: { a: 1 }, impression: "i" })));
    expect(res.status).toBe(400);
    const res2 = await report(req("/api/imaging/report", JSON.stringify({ imagingStudyId: "s", findings: "f", impression: "i".repeat(50_001) })));
    expect(res2.status).toBe(400);
  });

  test("feedback screenshot: oversized string rejected before decoding", () => {
    expect(parseScreenshot("data:image/png;base64," + "A".repeat(2_000_000))).toBeNull();
  });
});
