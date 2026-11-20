import { describe, expect, test } from "bun:test";
import {
  assignedLabel, configuredValue, firstParam, isHttpUrl, matchesSearch, sameIdSet,
  userEditPayload, visibleClinicAssignments,
} from "@/lib/admin-ui";

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

describe("user-edit clinic assignments", () => {
  const clinics = Array.from({ length: 36 }, (_, index) => ({
    id: `fake-id-${index + 1}`,
    name: `Fake Branch ${index + 1}`,
    subdomain: `fake-subdomain-${index + 1}`,
    enabledModuleIds: [],
    pacsViewerHosts: [],
  }));

  test("puts selected branches first while keeping the original order within each group", () => {
    const selectedIds = new Set([clinics[34].id, clinics[12].id]);
    const visible = visibleClinicAssignments(clinics, selectedIds, "");

    expect(visible).toEqual([
      clinics[12],
      clinics[34],
      ...clinics.filter((clinic) => !selectedIds.has(clinic.id)),
    ]);
    expect(clinics[0].id).toBe("fake-id-1");
  });

  test("matches name or subdomain and shows only matching branches", () => {
    const selectedIds = new Set([clinics[34].id, clinics[12].id]);

    expect(visibleClinicAssignments(clinics, selectedIds, "  FAKE BRANCH 3  ")).toEqual([
      clinics[34], clinics[2], ...clinics.slice(29, 34), clinics[35],
    ]);
    expect(visibleClinicAssignments(clinics, selectedIds, "SUBDOMAIN-36")).toEqual([clinics[35]]);
    expect(visibleClinicAssignments(clinics, selectedIds, "missing")).toEqual([]);
  });

  test("saving uses the existing PATCH payload, including assignments hidden by the search", () => {
    const form = { firstName: " Fake ", lastName: "User" };
    const selectedIds = new Set([clinics[34].id, "fake-unlisted-id", clinics[12].id]);
    const visible = visibleClinicAssignments(clinics, selectedIds, "subdomain-36");

    expect(visible).toEqual([clinics[35]]);
    const expectedPayload = {
      firstName: " Fake ",
      lastName: "User",
      organizationIds: ["fake-id-35", "fake-unlisted-id", "fake-id-13"],
    };
    expect(userEditPayload(form, selectedIds)).toEqual(expectedPayload);

    selectedIds.add(visible[0].id);
    expect(userEditPayload(form, selectedIds)).toEqual({
      ...expectedPayload,
      organizationIds: [...expectedPayload.organizationIds, "fake-id-36"],
    });
  });
});
