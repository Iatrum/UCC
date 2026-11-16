import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { notFound, OperationOutcomeError, badRequest } from "@medplum/core";
import { handleRouteError } from "@/lib/server/route-helpers";
import { adminPortalPath } from "@/lib/server/subdomain-host";
import { proxy } from "../../proxy";

describe("handleRouteError: Medplum not-found (stock/purchases 500)", () => {
  test("OperationOutcomeError notFound maps to 404, not 500", async () => {
    const res = handleRouteError(new OperationOutcomeError(notFound), "GET /api/purchases");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Not found");
  });

  test("other Medplum client errors are still not masked as 404", () => {
    const res = handleRouteError(new OperationOutcomeError(badRequest("nope")), "x");
    expect(res.status).toBe(500);
  });

  test("unknown errors remain 500", () => {
    expect(handleRouteError(new Error("boom"), "x").status).toBe(500);
  });
});

describe("admin subdomain redirect (no /admin/admin)", () => {
  test("adminPortalPath is idempotent", () => {
    expect(adminPortalPath("/")).toBe("/admin");
    expect(adminPortalPath("/users")).toBe("/admin/users");
    expect(adminPortalPath("/admin")).toBe("/admin");
    expect(adminPortalPath("/admin/users")).toBe("/admin/users");
    expect(adminPortalPath("/administrator")).toBe("/admin/administrator");
  });

  test("proxy redirects admin.<base> to <base>/admin exactly once", () => {
    const prev = process.env.NEXT_PUBLIC_BASE_DOMAIN;
    process.env.NEXT_PUBLIC_BASE_DOMAIN = "example.com";
    try {
      for (const [path, expected] of [
        ["/", "https://example.com/admin"],
        ["/admin", "https://example.com/admin"],
        ["/admin/users", "https://example.com/admin/users"],
        ["/clinics", "https://example.com/admin/clinics"],
      ]) {
        const req = new NextRequest(`https://admin.example.com${path}`, {
          headers: { host: "admin.example.com" },
        });
        const res = proxy(req);
        expect(res.status).toBe(308);
        expect(res.headers.get("location")).toBe(expected);
      }
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_BASE_DOMAIN;
      else process.env.NEXT_PUBLIC_BASE_DOMAIN = prev;
    }
  });
});
