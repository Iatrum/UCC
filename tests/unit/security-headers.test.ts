import { describe, expect, test } from "bun:test";

// eslint-disable-next-line @typescript-eslint/no-require-imports
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
