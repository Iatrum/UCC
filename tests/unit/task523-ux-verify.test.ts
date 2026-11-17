import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(import.meta.dir, "../..", p), "utf8");

describe("Task 523 #17: treatment drawer search input", () => {
  const src = read("components/orders/order-composer.tsx");
  const input = src.match(/<Input\s+aria-label="Search treatment catalog"[\s\S]*?\/>/)?.[0] ?? "";
  test("search box keeps its accessible name and gains a placeholder", () => {
    expect(input).toContain('aria-label="Search treatment catalog"');
    expect(input).toContain('placeholder="Search medicines, services, documents..."');
  });
  test("input is still controlled by the existing searchQuery state (no behaviour change)", () => {
    expect(input).toContain("value={searchQuery}");
    expect(input).toContain("setSearchQuery(event.target.value)");
  });
});

describe("Task 523 #11: analytics loading feedback (already shipped by Task 460)", () => {
  test("route segment has a loading.tsx rendering the skeleton", () => {
    const src = read("app/(routes)/analytics/loading.tsx");
    expect(src).toContain("AnalyticsSkeleton");
  });
});
