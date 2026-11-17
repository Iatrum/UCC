import { describe, expect, it } from "bun:test";
import { resolveClinicTenant, resolveClinicTenantMemo } from "../../lib/fhir/clinic-tenancy";

// Regression guard for #302 (slow patient detail load): the tenant lookup must run its
// Organization/account queries concurrently and be shared between services on one client.
function fakeClient(opts: { orgDelay?: number; accountDelay?: number; failAccount?: boolean } = {}) {
  const calls: string[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const client: any = {
    async readResource() {
      calls.push("readOrg");
      throw new Error("not found");
    },
    async searchOne(type: string) {
      calls.push(`search:${type}`);
      if (type === "Organization") {
        await sleep(opts.orgDelay ?? 30);
        return { resourceType: "Organization", id: "org1" };
      }
      await sleep(opts.accountDelay ?? 30);
      if (opts.failAccount) throw new Error("account boom");
      return { resourceType: "HealthcareService", id: "acct1" };
    },
  };
  return { client, calls };
}

describe("resolveClinicTenant concurrency (#302)", () => {
  it("runs the Organization and account lookups in parallel", async () => {
    const { client } = fakeClient({ orgDelay: 60, accountDelay: 60 });
    const t0 = performance.now();
    const tenant = await resolveClinicTenant(client, "demo");
    const elapsed = performance.now() - t0;
    expect(tenant?.organizationId).toBe("org1");
    expect(tenant?.accountId).toBe("acct1");
    expect(elapsed).toBeLessThan(110); // serial would be >= 120ms
  });

  it("still surfaces an account failure", async () => {
    const { client } = fakeClient({ failAccount: true });
    await expect(resolveClinicTenant(client, "demo")).rejects.toThrow("account boom");
  });
});

describe("resolveClinicTenantMemo (#302)", () => {
  it("shares one lookup between concurrent callers on the same client", async () => {
    const { client, calls } = fakeClient();
    const [a, b] = await Promise.all([resolveClinicTenantMemo(client, "demo"), resolveClinicTenantMemo(client, "demo")]);
    expect(a).toBe(b);
    expect(calls.filter((c) => c === "search:Organization").length).toBe(1);
    expect(calls.filter((c) => c === "search:HealthcareService").length).toBe(1);
  });

  it("does not share across clients or clinics, and returns null without a clinic", async () => {
    const one = fakeClient();
    const two = fakeClient();
    await resolveClinicTenantMemo(one.client, "demo");
    await resolveClinicTenantMemo(two.client, "demo");
    await resolveClinicTenantMemo(one.client, "other");
    expect(two.calls.filter((c) => c === "search:Organization").length).toBe(1);
    expect(one.calls.filter((c) => c === "search:Organization").length).toBe(2);
    expect(await resolveClinicTenantMemo(one.client, undefined)).toBeNull();
  });

  it("does not cache failures", async () => {
    const { client, calls } = fakeClient({ failAccount: true });
    await expect(resolveClinicTenantMemo(client, "demo")).rejects.toThrow();
    await expect(resolveClinicTenantMemo(client, "demo")).rejects.toThrow();
    expect(calls.filter((c) => c === "search:Organization").length).toBe(2);
  });
});
