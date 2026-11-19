import { describe, expect, it } from "bun:test";
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
