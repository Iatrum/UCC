import { beforeEach, describe, expect, it } from "bun:test";
import { authMemo, createAuthMemo, hashToken } from "../../lib/server/auth-memo";
import { assertClinicAssignment, loadMe } from "../../lib/server/medplum-auth";

// Task 547: per-token auth lookups are shared, never across users/clinics, never on failure.

describe("createAuthMemo", () => {
  it("shares one in-flight load between parallel callers of the same token+scope", async () => {
    const memo = createAuthMemo();
    let loads = 0;
    const load = async () => { loads++; await new Promise((r) => setTimeout(r, 10)); return { ok: true }; };
    const [a, b, c] = await Promise.all([memo.get("tok", "me", load), memo.get("tok", "me", load), memo.get("tok", "me", load)]);
    expect(loads).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("never serves one token's entry to another token, or one scope's to another", async () => {
    const memo = createAuthMemo();
    expect(await memo.get("tok-a", "assign|clinic-a", async () => "a-ok")).toBe("a-ok");
    expect(await memo.get("tok-b", "assign|clinic-a", async () => "b-ok")).toBe("b-ok");
    expect(await memo.get("tok-a", "assign|clinic-b", async () => "a-clinic-b")).toBe("a-clinic-b");
    expect(memo.size).toBe(3);
  });

  it("does not cache failures", async () => {
    const memo = createAuthMemo();
    let n = 0;
    const flaky = async () => { n++; if (n === 1) throw new Error("boom"); return "fine"; };
    await expect(memo.get("tok", "me", flaky)).rejects.toThrow("boom");
    await Promise.resolve();
    expect(memo.size).toBe(0);
    expect(await memo.get("tok", "me", flaky)).toBe("fine");
    // synchronous throw in the loader is a failure too
    await expect(memo.get("tok", "x", () => { throw new Error("sync"); })).rejects.toThrow("sync");
    expect(memo.size).toBe(1);
  });

  it("expires entries after the TTL and keeps the map bounded", async () => {
    let t = 1_000;
    const memo = createAuthMemo({ ttlMs: 100, now: () => t });
    let n = 0;
    await memo.get("tok", "me", async () => ++n);
    t += 50;
    expect(await memo.get("tok", "me", async () => ++n)).toBe(1);
    t += 60;
    expect(await memo.get("tok", "me", async () => ++n)).toBe(2);
    for (let i = 0; i < 700; i++) await memo.get(`tok-${i}`, "me", async () => i);
    expect(memo.size).toBeLessThanOrEqual(500);
  });

  it("keys on a hash, never the raw token", () => {
    const h = hashToken("super-secret-token");
    expect(h).toHaveLength(64);
    expect(h).not.toContain("super-secret-token");
  });
});

function fakeMedplum(token: string, opts: { admin?: boolean; roleOrg?: string; orgId?: string; failMe?: { n: number } } = {}) {
  const calls: string[] = [];
  const client: any = {
    getAccessToken: () => token,
    async get(path: string) {
      calls.push(`GET ${path}`);
      await new Promise((r) => setTimeout(r, 5));
      if (opts.failMe && opts.failMe.n-- > 0) throw new Error("me failed");
      return { profile: { resourceType: "Practitioner", id: "prac-1" }, membership: { admin: opts.admin === true } };
    },
    async searchResources(type: string, params: Record<string, string> = {}) {
      calls.push(`search ${type}`);
      await new Promise((r) => setTimeout(r, 5));
      if (type === "Organization") return opts.orgId && params.identifier === "clinic|clinic-a" ? [{ resourceType: "Organization", id: opts.orgId }] : [];
      if (type === "PractitionerRole") {
        return opts.roleOrg ? [{ resourceType: "PractitionerRole", organization: { reference: `Organization/${opts.roleOrg}` } }] : [];
      }
      return [];
    },
  };
  return { client, calls };
}

describe("medplum-auth memo (Task 547)", () => {
  beforeEach(() => authMemo.clear());

  it("fetches /auth/me once for profile + admin flag + clinic check", async () => {
    const { client, calls } = fakeMedplum("tok-1", { roleOrg: "org-a", orgId: "org-a" });
    const me = await loadMe(client);
    await assertClinicAssignment(client, me.profile!, "clinic-a");
    expect(calls.filter((c) => c === "GET auth/me")).toHaveLength(1);
  });

  it("runs the Organization and PractitionerRole lookups in parallel", async () => {
    const { client } = fakeMedplum("tok-2", { roleOrg: "org-a", orgId: "org-a" });
    const me = await loadMe(client);
    const t0 = performance.now();
    await assertClinicAssignment(client, me.profile!, "clinic-a");
    expect(performance.now() - t0).toBeLessThan(40); // serial would add both 5ms waits; mostly guards against regressions to >2 serial calls
  });

  it("shares a successful clinic check for the same token+clinic only", async () => {
    const { client, calls } = fakeMedplum("tok-3", { roleOrg: "org-a", orgId: "org-a" });
    const me = await loadMe(client);
    await Promise.all([assertClinicAssignment(client, me.profile!, "clinic-a"), assertClinicAssignment(client, me.profile!, "clinic-a")]);
    expect(calls.filter((c) => c === "search PractitionerRole")).toHaveLength(1);
    // A different clinic must be checked on its own and is refused (role is for org-a only).
    await expect(assertClinicAssignment(client, me.profile!, "clinic-b")).rejects.toThrow("not assigned");
  });

  it("does not leak an approval to another user's token", async () => {
    const a = fakeMedplum("tok-user-a", { roleOrg: "org-a", orgId: "org-a" });
    const b = fakeMedplum("tok-user-b", { roleOrg: "other-org", orgId: "org-a" });
    const meA = await loadMe(a.client);
    await assertClinicAssignment(a.client, meA.profile!, "clinic-a");
    const meB = await loadMe(b.client);
    await expect(assertClinicAssignment(b.client, meB.profile!, "clinic-a")).rejects.toThrow("not assigned");
  });

  it("does not cache a denial or a failed /auth/me", async () => {
    const failMe = { n: 1 };
    const { client, calls } = fakeMedplum("tok-4", { roleOrg: "wrong", orgId: "org-a", failMe });
    await expect(loadMe(client)).rejects.toThrow("me failed");
    const me = await loadMe(client);
    expect(calls.filter((c) => c === "GET auth/me")).toHaveLength(2);
    await expect(assertClinicAssignment(client, me.profile!, "clinic-a")).rejects.toThrow("not assigned");
    await expect(assertClinicAssignment(client, me.profile!, "clinic-a")).rejects.toThrow("not assigned");
    expect(calls.filter((c) => c === "search PractitionerRole")).toHaveLength(2);
  });

  it("platform admins skip the Organization/role lookups", async () => {
    const { client, calls } = fakeMedplum("tok-5", { admin: true });
    const me = await loadMe(client);
    await assertClinicAssignment(client, me.profile!, "clinic-a");
    expect(calls).toEqual(["GET auth/me"]);
  });
});
