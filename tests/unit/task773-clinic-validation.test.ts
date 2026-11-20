import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { MedplumClient } from "@medplum/core";
import { env } from "@/lib/env";
import * as nextCache from "next/cache";

const realCache = { ...nextCache };
const captureCache = mock((callback: (subdomain: string) => Promise<boolean>) => callback);

mock.module("next/cache", () => ({ ...realCache, unstable_cache: captureCache }));
const { clinicExists } = await import("@/lib/server/clinic-validation").finally(() => {
  mock.module("next/cache", () => realCache);
});

describe("clinic directory validation", () => {
  const originalEnv = {
    MEDPLUM_BASE_URL: env.MEDPLUM_BASE_URL,
    MEDPLUM_CLIENT_ID: env.MEDPLUM_CLIENT_ID,
    MEDPLUM_CLIENT_SECRET: env.MEDPLUM_CLIENT_SECRET,
  };
  const mockLogin = () => spyOn(MedplumClient.prototype, "startClientLogin")
    .mockResolvedValue({ resourceType: "ClientApplication", id: "fake-client" });
  const mockSearch = () => spyOn(MedplumClient.prototype, "searchResources").mockResolvedValue([]);
  let loginSpy: ReturnType<typeof mockLogin>;
  let searchSpy: ReturnType<typeof mockSearch>;

  beforeEach(() => {
    env.MEDPLUM_BASE_URL = "https://medplum.example.invalid";
    env.MEDPLUM_CLIENT_ID = "fake-client";
    env.MEDPLUM_CLIENT_SECRET = "fake-secret";
    loginSpy = mockLogin();
    searchSpy = mockSearch();
  });

  afterEach(() => {
    Object.assign(env, originalEnv);
    loginSpy.mockRestore();
    searchSpy.mockRestore();
  });

  test("uses a five-minute cache and searches for the exact clinic identifier", async () => {
    searchSpy.mockResolvedValueOnce([{ resourceType: "Organization", id: "fake-org" }]);

    expect(await clinicExists("clinic-a")).toBe(true);
    expect(await clinicExists("clinic-b")).toBe(false);
    expect(captureCache).toHaveBeenCalledWith(expect.any(Function), ["clinic-exists"], { revalidate: 300 });
    expect(loginSpy).toHaveBeenCalledWith("fake-client", "fake-secret");
    expect(searchSpy.mock.calls).toEqual([
      ["Organization", { identifier: "clinic|clinic-a", _count: "1" }],
      ["Organization", { identifier: "clinic|clinic-b", _count: "1" }],
    ]);
  });

  test.each(["MEDPLUM_CLIENT_ID", "MEDPLUM_CLIENT_SECRET"] as const)(
    "skips the directory lookup when %s is missing",
    async (credential) => {
      env[credential] = undefined;

      expect(await clinicExists("clinic-a")).toBe(true);
      expect(loginSpy).not.toHaveBeenCalled();
      expect(searchSpy).not.toHaveBeenCalled();
    },
  );

  test("allows the layout to continue during an authentication failure", async () => {
    loginSpy.mockRejectedValueOnce(new Error("Synthetic authentication failure"));

    expect(await clinicExists("clinic-a")).toBe(true);
    expect(searchSpy).not.toHaveBeenCalled();
  });

  test("allows the layout to continue during a directory search failure", async () => {
    searchSpy.mockRejectedValueOnce(new Error("Synthetic directory failure"));

    expect(await clinicExists("clinic-a")).toBe(true);
    expect(searchSpy).toHaveBeenCalledTimes(1);
  });
});
