import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

// Preserve the service exports used by other unit tests in Bun's shared module cache.
const adminService = await import("@/lib/fhir/admin-service");
let callerProjectId = "managed";
const callerId = "admin-self";
const get = mock(async (_path: string) => ({ project: { id: callerProjectId } }));
const setPractitionerActiveInMedplum = mock(async (id: string, active: boolean) => ({
  resourceType: "Practitioner" as const,
  id,
  active,
}));

mock.module("@/lib/server/medplum-auth", () => ({
  requirePlatformAdmin: async () => ({ get }),
  getCurrentProfile: async () => ({ resourceType: "Practitioner", id: callerId }),
}));
mock.module("@/lib/server/medplum-admin", () => ({
  getAdminMedplum: async () => ({}),
}));
mock.module("@/lib/fhir/admin-service", () => ({
  ...adminService,
  getManagedProjectId: async () => "managed",
  setPractitionerActiveInMedplum,
}));

const { PATCH } = await import("../../app/api/admin/users/[id]/status/route");

afterAll(() => {
  mock.module("@/lib/fhir/admin-service", () => adminService);
});

beforeEach(() => {
  callerProjectId = "managed";
  get.mockClear();
  setPractitionerActiveInMedplum.mockClear();
});

function deactivate(id: string) {
  return PATCH(new NextRequest(`http://localhost/api/admin/users/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: false }),
  }), { params: Promise.resolve({ id }) });
}

describe("PATCH /api/admin/users/[id]/status", () => {
  test("rejects an admin from another project without changing the user", async () => {
    callerProjectId = "other";

    const response = await deactivate("other-user");

    expect(get).toHaveBeenCalledWith("auth/me");
    expect(response.status).toBe(403);
    expect(setPractitionerActiveInMedplum).not.toHaveBeenCalled();
  });

  test("rejects same-project self-deactivation without changing the user", async () => {
    const response = await deactivate(callerId);

    expect(response.status).toBe(403);
    expect(setPractitionerActiveInMedplum).not.toHaveBeenCalled();
  });

  test("allows a same-project admin to deactivate another user", async () => {
    const response = await deactivate("other-user");

    expect(response.status).toBe(200);
    expect(setPractitionerActiveInMedplum).toHaveBeenCalledTimes(1);
    expect(setPractitionerActiveInMedplum).toHaveBeenCalledWith("other-user", false);
  });
});
