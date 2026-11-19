import { describe, expect, it } from "bun:test";
import { checkCsrf } from "../../lib/security/csrf";

const call = (method: string, pathname: string, h: Record<string, string>, extra?: string) =>
  checkCsrf({ method, pathname, headers: new Headers(h), extraAllowedOrigins: extra });

describe("checkCsrf", () => {
  const host = { host: "demo.example.com" };
  it("allows same-origin mutating requests", () => {
    expect(call("POST", "/api/patients", { ...host, origin: "https://demo.example.com" })).toBeNull();
  });
  it("uses x-forwarded-host behind a proxy", () => {
    expect(call("PATCH", "/api/queue", { host: "10.0.0.2:3000", "x-forwarded-host": "demo.example.com", origin: "https://demo.example.com" })).toBeNull();
  });
  it("rejects cross-origin and sibling-subdomain origins", () => {
    expect(call("POST", "/api/consultations", { ...host, origin: "https://evil.test" })).toBe("cross_origin");
    expect(call("DELETE", "/api/billing", { ...host, origin: "https://other.example.com" })).toBe("cross_origin");
    expect(call("POST", "/api/auth/medplum-session", { ...host, origin: "https://other.example.com", "content-type": "text/plain" })).toBe("cross_origin");
  });
  it("rejects null / malformed origin", () => {
    expect(call("POST", "/api/patients", { ...host, origin: "null" })).toBe("invalid_origin");
  });
  it("allows configured extra origins only", () => {
    expect(call("POST", "/api/patients", { ...host, origin: "https://app.example.com" }, "https://app.example.com, https://x.test")).toBeNull();
    expect(call("POST", "/api/patients", { ...host, origin: "https://app.example.com:8443" }, "https://app.example.com")).toBe("cross_origin");
  });
  it("falls back to Sec-Fetch-Site when Origin is absent", () => {
    expect(call("POST", "/api/patients", { ...host, "sec-fetch-site": "cross-site" })).toBe("cross_site_fetch");
    expect(call("POST", "/api/patients", { ...host, "sec-fetch-site": "same-site" })).toBe("cross_site_fetch");
    expect(call("POST", "/api/patients", { ...host, "sec-fetch-site": "same-origin" })).toBeNull();
  });
  it("allows non-browser callers with no browser headers", () => {
    expect(call("POST", "/api/patients", host)).toBeNull();
  });
  it("never blocks safe methods or non-API paths", () => {
    expect(call("GET", "/api/patients", { ...host, origin: "https://evil.test" })).toBeNull();
    expect(call("POST", "/patients", { ...host, origin: "https://evil.test" })).toBeNull();
  });
  it("leaves device-key, Twilio and bulk-export routes alone", () => {
    for (const p of ["/api/labs/receive", "/api/labs/receive/message", "/api/imaging/receive", "/api/imaging/receive/message", "/api/imaging/report", "/api/pacs/orthanc/study", "/api/follow-up/twilio/status", "/api/export-to-medplum"]) {
      expect(call("POST", p, { ...host, origin: "https://evil.test" })).toBeNull();
    }
  });
  it("does not exempt look-alike prefixes", () => {
    expect(call("POST", "/api/labs/receiver-x", { ...host, origin: "https://evil.test" })).toBe("cross_origin");
    expect(call("POST", "/api/labs/order", { ...host, origin: "https://evil.test" })).toBe("cross_origin");
  });
});
