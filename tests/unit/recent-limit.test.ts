import { describe, expect, test } from "bun:test";
import { clampRecentLimit } from "../../lib/fhir/recent-limit";

describe("clampRecentLimit", () => {
  test("passes through values in range", () => {
    expect(clampRecentLimit("5")).toBe(5);
    expect(clampRecentLimit("50")).toBe(50);
  });
  test("caps large values at 50", () => {
    expect(clampRecentLimit("51")).toBe(50);
    expect(clampRecentLimit("100000")).toBe(50);
  });
  test("falls back to 10 for junk or zero", () => {
    expect(clampRecentLimit("abc")).toBe(10);
    expect(clampRecentLimit("")).toBe(10);
    expect(clampRecentLimit("0")).toBe(10);
    expect(clampRecentLimit(null)).toBe(10);
  });
  test("negative values become 1", () => {
    expect(clampRecentLimit("-5")).toBe(1);
  });
});
