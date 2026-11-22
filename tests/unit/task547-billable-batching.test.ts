import { describe, expect, it } from "bun:test";
import { getConsultationsWithDetails } from "../../lib/models";
import { CLINIC_IDENTIFIER_SYSTEM } from "../../lib/fhir/clinic-tenancy";

// Task 547: the billable/dashboard path must cost a fixed number of Medplum round trips, never a
// clinic-wide Encounter search (or read) per encounter.
const EXT = "https://ucc.emr/triage-encounter";
const id = (clinic: string) => ({ system: CLINIC_IDENTIFIER_SYSTEM, value: clinic });

function build(n: number, clinic = "clinic-a", otherClinicPatients = 2) {
  const res: any[] = [];
  const add = (c: string, i: number, patientId: string, encId: string, tag: string) => {
    res.push({ resourceType: "Patient", id: patientId, identifier: [id(c)], name: [{ text: `${tag} ${i}` }], managingOrganization: { reference: `Organization/${c}` } });
    res.push({
      resourceType: "Encounter", id: encId, status: "finished",
      identifier: [id(c), { system: "firebase-patient", value: patientId }],
      subject: { reference: `Patient/${patientId}` }, serviceProvider: { reference: `Organization/${c}` },
      period: { start: `2026-06-${String((i % 27) + 1).padStart(2, "0")}T00:00:00.000Z` },
      extension: [{ url: EXT, extension: [{ url: "queueStatus", valueString: "meds_and_bills" }] }],
    });
    res.push({ resourceType: "Condition", id: `c-${encId}`, subject: { reference: `Patient/${patientId}` }, encounter: { reference: `Encounter/${encId}` }, code: { text: `Dx ${i}` } });
  };
  for (let i = 0; i < n; i++) add(clinic, i, `p-${i}`, `e-${i}`, "Own");
  for (let i = 0; i < otherClinicPatients; i++) add("clinic-b", i, `bp-${i}`, `be-${i}`, "Other");
  return res;
}

function fake(resources: any[]) {
  const log: { type: string; params: Record<string, string> }[] = [];
  const reads: string[] = [];
  const client: any = {
    async readResource(type: string, rid: string) {
      reads.push(`${type}/${rid}`);
      if (type === "Organization") return { resourceType: "Organization", id: rid };
      const f = resources.find((r) => r.resourceType === type && r.id === rid);
      if (!f) throw new Error("not found");
      return f;
    },
    async searchOne(type: string, params: Record<string, string>) {
      if (type === "HealthcareService") return { resourceType: type, id: `acct-${params.identifier.split("|")[1]}` };
      return undefined;
    },
    async searchResources(type: string, params: Record<string, string> = {}) {
      log.push({ type, params });
      let m = resources.filter((r) => r.resourceType === type);
      if (params._id) { const ids = params._id.split(","); m = m.filter((r) => ids.includes(r.id)); }
      if (params.identifier) { const [s, v] = params.identifier.split("|"); m = m.filter((r) => r.identifier?.some((x: any) => x.system === s && x.value === v)); }
      if (params.subject) { const subs = params.subject.split(","); m = m.filter((r) => subs.includes(r.subject?.reference)); }
      if (params.encounter) { const e = params.encounter.split(","); m = m.filter((r) => e.includes(r.encounter?.reference)); }
      if (params["service-provider"]) m = m.filter((r) => r.serviceProvider?.reference === params["service-provider"]);
      return m;
    },
  };
  return { client, log, reads };
}

describe("getConsultationsWithDetails batching (Task 547)", () => {
  it("never reads Encounters one by one and never runs a clinic-wide Encounter search per encounter", async () => {
    const { client, log, reads } = fake(build(30));
    const out = await getConsultationsWithDetails(["meds_and_bills"], client, "clinic-a");
    expect(out).toHaveLength(30);
    expect(reads.filter((r) => r.startsWith("Encounter/") || r.startsWith("Patient/"))).toEqual([]);
    const encounterSearches = log.filter((l) => l.type === "Encounter");
    // 1 queue search + ceil(30/25)=2 patient-scoped searches; every non-queue one is subject-filtered.
    expect(encounterSearches.length).toBe(3);
    expect(encounterSearches.filter((l) => !l.params.subject && !l.params["service-provider"])).toEqual([]);
  });

  it("uses the same number of searches for 3 encounters as for 25", async () => {
    const small = fake(build(3));
    const big = fake(build(25));
    await getConsultationsWithDetails(["meds_and_bills"], small.client, "clinic-a");
    await getConsultationsWithDetails(["meds_and_bills"], big.client, "clinic-a");
    expect(big.log.length).toBe(small.log.length);
  });

  it("keeps clinic isolation and returns the clinical data", async () => {
    const { client } = fake(build(4));
    const out = await getConsultationsWithDetails(["meds_and_bills"], client, "clinic-a");
    expect(out.map((c) => c.id).sort()).toEqual(["e-0", "e-1", "e-2", "e-3"]);
    expect(out.every((c) => c.patientFullName.startsWith("Own"))).toBe(true);
    expect(out.find((c) => c.id === "e-2")?.diagnosis).toBe("Dx 2");
  });

  it("returns an empty list when the scoped billing search succeeds with no matches", async () => {
    const { client } = fake(build(0));
    const consultations = await getConsultationsWithDetails(["meds_and_bills"], client, "clinic-a", { throwOnError: true });
    expect(consultations).toEqual([]);
  });

  it.each(["Encounter", "Patient"])("propagates a failed %s search to the billable API caller", async (resourceType) => {
    const { client } = fake(build(1));
    const searchResources = client.searchResources;
    const failure = new Error("Medplum unavailable");
    client.searchResources = async (type: string, params: Record<string, string>) => {
      if (type === resourceType) throw failure;
      return searchResources(type, params);
    };

    await expect(getConsultationsWithDetails(["meds_and_bills"], client, "clinic-a", { throwOnError: true })).rejects.toBe(failure);
  });
});
