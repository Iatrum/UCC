import { describe, expect, it } from "bun:test";
import { checkCsrf } from "../../lib/security/csrf";

const call = (headers: Record<string, string>, extraAllowedOrigins?: string, protocol = "https:") =>
  checkCsrf({ method: "POST", pathname: "/api/consultations", headers: new Headers(headers), protocol, extraAllowedOrigins });

const clinicHost = "demo.drhidayat.com";
const previewHost = "ucc-git-feature-hidayat0507s-projects.vercel.app";

describe("CSRF origin trust", () => {
  it.each([clinicHost, "app.iatrum.com", previewHost])("accepts same-origin saves at %s", (host) => {
    expect(call({ host, origin: `https://${host}`, "sec-fetch-site": "same-origin" })).toBeNull();
    expect(call({ host, origin: `https://${host}` })).toBeNull();
  });

  it.each([
    "https://drhidayat.com",
    "https://other.drhidayat.com",
    "https://app.iatrum.com",
    "https://evildrhidayat.com",
    "https://evil-drhidayat.com",
    "https://drhidayat.com.evil.test",
    "https://iatrum.com.evil.test",
    "https://ucc.vercel.app",
    `https://${previewHost}`,
    "https://ucc-other-hidayat0507s-projects.vercel.app",
  ])("rejects unconfigured cross-origin source %s", (origin) => {
    expect(call({ host: clinicHost, origin })).toBe("cross_origin");
  });

  it("ignores forwarded hosts and requires browser metadata to agree with a Host match", () => {
    const origin = "https://source.example.test";
    expect(call({
      host: clinicHost, origin, "x-forwarded-host": `source.example.test, ${clinicHost}`,
    })).toBe("cross_origin");
    expect(call({ origin, "x-forwarded-host": "source.example.test" })).toBe("cross_origin");
    expect(call({ host: "source.example.test", origin, "sec-fetch-site": "cross-site" })).toBe("cross_site_fetch");
    expect(call({ host: clinicHost, origin: `https://${clinicHost}`, "sec-fetch-site": "same-site" })).toBe("cross_site_fetch");
    expect(call({ host: clinicHost, origin: `https://${clinicHost}`, "x-forwarded-host": "source.example.test" })).toBeNull();
  });

  it("compares scheme and port and supports the local HTTP dev origin", () => {
    expect(call({ host: clinicHost, origin: `http://${clinicHost}` })).toBe("cross_origin");
    expect(call({ host: clinicHost, origin: `https://${clinicHost}:8443` })).toBe("cross_origin");
    expect(call({ host: `${clinicHost}:443`, origin: `https://${clinicHost}` })).toBeNull();
    expect(call({ host: "localhost:3210", origin: "http://localhost:3210" }, undefined, "http:")).toBeNull();
  });

  it("allows configured origins by exact scheme, hostname and port", () => {
    const extra = "https://ui.iatrum.com:8443, https://ui.example.test:443";
    const headers = { host: clinicHost, "sec-fetch-site": "cross-site" };
    expect(call({ ...headers, origin: "https://ui.iatrum.com:8443" }, extra)).toBeNull();
    expect(call({ ...headers, origin: "https://ui.example.test" }, extra)).toBeNull();
    for (const origin of ["http://ui.iatrum.com:8443", "https://ui.iatrum.com", "https://ui.example.test.evil.test"]) {
      expect(call({ ...headers, origin }, extra)).toBe("cross_site_fetch");
    }
    expect(call({ host: clinicHost, origin: "https://ui.example.test" }, "https://ui.example.test/path")).toBe("cross_origin");
  });

  it.each([
    "", "null", "https://user@demo.drhidayat.com", "https://demo.drhidayat.com/path",
    "https://demo.drhidayat.com, https://evil.test", "blob:https://demo.drhidayat.com/id",
    "ftp://demo.drhidayat.com",
  ])("rejects invalid or opaque Origin %j even with same-origin metadata", (origin) => {
    expect(call({ host: clinicHost, origin, "sec-fetch-site": "same-origin" })).toBe("invalid_origin");
  });

  it("uses Fetch Metadata when Origin is absent", () => {
    const headers = { host: clinicHost, "content-type": "application/json" };
    expect(call({ ...headers, "sec-fetch-site": "same-origin" })).toBeNull();
    for (const site of ["same-site", "cross-site", "none", ""]) {
      expect(call({ ...headers, "sec-fetch-site": site })).toBe("cross_site_fetch");
    }
  });

  it("blocks headerless browser-simple POSTs", () => {
    expect(call({ host: clinicHost })).toBe("missing_origin");
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=fake"]) {
      expect(call({ host: clinicHost, "content-type": type })).toBe("missing_origin");
    }
  });
});
