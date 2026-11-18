import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { computeTwilioSignature, isValidTwilioSignature } from "@/lib/server/twilio-signature";

const realAdmin = await import("@/lib/server/medplum-admin");
const searchResources = mock(async (): Promise<unknown[]> => []);
const updateResource = mock(async (r: unknown) => r);
mock.module("@/lib/server/medplum-admin", () => ({
  ...realAdmin,
  getAdminMedplum: async () => ({ searchResources, updateResource }),
}));

const { POST } = await import("@/app/api/follow-up/twilio/status/route");

const URL_ = "https://example.test/api/follow-up/twilio/status";
const TOKEN = "unit-test-token-not-real";
const SID_EXT = "https://ucc.emr/communication/twilio-message-sid";
const FU = {
  category: [{ coding: [{ system: "https://ucc.emr/communication-category", code: "review-request" }] }],
  identifier: [{ system: "clinic", value: "clinic-a" }],
};
const params = { MessageSid: "SM123", MessageStatus: "delivered", AccountSid: "ACfake" };

function req(p: Record<string, string>, signature?: string, contentType = "application/x-www-form-urlencoded") {
  const headers: Record<string, string> = { "content-type": contentType };
  if (signature !== undefined) headers["x-twilio-signature"] = signature;
  return new NextRequest(URL_, { method: "POST", headers, body: new URLSearchParams(p).toString() });
}

const saved = { t: process.env.TWILIO_AUTH_TOKEN, u: process.env.TWILIO_STATUS_CALLBACK_URL };
beforeEach(() => {
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  process.env.TWILIO_STATUS_CALLBACK_URL = URL_;
  searchResources.mockClear();
  updateResource.mockClear();
  searchResources.mockImplementation(async () => [
    { ...FU, resourceType: "Communication", id: "c1", status: "in-progress", extension: [{ url: SID_EXT, valueString: "SM123" }] },
  ]);
});
afterEach(() => {
  if (saved.t === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = saved.t;
  if (saved.u === undefined) delete process.env.TWILIO_STATUS_CALLBACK_URL; else process.env.TWILIO_STATUS_CALLBACK_URL = saved.u;
});

describe("twilio signature helper", () => {
  test("matches Twilio's documented algorithm", () => {
    // Test vector from Twilio's webhook security docs.
    const sig = computeTwilioSignature("12345", "https://mycompany.com/myapp.php?foo=1&bar=2", {
      Digits: "1234", To: "+18005551212", From: "+14158675310", Caller: "+14158675310", CallSid: "CA1234567890ABCDE",
    });
    expect(sig).toBe("GvWf1cFY/Q7PnoempGyD5oXAezc=");
  });
  test("fails closed on missing token/url/signature", () => {
    const signature = computeTwilioSignature(TOKEN, URL_, params);
    expect(isValidTwilioSignature({ authToken: TOKEN, url: URL_, signature, params })).toBe(true);
    expect(isValidTwilioSignature({ authToken: "", url: URL_, signature, params })).toBe(false);
    expect(isValidTwilioSignature({ authToken: TOKEN, url: "", signature, params })).toBe(false);
    expect(isValidTwilioSignature({ authToken: TOKEN, url: URL_, signature: null, params })).toBe(false);
  });
});

describe("POST /api/follow-up/twilio/status", () => {
  test("valid signature updates the Communication matched by MessageSid", async () => {
    const res = await POST(req(params, computeTwilioSignature(TOKEN, URL_, params)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, found: true });
    expect(updateResource).toHaveBeenCalledTimes(1);
  });
  test("missing signature => 403, zero reads/writes", async () => {
    const res = await POST(req(params));
    expect(res.status).toBe(403);
    expect(searchResources).not.toHaveBeenCalled();
    expect(updateResource).not.toHaveBeenCalled();
  });
  test("invalid signature or tampered params => 403, zero writes", async () => {
    const sig = computeTwilioSignature(TOKEN, URL_, params);
    expect((await POST(req(params, "bogus"))).status).toBe(403);
    expect((await POST(req({ ...params, MessageStatus: "failed" }, sig))).status).toBe(403);
    expect(updateResource).not.toHaveBeenCalled();
  });
  test("signature made with another token => 403", async () => {
    expect((await POST(req(params, computeTwilioSignature("other", URL_, params)))).status).toBe(403);
    expect(updateResource).not.toHaveBeenCalled();
  });
  test("unset auth token fails closed even with a signature computed from empty key", async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const res = await POST(req(params, computeTwilioSignature("", URL_, params)));
    expect(res.status).toBe(403);
    expect(updateResource).not.toHaveBeenCalled();
  });
  test("unset callback URL fails closed", async () => {
    delete process.env.TWILIO_STATUS_CALLBACK_URL;
    expect((await POST(req(params, computeTwilioSignature(TOKEN, URL_, params)))).status).toBe(403);
    expect(updateResource).not.toHaveBeenCalled();
  });
  test("JSON bodies are rejected (unsigned format)", async () => {
    const r = new NextRequest(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) });
    expect((await POST(r)).status).toBe(403);
    expect(updateResource).not.toHaveBeenCalled();
  });
  test("signed but unknown status value is not written", async () => {
    const p = { ...params, MessageStatus: "pwned" };
    const res = await POST(req(p, computeTwilioSignature(TOKEN, URL_, p)));
    expect(res.status).toBe(200);
    expect(updateResource).not.toHaveBeenCalled();
  });
  test("signed callback for unknown MessageSid writes nothing", async () => {
    searchResources.mockImplementation(async () => []);
    const res = await POST(req(params, computeTwilioSignature(TOKEN, URL_, params)));
    expect(await res.json()).toEqual({ success: true, found: false });
    expect(updateResource).not.toHaveBeenCalled();
  });
  test("terminal delivered state is not downgraded by a late callback", async () => {
    searchResources.mockImplementation(async () => [
      { ...FU, resourceType: "Communication", id: "c1", status: "completed", extension: [
        { url: SID_EXT, valueString: "SM123" },
        { url: "https://ucc.emr/communication/delivery-status", valueString: "delivered" },
      ] },
    ]);
    const p = { ...params, MessageStatus: "sent" };
    await POST(req(p, computeTwilioSignature(TOKEN, URL_, p)));
    expect(updateResource).not.toHaveBeenCalled();
  });
  test("SID match ignores non-follow-up and clinic-untagged Communications", async () => {
    searchResources.mockImplementation(async () => [
      { resourceType: "Communication", id: "x1", status: "in-progress", identifier: FU.identifier, extension: [{ url: SID_EXT, valueString: "SM123" }] },
      { ...FU, identifier: [], resourceType: "Communication", id: "x2", status: "in-progress", extension: [{ url: SID_EXT, valueString: "SM123" }] },
    ]);
    const res = await POST(req(params, computeTwilioSignature(TOKEN, URL_, params)));
    expect(await res.json()).toEqual({ success: true, found: false });
    expect(updateResource).not.toHaveBeenCalled();
  });
});
