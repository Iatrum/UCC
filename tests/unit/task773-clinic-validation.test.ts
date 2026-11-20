import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { MedplumClient } from "@medplum/core";
import { env } from "@/lib/env";
import * as nextCache from "next/cache";

const realCache = { ...nextCache };
mock.module("next/cache", () => ({
  ...realCache,
  unstable_cache: (lookup: (subdomain: string) => Promise<boolean>) => lookup,
}));
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

  test("accepts a registered clinic and rejects an unregistered clinic", async () => {
    const registeredClinic = {
      resourceType: "Organization" as const,
      id: "fake-org",
      identifier: [{ system: "clinic", value: "clinic-a" }],
    };
    searchSpy.mockImplementation(async (resourceType, query) => {
      const params = query instanceof URLSearchParams ? query : new URLSearchParams(query);
      return resourceType === "Organization" && params.get("identifier") === "clinic|clinic-a"
        ? [registeredClinic]
        : [];
    });

    expect(await clinicExists("clinic-a")).toBe(true);
    expect(await clinicExists("clinic-b")).toBe(false);
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
