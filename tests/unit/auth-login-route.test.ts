import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { NextRequest } from "next/server";
import { classifyAuthError } from "@/lib/auth-errors";

// Capture fake local configuration in this route only; restore the shared module
// immediately so the rest of the unit suite retains its original configuration.
const realEnv = await import("@/lib/env");
mock.module("@/lib/env", () => ({
  ...realEnv,
  env: { ...realEnv.env, MEDPLUM_BASE_URL: "http://127.0.0.1:8113", MEDPLUM_CLIENT_ID: "fake-client" },
}));
const { POST } = await import("../../app/api/auth/login/route");
mock.module("@/lib/env", () => realEnv);

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
afterEach(() => {
  fetchSpy?.mockRestore();
});

async function login(tokenResponse: () => Promise<Response>) {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "http://127.0.0.1:8113/auth/login") {
      return Response.json({ code: "fake-authorization-code" });
    }
    if (url === "http://127.0.0.1:8113/oauth2/token") return tokenResponse();
    throw new Error("Unexpected network request in mocked auth test");
  });
  return POST(new NextRequest("http://localhost:3210/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "fake@ucc.invalid", password: "fake-password" }),
  }));
}

describe("POST /api/auth/login token-exchange failures", () => {
  test.each([
    new TypeError("fetch failed"),
    new Error("connect ECONNREFUSED"),
    new DOMException("The operation was aborted", "AbortError"),
    new Error("invalid network response, status 429 in trace"),
  ])("returns AUTH_UNAVAILABLE for rejected token fetch: %s", async (failure) => {
    const response = await login(async () => { throw failure; });
    const payload = await response.json();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(503);
    expect(payload).toEqual({ code: "AUTH_UNAVAILABLE", error: "The sign-in server is busy or unavailable." });
    expect(classifyAuthError(new Error(`${payload.code}: ${payload.error}`)).message)
      .toStartWith("AUTH_UNAVAILABLE:");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(response.headers.has("Retry-After")).toBe(false);
  });

  test.each([500, 502, 503])("preserves AUTH_UNAVAILABLE for token HTTP %s", async (status) => {
    const response = await login(async () => new Response(null, { status }));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("AUTH_UNAVAILABLE");
  });

  test("preserves token throttling and Retry-After", async () => {
    const response = await login(async () => new Response(null, {
      status: 429, headers: { "Retry-After": "27" },
    }));
    const payload = await response.json();
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("27");
    expect(payload.code).toBe("AUTH_RATE_LIMITED");
    expect(classifyAuthError(new Error(`${payload.code}:${payload.retryAfterSeconds}: ${payload.error}`)).message)
      .toStartWith("AUTH_RATE_LIMITED:27:");
  });

  test("invalid token grant remains a configuration error", async () => {
    const response = await login(async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    const payload = await response.json();
    expect(response.status).toBe(500);
    expect(payload.code).toBe("AUTH_CONFIG");
    expect(classifyAuthError(new Error(`${payload.code}: ${payload.error}`)).message)
      .not.toStartWith("AUTH_CREDENTIALS:");
  });

  test("a rejected password remains AUTH_CREDENTIALS without a token request", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "Invalid password" }, { status: 400 }));
    const response = await POST(new NextRequest("http://localhost:3210/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "fake@ucc.invalid", password: "fake-password" }),
    }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("AUTH_CREDENTIALS");
  });
});
