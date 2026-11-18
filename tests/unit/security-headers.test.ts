import { describe, expect, test } from "bun:test";

const nextConfig = require("../../next.config.js");

async function headerMap() {
  const rules = await nextConfig.headers();
  const all = rules.find((r: { source: string }) => r.source === "/(.*)");
  return Object.fromEntries(all.headers.map((h: { key: string; value: string }) => [h.key, h.value]));
}

describe("security headers", () => {
  test("baseline headers are present", async () => {
    const h = await headerMap();
    expect(h["Strict-Transport-Security"]).toContain("max-age=");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Permissions-Policy"]).toContain("microphone=()");
  });

  test("CSP forbids framing, plugins and base rewriting", async () => {
    const csp = (await headerMap())["Content-Security-Policy"] as string;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  test("powered-by header disabled", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});

describe("CSP keeps what the app loads working (Task 627 smoke-verified)", () => {
  test("enforcing header, not report-only", async () => {
    const h = await headerMap();
    expect(h["Content-Security-Policy"]).toBeDefined();
    expect(h["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });

  test("srcDoc/blob document previews and PDF workers are allowed", async () => {
    const csp = (await headerMap())["Content-Security-Policy"] as string;
    expect(csp).toMatch(/frame-src [^;]*'self'[^;]*blob:[^;]*data:/);
    expect(csp).toMatch(/worker-src [^;]*blob:/);
    expect(csp).toMatch(/img-src [^;]*data:[^;]*blob:/);
  });

  test("Medplum HTTP + websocket origins are in connect-src", async () => {
    const csp = (await headerMap())["Content-Security-Policy"] as string;
    const connect = csp.split("; ").find((d) => d.startsWith("connect-src ")) as string;
    expect(connect).toContain(new URL(process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL || "http://localhost:8103").origin);
    expect(connect).toMatch(/\bwss?:\/\/localhost:\d+|\bwss:/);
  });

  test("camera stays available to own origin (patient ID scan page)", async () => {
    expect((await headerMap())["Permissions-Policy"]).toContain("camera=(self)");
  });
});
