import { beforeEach, describe, expect, test } from "bun:test";
import {
  PACS_TOGGLE_CACHE_MS, clearPacsToggleCache, consumeLaunchTokenShared, isPacsEnabledForViewer,
} from "@/lib/pacs/viewer-guard";
import { mintViewerToken, verifyViewerToken } from "@/lib/pacs/viewer-token";

// Fake data only (Task 392).
const SECRET = "fake-viewer-secret-fake-viewer-secret-0001";
const UID = "1.2.826.0.1.3680043.8.498.111";
const NOW = 1_800_000_000_000;

/** Minimal in-memory stand-in for Medplum's conditional create, shared by two "instances". */
function fakeMedplum(opts: { fail?: boolean } = {}) {
  const store = new Map<string, any>();
  return {
    store,
    client: {
      async createResourceIfNoneExist(resource: any, query: string) {
        if (opts.fail) throw new Error("down");
        const existing = store.get(query);
        if (existing) return existing;
        store.set(query, resource);
        return resource;
      },
      async searchResources() { return []; },
      async deleteResource() {},
    } as any,
  };
}

function launchClaims(now = NOW) {
  const t = mintViewerToken({ kind: "launch", clinicId: "clinic-a", studyUid: UID }, SECRET, now);
  return verifyViewerToken(t, "launch", SECRET, now)!;
}

describe("pacs toggle re-check", () => {
  beforeEach(() => clearPacsToggleCache());

  test("OFF denies, ON allows, errors deny", async () => {
    expect(await isPacsEnabledForViewer("c1", NOW, async () => true)).toBe(true);
    clearPacsToggleCache();
    expect(await isPacsEnabledForViewer("c1", NOW, async () => false)).toBe(false);
    clearPacsToggleCache();
    expect(await isPacsEnabledForViewer("c1", NOW, async () => { throw new Error("x"); })).toBe(false);
  });

  test("a toggle flip takes effect within the cache window", async () => {
    let on = true;
    const check = async () => on;
    expect(await isPacsEnabledForViewer("c1", NOW, check)).toBe(true);
    on = false;
    expect(await isPacsEnabledForViewer("c1", NOW + 1000, check)).toBe(true); // cached
    expect(await isPacsEnabledForViewer("c1", NOW + PACS_TOGGLE_CACHE_MS, check)).toBe(false);
  });

  test("clinics are cached separately", async () => {
    expect(await isPacsEnabledForViewer("a", NOW, async () => true)).toBe(true);
    expect(await isPacsEnabledForViewer("b", NOW, async () => false)).toBe(false);
  });
});

describe("shared single-use launch token", () => {
  test("a second instance (empty local memory, same Medplum) cannot redeem it", async () => {
    const m = fakeMedplum();
    const claims = launchClaims();
    expect(await consumeLaunchTokenShared(claims, NOW, async () => m.client)).toBe(true);
    // Simulate another process: wipe the per-process map.
    (globalThis as any).__uccPacsUsedLaunch.clear();
    expect(await consumeLaunchTokenShared(claims, NOW, async () => m.client)).toBe(false);
    // Same process replay is also refused.
    expect(await consumeLaunchTokenShared(claims, NOW, async () => m.client)).toBe(false);
  });

  test("stored record carries the clinic identifier", async () => {
    const m = fakeMedplum();
    await consumeLaunchTokenShared(launchClaims(NOW + 5), NOW, async () => m.client);
    const rec = [...m.store.values()][0];
    expect(rec.identifier.some((i: any) => i.system === "clinic" && i.value === "clinic-a")).toBe(true);
  });

  test("fails closed when Medplum is unreachable", async () => {
    const m = fakeMedplum({ fail: true });
    expect(await consumeLaunchTokenShared(launchClaims(NOW + 9), NOW, async () => m.client)).toBe(false);
  });
});
