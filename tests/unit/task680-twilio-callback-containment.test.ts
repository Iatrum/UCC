import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { computeTwilioSignature } from "@/lib/server/twilio-signature";
import { buildTwilioStatusCallbackUrl } from "@/lib/fhir/communication-service";

const realAdmin = await import("@/lib/server/medplum-admin");
const searchResources = mock(async (_t: string, _q: Record<string, string>): Promise<unknown[]> => []);
const updateResource = mock(async (r: unknown) => r);
mock.module("@/lib/server/medplum-admin", () => ({
  ...realAdmin,
  getAdminMedplum: async () => ({ searchResources, updateResource }),
}));
const { POST } = await import("@/app/api/follow-up/twilio/status/route");

const BASE = "https://example.test/api/follow-up/twilio/status";
const TOKEN = "unit-test-token-not-real";
const SID_EXT = "https://ucc.emr/communication/twilio-message-sid";
const cat = [{ coding: [{ system: "https://ucc.emr/communication-category", code: "review-request" }] }];
const comm = (identifier: { system: string; value: string }[]) => ({
  resourceType: "Communication", id: "c1", status: "in-progress", category: cat, identifier,
  extension: [{ url: SID_EXT, valueString: "SM123" }],
});
const params = { MessageSid: "SM123", MessageStatus: "delivered", AccountSid: "ACfake" };

// Sends a callback as Twilio would: signed over the exact StatusCallback URL for `signedClinic`,
// delivered to the request URL carrying `urlClinic`.
function call(signedClinic: string | null, urlClinic: string | null = signedClinic) {
  const signedUrl = signedClinic ? buildTwilioStatusCallbackUrl(BASE, signedClinic)! : BASE;
  const reqUrl = urlClinic ? buildTwilioStatusCallbackUrl(BASE, urlClinic)! : BASE;
  return POST(new NextRequest(reqUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": computeTwilioSignature(TOKEN, signedUrl, params) },
    body: new URLSearchParams(params).toString(),
  }));
}

const saved = { t: process.env.TWILIO_AUTH_TOKEN, u: process.env.TWILIO_STATUS_CALLBACK_URL };
beforeEach(() => {
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  process.env.TWILIO_STATUS_CALLBACK_URL = BASE;
  searchResources.mockClear();
  updateResource.mockClear();
});
afterEach(() => {
  if (saved.t === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = saved.t;
  if (saved.u === undefined) delete process.env.TWILIO_STATUS_CALLBACK_URL; else process.env.TWILIO_STATUS_CALLBACK_URL = saved.u;
});

describe("Task 680: Twilio status callback clinic containment", () => {
  test("own clinic: record tagged with the sending clinic is updated; search is scoped to that clinic", async () => {
    searchResources.mockImplementation(async () => [comm([{ system: "clinic", value: "clinic-a" }])]);
    const res = await call("clinic-a");
    expect(await res.json()).toEqual({ success: true, found: true });
    expect(updateResource).toHaveBeenCalledTimes(1);
    expect(searchResources.mock.calls[0][1].identifier).toBe("clinic|clinic-a");
  });
  test("foreign: SID stored on another clinic's record is never written", async () => {
    searchResources.mockImplementation(async () => [comm([{ system: "clinic", value: "clinic-b" }])]);
    const res = await call("clinic-a");
    expect(await res.json()).toEqual({ success: true, found: false });
    expect(updateResource).not.toHaveBeenCalled();
  });
  test("untagged record is never written", async () => {
    searchResources.mockImplementation(async () => [comm([])]);
    expect(await (await call("clinic-a")).json()).toEqual({ success: true, found: false });
    expect(updateResource).not.toHaveBeenCalled();
  });
  test("mixed-clinic tags (own + foreign) are never written", async () => {
    searchResources.mockImplementation(async () => [comm([{ system: "clinic", value: "clinic-a" }, { system: "clinic", value: "clinic-b" }])]);
    await call("clinic-a");
    expect(updateResource).not.toHaveBeenCalled();
  });
  test("callback without a clinic => 403, zero Medplum access", async () => {
    const res = await call(null);
    expect(res.status).toBe(403);
    expect(searchResources).not.toHaveBeenCalled();
    expect(updateResource).not.toHaveBeenCalled();
  });
  test("clinic param swapped after signing (signed for A, URL says B) => 403, zero Medplum access", async () => {
    const res = await call("clinic-a", "clinic-b");
    expect(res.status).toBe(403);
    expect(searchResources).not.toHaveBeenCalled();
    expect(updateResource).not.toHaveBeenCalled();
  });
  test("StatusCallback builder embeds the sending clinic and fails closed without one", () => {
    expect(buildTwilioStatusCallbackUrl(BASE, "clinic-a")).toBe(`${BASE}?clinic=clinic-a`);
    expect(buildTwilioStatusCallbackUrl(BASE, "")).toBeUndefined();
    expect(buildTwilioStatusCallbackUrl(undefined, "clinic-a")).toBeUndefined();
  });
});
