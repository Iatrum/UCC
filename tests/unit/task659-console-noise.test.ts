import { afterEach, describe, expect, test } from "bun:test";
import { startLabResultUpdates } from "../../lib/poct/live-results";
import { readExistingInvoiceNumber } from "../../lib/billing/invoice-lookup";
import { isAbortError } from "../../lib/is-abort-error";

const realFetch = globalThis.fetch;
const realSetInterval = globalThis.setInterval;
afterEach(() => { globalThis.fetch = realFetch; globalThis.setInterval = realSetInterval; });
const results = { success: true, poctEnabled: true, pacsEnabled: false, reports: [], pending: [], xrayPending: [] };
const tick = () => new Promise((r) => setTimeout(r, 20));

describe("Task 659 (1): subscription 503 is not retried by the poll", () => {
  test("poll reloads results but does not re-POST the subscription; manual refresh re-checks", async () => {
    let subscriptionCalls = 0;
    let resultCalls = 0;
    globalThis.fetch = (async (url: string) => {
      if (String(url).startsWith("/api/labs/results")) { resultCalls++; return new Response(JSON.stringify(results), { status: 200 }); }
      subscriptionCalls++;
      return new Response("{}", { status: 503 });
    }) as unknown as typeof fetch;
    const polls: Array<() => void> = [];
    globalThis.setInterval = ((fn: () => void) => { polls.push(fn); return 0; }) as unknown as typeof setInterval;
    const handle = startLabResultUpdates({ patientId: "fake-1", onResults: () => {}, onError: () => {}, onLoaded: () => {} });
    await tick();
    expect(subscriptionCalls).toBe(1);
    polls.forEach((fn) => fn());
    polls.forEach((fn) => fn());
    await tick();
    expect(resultCalls).toBeGreaterThanOrEqual(3);
    expect(subscriptionCalls).toBe(1);
    handle.refresh();
    await tick();
    expect(subscriptionCalls).toBe(2);
    handle.stop();
  });
});

describe("Task 659 (2): billing lookup 404 means no bill yet", () => {
  const res = (status: number, body: unknown) => ({ status, ok: status < 400, json: async () => body });
  test("404 -> null without throwing", async () => {
    expect(await readExistingInvoiceNumber(res(404, { success: false }))).toBeNull();
  });
  test("200 with number -> string; 200 with null number -> null; 500 -> null", async () => {
    expect(await readExistingInvoiceNumber(res(200, { invoiceNumber: 42 }))).toBe("42");
    expect(await readExistingInvoiceNumber(res(200, { invoiceNumber: null }))).toBeNull();
    const warn = console.warn; const warned: unknown[] = []; console.warn = (...a: unknown[]) => { warned.push(a); };
    try { expect(await readExistingInvoiceNumber(res(500, {}))).toBeNull(); } finally { console.warn = warn; }
    expect(warned.length).toBe(1); // a real failure is not silent
  });
  test("404 does not warn", async () => {
    const warn = console.warn; let n = 0; console.warn = () => { n++; };
    try { await readExistingInvoiceNumber(res(404, {})); } finally { console.warn = warn; }
    expect(n).toBe(0);
  });
  test("unparsable body -> null", async () => {
    expect(await readExistingInvoiceNumber({ status: 200, ok: true, json: async () => { throw new Error("bad"); } })).toBeNull();
  });
});

describe("Task 659 (3): abort detection", () => {
  test("AbortError is quiet; real errors are not", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isAbortError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
  });
});
