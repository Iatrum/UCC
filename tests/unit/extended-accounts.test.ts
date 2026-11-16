import { describe, expect, it } from "bun:test";
import { receiveImagingStudy } from "../../lib/fhir/imaging-service";
import { receiveLabResults } from "../../lib/fhir/lab-service";
import { CLINIC_IDENTIFIER_SYSTEM } from "../../lib/fhir/clinic-tenancy";

// Fake Medplum server semantics (Task 330): meta.accounts is only returned
// when the request carries `X-Medplum: extended`. Fake data only.
const ACCOUNT = { reference: "HealthcareService/fake-account-a" };
type Call = { method: string; url: string };

function fakeClient(serviceRequest: Record<string, any>) {
  const calls: Call[] = [];
  const stored: Record<string, any> = { [`ServiceRequest/${serviceRequest.id}`]: serviceRequest };
  let n = 0;
  const client: any = {
    async readResource(type: string, id: string, options?: any) {
      const res = structuredClone(stored[`${type}/${id}`]);
      if (!res) throw new Error(`not found ${type}/${id}`);
      if (options?.headers?.["X-Medplum"] !== "extended") delete res.meta?.accounts;
      return res;
    },
    async createResource(resource: any) {
      const created = { ...structuredClone(resource), id: `fake-${++n}`, meta: { versionId: "1" } };
      stored[`${created.resourceType}/${created.id}`] = { ...created, meta: { ...created.meta, accounts: [] } };
      return created;
    },
    async executeBatch(bundle: any) {
      const entry = [];
      for (const e of bundle.entry) {
        entry.push({ response: { status: "201" }, resource: await client.createResource(e.resource) });
      }
      return { resourceType: "Bundle", type: "transaction-response", entry };
    },
    async updateResource(resource: any) { return resource; },
    async post(url: string) { calls.push({ method: "POST", url }); return {}; },
    async searchResources() { return []; },
    async searchOne(type: string) {
      if (type === "Organization") return { resourceType: type, id: "fake-org-a" };
      if (type === "HealthcareService") return { resourceType: type, id: "fake-account-a" };
      return undefined;
    },
    async getProfileAsync() { return { resourceType: "ClientApplication", id: "fake-app" }; },
  };
  return { client, calls };
}

function serviceRequest(code: string) {
  return {
    resourceType: "ServiceRequest",
    id: "sr-1",
    status: "active",
    intent: "order",
    subject: { reference: "Patient/fake-p1" },
    identifier: [{ system: CLINIC_IDENTIFIER_SYSTEM, value: "fake-clinic-a" }],
    code: { coding: [{ system: "http://loinc.org", code }], text: "fake" },
    meta: { accounts: [ACCOUNT] },
  };
}

describe("extended-mode account propagation", () => {
  it("fake client hides accounts without the header (guard for the fixture)", async () => {
    const { client } = fakeClient(serviceRequest("718-7"));
    expect((await client.readResource("ServiceRequest", "sr-1")).meta.accounts).toBeUndefined();
  });

  it("receiveImagingStudy stamps the order's account on the ImagingStudy", async () => {
    const { client, calls } = fakeClient(serviceRequest("36643-5"));
    await receiveImagingStudy("sr-1", {
      studyUid: "1.2.3", series: [], numberOfSeries: 0, numberOfInstances: 0, modality: "DX",
    } as any, client, "fake-clinic-a");
    expect(calls.some(c => /ImagingStudy\/fake-\d+\/\$set-accounts$/.test(c.url))).toBe(true);
  });

  it("receiveLabResults stamps the order's account on Observation and DiagnosticReport", async () => {
    const { client, calls } = fakeClient(serviceRequest("718-7"));
    await receiveLabResults("sr-1", [
      { testCode: "718-7", testName: "Hemoglobin", value: 13.5, unit: "g/dL", status: "final" },
    ] as any, undefined, client, "fake-clinic-a");
    expect(calls.some(c => /Observation\/.*\/\$set-accounts$/.test(c.url))).toBe(true);
    expect(calls.some(c => /DiagnosticReport\/.*\/\$set-accounts$/.test(c.url))).toBe(true);
  });
});
