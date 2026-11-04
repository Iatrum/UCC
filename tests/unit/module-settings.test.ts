import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BRANCH_ENABLED_MODULE_IDS,
  KNOWN_BRANCH_MODULE_IDS,
  getEnabledModuleIdsFromOrganization,
  normalizeEnabledModuleIds,
} from "../../lib/module-settings";
import type { Organization } from "@medplum/fhirtypes";

describe("POCT lab + PACS x-ray module defaults", () => {
  test("poct and pacs are known toggleable modules but not enabled by default", () => {
    expect(KNOWN_BRANCH_MODULE_IDS).toContain("poct");
    expect(KNOWN_BRANCH_MODULE_IDS).toContain("pacs");
    expect(DEFAULT_BRANCH_ENABLED_MODULE_IDS).not.toContain("poct");
    expect(DEFAULT_BRANCH_ENABLED_MODULE_IDS).not.toContain("pacs");
  });

  test("an existing clinic Organization with no module extension defaults both off", () => {
    const org: Organization = { resourceType: "Organization" };
    const enabled = getEnabledModuleIdsFromOrganization(org);
    expect(enabled).not.toContain("poct");
    expect(enabled).not.toContain("pacs");
  });

  test("normalizing an explicit enabled list keeps poct/pacs opt-in only", () => {
    expect(normalizeEnabledModuleIds(["poct"])).toEqual(["poct"]);
    expect(normalizeEnabledModuleIds(["pacs"])).toEqual(["pacs"]);
    expect(normalizeEnabledModuleIds([])).toEqual([]);
    expect(normalizeEnabledModuleIds(undefined)).toEqual([...DEFAULT_BRANCH_ENABLED_MODULE_IDS]);
  });
});
