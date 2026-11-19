import { describe, expect, it } from "bun:test";
import { describeFetchError, resolveLoadView, showStaleBanner } from "../../lib/load-state";

describe("resolveLoadView", () => {
  it("shows loading only when there is no data", () => {
    expect(resolveLoadView({ loading: true, error: null, hasData: false })).toBe("loading");
    expect(resolveLoadView({ loading: true, error: null, hasData: true })).toBe("content");
  });
  it("shows blocking error only when there is no data", () => {
    expect(resolveLoadView({ loading: false, error: "x", hasData: false })).toBe("error");
    expect(resolveLoadView({ loading: false, error: "x", hasData: true })).toBe("content");
  });
  it("shows content for an empty successful load", () => {
    expect(resolveLoadView({ loading: false, error: null, hasData: false })).toBe("content");
  });
});

describe("showStaleBanner", () => {
  it("is true only with an error and existing data", () => {
    expect(showStaleBanner({ error: "x", hasData: true })).toBe(true);
    expect(showStaleBanner({ error: "x", hasData: false })).toBe(false);
    expect(showStaleBanner({ error: null, hasData: true })).toBe(false);
  });
});

describe("describeFetchError", () => {
  it("maps abort/timeouts and network errors", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(describeFetchError(abort, "f")).toMatch(/timed out/);
    expect(describeFetchError(new TypeError("Failed to fetch"), "f")).toMatch(/Network error/);
  });
  it("passes through messages and falls back", () => {
    expect(describeFetchError(new Error("Consultation not found."), "f")).toBe("Consultation not found.");
    expect(describeFetchError("weird", "fallback")).toBe("fallback");
  });
});
