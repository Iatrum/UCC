import { describe, expect, test } from "bun:test";
import { assignedLabel, configuredValue, firstParam, isHttpUrl, matchesSearch, sameIdSet } from "@/lib/admin-ui";

describe("admin-ui helpers", () => {
  test("configuredValue treats unset/blank as not configured", () => {
    expect(configuredValue(undefined)).toBeNull();
    expect(configuredValue("  ")).toBeNull();
    expect(configuredValue(" http://x ")).toBe("http://x");
  });
  test("isHttpUrl only allows http(s)", () => {
    expect(isHttpUrl("https://a.example")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl(null)).toBe(false);
    expect(isHttpUrl("nope")).toBe(false);
  });
  test("matchesSearch", () => {
    expect(matchesSearch("", ["a"])).toBe(true);
    expect(matchesSearch("BRA", ["Klinik Bravo", null])).toBe(true);
    expect(matchesSearch("zz", ["Klinik Bravo", "bravo"])).toBe(false);
    expect(matchesSearch("fake-1", ["Fake isolation clinic", "fake-1"])).toBe(true);
  });
  test("firstParam", () => {
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam(undefined)).toBe("");
  });
  test("sameIdSet ignores order", () => {
    expect(sameIdSet(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameIdSet(["a"], ["a", "b"])).toBe(false);
  });
  test("assignedLabel", () => {
    expect(assignedLabel(11, 18)).toBe("Assigned to a clinic: 11 of 18");
  });
});
