import { buildCsp } from "../../lib/security/csp";
import { describe, expect, test } from "bun:test";

const nextConfig = require("../../next.config.js");

async function headerMap() {
  const rules = await nextConfig.headers();
  const all = rules.find((r: { source: string }) => r.source === "/(.*)");
  return Object.fromEntries(all.headers.map((h: { key: string; value: string }) => [h.key, h.value]));
}

const prod = (extra: Record<string, string> = {}) =>
  buildCsp("abc123", { NODE_ENV: "production", NEXT_PUBLIC_MEDPLUM_BASE_URL: "https://medplum.example.com", ...extra });
const dir = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(name + " ")) as string;

describe("security headers", () => {
  test("baseline headers are present", async () => {
    const h = await headerMap();
    expect(h["Strict-Transport-Security"]).toContain("max-age=");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Permissions-Policy"]).toContain("microphone=()");
  });

  test("CSP is set per request by proxy.ts, not statically", async () => {
    expect((await headerMap())["Content-Security-Policy"]).toBeUndefined();
  });

  test("CSP forbids framing, plugins and base rewriting", () => {
    const csp = prod();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  test("powered-by header disabled", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});

describe("buildCsp (Task 631)", () => {
  test("production script-src: nonce, no unsafe-inline/unsafe-eval, no strict-dynamic", () => {
    const s = dir(prod(), "script-src");
    expect(s).toContain("'nonce-abc123'");
    expect(s).not.toContain("'unsafe-inline'");
    expect(s).not.toContain("'unsafe-eval'");
    expect(s).not.toContain("strict-dynamic");
  });

  test("development adds unsafe-eval and localhost:8103", () => {
    const csp = buildCsp("n", { NODE_ENV: "development" });
    expect(dir(csp, "script-src")).toContain("'unsafe-eval'");
    expect(dir(csp, "connect-src")).toContain("http://localhost:8103");
  });

  test("production drops localhost:8103 and blanket https:/wss:", () => {
    const csp = prod();
    for (const d of ["connect-src", "img-src"]) {
      expect(dir(csp, d)).not.toContain("localhost");
      expect(dir(csp, d).split(" ")).not.toContain("https:");
      expect(dir(csp, d).split(" ")).not.toContain("wss:");
    }
  });

  test("connect-src has Medplum http+ws origins and Firebase storage", () => {
    const c = dir(prod(), "connect-src");
    expect(c).toContain("https://medplum.example.com");
    expect(c).toContain("wss://medplum.example.com");
    expect(c).toContain("https://firebasestorage.googleapis.com");
  });

  test("localhost Medplum in production env still allowed when configured", () => {
    const c = dir(buildCsp("n", { NODE_ENV: "production", NEXT_PUBLIC_MEDPLUM_BASE_URL: "http://localhost:8113" }), "connect-src");
    expect(c).toContain("ws://localhost:8113");
  });

  test("CSP_EXTRA_HOSTS adds origins to connect and img; invalid entries ignored", () => {
    const csp = prod({ CSP_EXTRA_HOSTS: "https://cdn.example.com/path, nonsense" });
    expect(dir(csp, "connect-src")).toContain("https://cdn.example.com");
    expect(dir(csp, "img-src")).toContain("https://cdn.example.com");
    expect(csp).not.toContain("nonsense");
  });

  test("previews/print/worker needs kept", () => {
    const csp = prod();
    expect(csp).toMatch(/frame-src [^;]*'self'[^;]*blob:[^;]*data:/);
    expect(csp).toMatch(/worker-src [^;]*blob:/);
    expect(dir(csp, "img-src")).toMatch(/data:.*blob:|blob:.*data:/);
  });

  test("camera stays available to own origin", async () => {
    expect((await headerMap())["Permissions-Policy"]).toContain("camera=(self)");
  });
});
