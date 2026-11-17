import { describe, expect, it } from "bun:test";
import { OperationOutcomeError, forbidden, notFound } from "@medplum/core";
import type { MedplumClient } from "@medplum/core";
import { assertPatientInClinic } from "../../lib/fhir/write-containment";
import { handleRouteError, ForbiddenError, NotFoundError } from "../../lib/server/route-helpers";

// Task 422: pin the single status rule for cross-clinic writes. Fake data only.
//  - Resource addressed by id that the caller cannot see (foreign or missing): 404.
//  - Caller-supplied patient/subject reference that is foreign or missing: 403,
//    with foreign and missing deliberately indistinguishable.
function fakeMedplum() {
  const store: Record<string, any> = {
    "Patient/p-a": { resourceType: "Patient", id: "p-a", identifier: [{ system: "clinic", value: "clinic-a" }] },
    "Patient/p-b": { resourceType: "Patient", id: "p-b", identifier: [{ system: "clinic", value: "clinic-b" }] },
  };
  return {
    async readResource(type: string, id: string) {
      if (type === "Organization") return { resourceType: "Organization", id };
      const r = store[`${type}/${id}`];
      if (!r) throw new OperationOutcomeError(notFound);
      return r;
    },
    async searchOne(type: string, q: any) {
      if (type === "HealthcareService") return { resourceType: "HealthcareService", id: `hs-${String(q.identifier).split("|")[1]}` };
      return undefined;
    },
    async searchResources() { return []; },
  } as unknown as MedplumClient;
}

const thrown = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return e; }
  throw new Error("expected rejection");
};

describe("cross-clinic write status rule (Task 422)", () => {
  it("foreign and missing patient references are both forbidden and indistinguishable", async () => {
    const m = fakeMedplum();
    const foreign = await thrown(assertPatientInClinic(m, "clinic-a", "p-b")) as OperationOutcomeError;
    const missing = await thrown(assertPatientInClinic(m, "clinic-a", "p-zzz")) as OperationOutcomeError;
    expect(foreign).toBeInstanceOf(OperationOutcomeError);
    expect(foreign.outcome).toEqual(forbidden);
    expect(missing.outcome).toEqual(foreign.outcome);
    expect(handleRouteError(foreign, "t").status).toBe(403);
    expect(handleRouteError(missing, "t").status).toBe(403);
  });

  it("an id-addressed resource hidden from the caller maps to 404, not 403", () => {
    expect(handleRouteError(new OperationOutcomeError(notFound), "t").status).toBe(404);
    expect(handleRouteError(new NotFoundError("Observation not found"), "t").status).toBe(404);
  });

  it("explicit authorization failures stay 403", () => {
    expect(handleRouteError(new ForbiddenError("no"), "t").status).toBe(403);
    expect(handleRouteError(new OperationOutcomeError(forbidden), "t").status).toBe(403);
  });
});
