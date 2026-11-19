import { describe, expect, test } from "bun:test";
import {
  checkoutInvoiceUrl, checkoutOrderUrl, checkoutPlanUrl, checkoutPreloadScript, preloadedOr,
  takeCheckoutPreload, CHECKOUT_PRELOAD_KEY,
} from "@/lib/billing/checkout-preload";

describe("task 684 checkout preload", () => {
  test("script embeds the exact URLs the client would fetch", () => {
    const s = checkoutPreloadScript("c1", "p1")!;
    expect(s).toContain(JSON.stringify(checkoutOrderUrl("c1", "p1")));
    expect(s).toContain(JSON.stringify(checkoutInvoiceUrl("c1")));
    expect(s).toContain(JSON.stringify(checkoutPlanUrl("p1", "c1")));
    expect(checkoutPlanUrl("p1", "c1")).toContain("draftId=profile-treatment-p1-c1");
    // Task 685: preloaded reads keep the 15 s abort ceiling that fetchWithTimeout gives the normal path.
    expect(s).toContain("AbortSignal.timeout(15000)");
    expect(() => new Function(s)).not.toThrow();
  });
  test("non-FHIR ids are never embedded (script injection / no patientId)", () => {
    expect(checkoutPreloadScript("c1", "</script><script>alert(1)")).toBeNull();
    expect(checkoutPreloadScript("c1", "")).toBeNull();
    expect(checkoutPreloadScript("c1 ", "p1")).toBeNull();
    expect(checkoutPreloadScript("a".repeat(65), "p1")).toBeNull();
  });
  test("take is one-shot, id-matched and age-limited", () => {
    const w = globalThis as unknown as { window?: Record<string, unknown> };
    const mk = (over = {}) => ({ consultationId: "c1", patientId: "p1", startedAt: 1000, order: Promise.resolve(null), invoice: Promise.resolve(null), plan: Promise.resolve(null), ...over });
    w.window = { [CHECKOUT_PRELOAD_KEY]: mk() };
    expect(takeCheckoutPreload("c1", "p1", 2000)).not.toBeNull();
    expect(takeCheckoutPreload("c1", "p1", 2000)).toBeNull();
    w.window = { [CHECKOUT_PRELOAD_KEY]: mk() };
    expect(takeCheckoutPreload("c2", "p1", 2000)).toBeNull();
    w.window = { [CHECKOUT_PRELOAD_KEY]: mk() };
    expect(takeCheckoutPreload("c1", "p1", 1000 + 16_000)).toBeNull();
    delete w.window;
  });
  test("preloadedOr uses the preload, else falls back (null, missing, timeout)", async () => {
    const fb = () => Promise.resolve(new Response("fallback"));
    expect(await (await preloadedOr(Promise.resolve(new Response("pre")), fb)).text()).toBe("pre");
    expect(await (await preloadedOr(Promise.resolve(null), fb)).text()).toBe("fallback");
    expect(await (await preloadedOr(undefined, fb)).text()).toBe("fallback");
    expect(await (await preloadedOr(new Promise(() => {}), fb, 10)).text()).toBe("fallback");
  });
});
