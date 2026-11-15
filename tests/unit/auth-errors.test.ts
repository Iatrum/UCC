import { describe, expect, test } from "bun:test";
import { classifyAuthError } from "@/lib/auth-errors";
import { decideLoginRedirect } from "@/lib/login-redirect";

const code = (m: string) => classifyAuthError(new Error(m)).message.split(/[:]/)[0];

describe("classifyAuthError", () => {
  test("rate limit keeps retry seconds and is not 'wrong password'", () => {
    const e = classifyAuthError(new Error("AUTH_RATE_LIMITED:30: Too many sign-in attempts."));
    expect(e.message.startsWith("AUTH_RATE_LIMITED:30:")).toBe(true);
  });
  test("raw HTTP 429 is a rate limit", () => {
    expect(code("Request failed with 429")).toBe("AUTH_RATE_LIMITED");
  });
  test("coded non-rate-limit messages mentioning 429 are not rate limits", () => {
    expect(code("AUTH_CONFIG: upstream said 429 in a trace id")).toBe("AUTH_UNKNOWN");
    expect(code("AUTH_CLINIC_REQUIRED: too many clinics")).toBe("AUTH_CLINIC");
  });
  test("coded AUTH_CONFIG with 'invalid' is not mis-labelled as wrong password", () => {
    expect(code("AUTH_CONFIG: invalid_grant")).not.toBe("AUTH_CREDENTIALS");
  });
  test("real credential failures still map to AUTH_CREDENTIALS", () => {
    expect(code("AUTH_CREDENTIALS: Invalid email or password")).toBe("AUTH_CREDENTIALS");
    expect(code("401 Unauthorized")).toBe("AUTH_CREDENTIALS");
  });
  test("unavailable and network", () => {
    expect(code("AUTH_UNAVAILABLE: busy")).toBe("AUTH_UNAVAILABLE");
    expect(code("Failed to fetch")).toBe("AUTH_NETWORK");
  });
});

describe("decideLoginRedirect (/admin loop guard)", () => {
  const base = { isAdmin: false, isClinicForbidden: false, isAdminRequired: false, next: undefined };
  test("admin_required never redirects back to /admin even if client thinks admin", () => {
    expect(decideLoginRedirect({ ...base, isAdmin: true, isAdminRequired: true, next: "/admin" }).action).toBe("admin-notice");
  });
  test("non-admin with admin next gets notice", () => {
    expect(decideLoginRedirect({ ...base, next: "/admin/users" }).action).toBe("admin-notice");
  });
  test("admin without error goes to /admin; non-admin to /dashboard", () => {
    expect(decideLoginRedirect({ ...base, isAdmin: true })).toEqual({ action: "redirect", url: "/admin" });
    expect(decideLoginRedirect(base)).toEqual({ action: "redirect", url: "/dashboard" });
  });
  test("clinic_forbidden stays", () => {
    expect(decideLoginRedirect({ ...base, isClinicForbidden: true }).action).toBe("stay");
  });
});
