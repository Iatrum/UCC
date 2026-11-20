import { describe, expect, it } from "bun:test";
import { checkCsrf, isKnownOrigin } from "../../lib/security/csrf";

const call = (h: Record<string, string>, extra?: string) =>
  checkCsrf({ method: "POST", pathname: "/api/patients", headers: new Headers(h), extraAllowedOrigins: extra });
const host = { host: "demo.drhidayat.com" };

describe("known domain suffixes (Task 732)", () => {
  it("allows apex and subdomains of drhidayat.com / iatrum.com", () => {
    for (const o of ["https://drhidayat.com", "https://admin.drhidayat.com", "https://a.b.iatrum.com", "https://IATRUM.com", "https://admin.iatrum.com"]) {
      expect(call({ host: "x.internal", origin: o })).toBeNull();
    }
  });
  it("rejects lookalike domains (dot boundary)", () => {
    for (const o of ["https://evil-drhidayat.com", "https://evildrhidayat.com", "https://drhidayat.com.evil.test", "https://iatrum.com.evil.test", "https://xiatrum.com", "https://drhidayat.com@evil.test", "https://evil.test/.drhidayat.com"]) {
      expect(call({ host: "x.internal", origin: o })).toBe("cross_origin");
    }
  });
  it("rejects explicit ports and non-https on suffix hosts", () => {
    expect(call({ host: "x.internal", origin: "https://admin.iatrum.com:8443" })).toBe("cross_origin");
    expect(call({ host: "x.internal", origin: "http://admin.iatrum.com" })).toBe("cross_origin");
    expect(isKnownOrigin(new URL("https://admin.iatrum.com:443"))).toBe(true); // default port is normalised away
  });
  it("allows this project's Vercel hosts only, not arbitrary *.vercel.app", () => {
    expect(call({ host: "x.internal", origin: "https://ucc-git-feat-x-hidayat0507s-projects.vercel.app" })).toBeNull();
    expect(call({ host: "x.internal", origin: "https://ucc-k56f04mdx-hidayat0507s-projects.vercel.app" })).toBeNull();
    for (const o of ["https://evil.vercel.app", "https://ucc.vercel.app", "https://ucc-x-other-projects.vercel.app", "https://ucc-x-hidayat0507s-projects.vercel.app.evil.test", "https://evil-hidayat0507s-projects.vercel.app"]) {
      expect(call({ host: "x.internal", origin: o })).toBe("cross_origin");
    }
  });
  it("still allows the request Host and CSRF_ALLOWED_ORIGINS extras", () => {
    expect(call({ host: "clinic.example.com", origin: "https://clinic.example.com" })).toBeNull();
    expect(call({ host: "x.internal", origin: "https://app.example.com" }, "https://app.example.com")).toBeNull();
    expect(call({ host: "x.internal", origin: "https://app.example.com" })).toBe("cross_origin");
  });
  it("with no Origin, uses Sec-Fetch-Site and ignores Referer (unchanged)", () => {
    expect(call({ ...host, "sec-fetch-site": "cross-site", referer: "https://admin.iatrum.com/x" })).toBe("cross_site_fetch");
    expect(call({ ...host, "sec-fetch-site": "same-origin" })).toBeNull();
    expect(call({ ...host })).toBeNull();
  });
});
