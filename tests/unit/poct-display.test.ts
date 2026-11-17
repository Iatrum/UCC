import { describe, expect, test } from "bun:test";
import { poctOrderDateLabel, poctStatusLabel } from "@/lib/poct-display";

describe("poct display labels", () => {
  test("active shows as Pending, not raw FHIR status", () => {
    expect(poctStatusLabel("active")).toBe("Pending");
    expect(poctStatusLabel("completed")).toBe("Completed");
    expect(poctStatusLabel("revoked")).toBe("Cancelled");
    expect(poctStatusLabel(undefined)).toBe("Pending");
  });
  test("date falls back to updatedAt, then dash", () => {
    const a = "2026-11-01T08:00:00Z";
    const b = "2026-11-02T09:30:00Z";
    expect(poctOrderDateLabel({ authoredOn: a, updatedAt: b })).toBe(new Date(a).toLocaleString());
    expect(poctOrderDateLabel({ updatedAt: b })).toBe(new Date(b).toLocaleString());
    expect(poctOrderDateLabel({ authoredOn: "bad", updatedAt: b })).toBe(new Date(b).toLocaleString());
    expect(poctOrderDateLabel({})).toBe("—");
  });
});
