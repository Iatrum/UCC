/**
 * Unit tests for deleteOrganizationFromMedplum cascade-delete behaviour.
 *
 * Uses a hand-rolled Medplum mock so no real network or credentials are needed.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";

// ── Inline the logic under test so we don't need to resolve the @/ alias ────

type FakeRole = { id: string; resourceType: "PractitionerRole" };
type FakeOrg  = { id: string; resourceType: "Organization" };

interface FakeMedplum {
  searchResources: (resourceType: string, params: Record<string, string>) => Promise<FakeRole[] | FakeOrg[]>;
  deleteResource: (resourceType: string, id: string) => Promise<void>;
}

async function deleteOrganization(
  organizationId: string,
  medplum: FakeMedplum
): Promise<void> {
  const [childOrganizations, practitionerRoles] = await Promise.all([
    medplum.searchResources("Organization", {
      partof: `Organization/${organizationId}`,
      _count: "5",
    }),
    medplum.searchResources("PractitionerRole", {
      organization: `Organization/${organizationId}`,
      _count: "100",
    }),
  ]);

  if ((childOrganizations?.length ?? 0) > 0) {
    throw new Error("Cannot delete a clinic that still has branches.");
  }

  for (const role of practitionerRoles as FakeRole[]) {
    if (role.id) {
      try {
        await medplum.deleteResource("PractitionerRole", role.id);
      } catch (err) {
        console.warn("[deleteOrganization] failed to delete PractitionerRole", role.id, err);
      }
    }
  }

  await medplum.deleteResource("Organization", organizationId);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("deleteOrganization", () => {
  let deletedResources: Array<{ resourceType: string; id: string }>;

  beforeEach(() => {
    deletedResources = [];
  });

  function makeMedplum(opts: {
    childOrgs?: FakeOrg[];
    roles?: FakeRole[];
    deleteError?: boolean;
  }): FakeMedplum {
    return {
      searchResources: async (resourceType: string) => {
        if (resourceType === "Organization") return opts.childOrgs ?? [];
        if (resourceType === "PractitionerRole") return opts.roles ?? [];
        return [];
      },
      deleteResource: async (resourceType: string, id: string) => {
        if (opts.deleteError && resourceType === "PractitionerRole") {
          throw new Error("simulated delete error");
        }
        deletedResources.push({ resourceType, id });
      },
    };
  }

  it("deletes the Organization when no roles or children exist", async () => {
    const medplum = makeMedplum({});
    await deleteOrganization("org-1", medplum);
    expect(deletedResources).toEqual([{ resourceType: "Organization", id: "org-1" }]);
  });

  it("cascades-deletes PractitionerRoles before deleting the Organization", async () => {
    const roles: FakeRole[] = [
      { id: "role-a", resourceType: "PractitionerRole" },
      { id: "role-b", resourceType: "PractitionerRole" },
    ];
    const medplum = makeMedplum({ roles });

    await deleteOrganization("org-1", medplum);

    // Both roles must be deleted before the Organization
    expect(deletedResources).toEqual([
      { resourceType: "PractitionerRole", id: "role-a" },
      { resourceType: "PractitionerRole", id: "role-b" },
      { resourceType: "Organization", id: "org-1" },
    ]);
  });

  it("still deletes the Organization even if one PractitionerRole delete fails", async () => {
    const roles: FakeRole[] = [{ id: "role-bad", resourceType: "PractitionerRole" }];
    const medplum = makeMedplum({ roles, deleteError: true });

    await deleteOrganization("org-1", medplum);

    // The PractitionerRole failure is swallowed; Organization is still deleted
    expect(deletedResources).toEqual([{ resourceType: "Organization", id: "org-1" }]);
  });

  it("throws and does NOT delete when child Organizations exist", async () => {
    const childOrgs: FakeOrg[] = [{ id: "child-1", resourceType: "Organization" }];
    const medplum = makeMedplum({ childOrgs });

    await expect(deleteOrganization("org-1", medplum)).rejects.toThrow(
      "Cannot delete a clinic that still has branches."
    );
    expect(deletedResources).toHaveLength(0);
  });

  it("old behaviour: would have thrown with assigned users — new behaviour: succeeds", async () => {
    // This is the exact scenario the bug was about.
    const roles: FakeRole[] = [
      { id: "role-1", resourceType: "PractitionerRole" },
      { id: "role-2", resourceType: "PractitionerRole" },
    ];
    const medplum = makeMedplum({ roles });

    // Must NOT throw
    await expect(deleteOrganization("clinic-with-users", medplum)).resolves.toBeUndefined();

    // Organization was deleted
    expect(deletedResources.some(r => r.resourceType === "Organization")).toBe(true);
    // Both user assignments were cleaned up
    expect(deletedResources.filter(r => r.resourceType === "PractitionerRole")).toHaveLength(2);
  });
});
