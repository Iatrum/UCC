import { describe, expect, it, spyOn } from "bun:test";
import { fetchDocumentTemplate } from "../../lib/document-template-client";
import { fetchWithTimeout } from "../../lib/fetch-with-timeout";
import { describeFetchError, resolveLoadView, showStaleBanner } from "../../lib/load-state";

describe("Task 686 slow-network helpers used by patients list / analytics / document viewer", () => {
  it("a stalled GET aborts with an AbortError that describeFetchError maps to a timeout message", async () => {
    const stalled = ((_i: string, init?: RequestInit) =>
      new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    const err = await fetchWithTimeout("/api/patients?page=1", {}, 20, stalled).catch((e) => e);
    expect(err.name).toBe("AbortError");
    expect(describeFetchError(err, "x")).toMatch(/timed out/);
  });
  it("offline TypeError maps to a network message", () => {
    expect(describeFetchError(new TypeError("Failed to fetch"), "x")).toMatch(/Network error/);
  });
  it("patients list keeps rows while refetching/failing and shows blocking states only when empty", () => {
    expect(resolveLoadView({ loading: true, error: null, hasData: true })).toBe("content");
    expect(resolveLoadView({ loading: false, error: "e", hasData: true })).toBe("content");
    expect(showStaleBanner({ error: "e", hasData: true })).toBe(true);
    expect(resolveLoadView({ loading: false, error: "e", hasData: false })).toBe("error");
  });
});

describe("document template request failure and retry", () => {
  for (const kind of ["mc", "time-chit", "referral"] as const) {
    it(`rejects an HTTP failure and returns the clinic template on retry for ${kind}`, async () => {
      const html = "<p>Clinic template</p>";
      const fetchSpy = spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
        .mockResolvedValueOnce(Response.json({ html }));

      try {
        await expect(fetchDocumentTemplate(kind)).rejects.toThrow("Could not load the document template.");
        await expect(fetchDocumentTemplate(kind)).resolves.toBe(html);
        expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
          `/api/document-templates?type=${kind}`,
          `/api/document-templates?type=${kind}`,
        ]);
      } finally {
        fetchSpy.mockRestore();
      }
    });
  }
});
