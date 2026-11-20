import { afterAll, describe, expect, mock, spyOn, test } from "bun:test";
import type { Basic } from "@medplum/fhirtypes";
import { NextRequest } from "next/server";
import * as authModule from "@/lib/server/medplum-auth";
import * as registryModule from "@/lib/module-registry";
import * as adminModule from "@/lib/server/medplum-admin";

const originalAuth = { ...authModule };
const originalRegistry = { ...registryModule };
const originalAdmin = { ...adminModule };
let profileId = "feedback-profile";
let clinicId = "feedback-clinic";
const getCurrentProfile = mock(async () => ({ id: profileId }));
const createResourceIfNoneExist = mock(async (record: Basic) => ({ ...record, id: "feedback-record" }));
mock.module("@/lib/server/medplum-auth", () => ({
  ...originalAuth,
  getCurrentProfile,
  requireClinicAuth: async () => ({ clinicId }),
}));
mock.module("@/lib/module-registry", () => ({ ...originalRegistry, isModuleEnabledForClinic: async () => true }));
mock.module("@/lib/server/medplum-admin", () => ({
  ...originalAdmin,
  getAdminMedplum: async () => ({ searchOne: async () => undefined, createResourceIfNoneExist }),
}));
afterAll(() => {
  mock.module("@/lib/server/medplum-auth", () => originalAuth);
  mock.module("@/lib/module-registry", () => originalRegistry);
  mock.module("@/lib/server/medplum-admin", () => originalAdmin);
});

const { POST } = await import("@/app/api/feedback/route");
const feedback = JSON.stringify({
  kind: "feature",
  title: "Add dark mode",
  description: "The current theme is hard to read. 👩‍💻",
  browser: { userAgent: "Chrome/130 Linux", language: "en-MY", viewport: "1440x900" },
});

function request(ip: string, body: string | ReadableStream<Uint8Array> = feedback, headers: Record<string, string> = {}) {
  const init = {
    method: "POST",
    body,
    duplex: "half" as const,
    headers: { "content-type": "application/json", "x-forwarded-for": ip, "x-vercel-forwarded-for": ip, ...headers },
  };
  return new NextRequest("http://127.0.0.1/api/feedback", init);
}

describe("feedback route request limits", () => {
  test("ordinary feedback still returns 201 and stores the sanitized text in the caller's clinic", async () => {
    profileId = "ordinary";
    const response = await POST(request("192.0.2.1"));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true, result: { kind: "feature", status: "created" } });
    const [record] = createResourceIfNoneExist.mock.lastCall!;
    expect(record.identifier).toContainEqual({ system: "clinic", value: clinicId });
    expect(JSON.stringify(record)).toContain("The current theme is hard to read. 👩‍💻");
  });

  test("Content-Length and streamed multibyte data are both bounded in bytes", async () => {
    profileId = "size-check";
    const writes = createResourceIfNoneExist.mock.calls.length;
    const declared = await POST(request("192.0.2.2", feedback, { "content-length": "1600001" }));
    expect(declared.status).toBe(413);

    const cancel = mock(() => {});
    const data = new TextEncoder().encode("é".repeat(800_001));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data.subarray(0, 800_000));
        controller.enqueue(data.subarray(800_000));
      },
      cancel,
    });
    expect((await POST(request("192.0.2.2", stream))).status).toBe(413);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(createResourceIfNoneExist).toHaveBeenCalledTimes(writes);
  });

  test("the fifth submission is allowed, the sixth is blocked across IPs, and the bucket resets", async () => {
    profileId = "user-limit";
    const clock = spyOn(Date, "now").mockReturnValue(1_000_000);
    try {
      for (let i = 1; i <= 5; i++) {
        expect((await POST(request(`198.51.100.${i}`))).status).toBe(201);
      }
      expect((await POST(request("198.51.100.6"))).status).toBe(429);
      clinicId = "second-feedback-clinic";
      expect((await POST(request("198.51.100.6"))).status).toBe(201);
      clinicId = "feedback-clinic";
      clock.mockReturnValue(1_060_000);
      expect((await POST(request("198.51.100.6"))).status).toBe(201);
    } finally {
      clinicId = "feedback-clinic";
      clock.mockRestore();
    }
  });

  test("the shared IP limit is enforced before authentication", async () => {
    const ip = "203.0.113.10";
    for (let i = 0; i < 30; i++) {
      profileId = `shared-ip-${i}`;
      expect((await POST(request(ip, feedback, { "x-forwarded-for": `192.0.2.${i + 10}, ${ip}` }))).status).toBe(201);
    }
    profileId = "shared-ip-next";
    const checks = getCurrentProfile.mock.calls.length;
    expect((await POST(request(ip))).status).toBe(429);
    expect(getCurrentProfile).toHaveBeenCalledTimes(checks);
    expect((await POST(request("203.0.113.11"))).status).toBe(201);
  });
});
