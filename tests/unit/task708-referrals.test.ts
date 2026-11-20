import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { NextRequest } from "next/server";
import * as auth from "@/lib/server/medplum-auth";
import { makeFake } from "./helpers/fake-medplum";

const referrals = await import("../../app/api/referrals/route");
const consultations = await import("../../app/api/consultations/route");
const clinicId = "fake-referral-clinic-a";
const otherClinicId = "fake-referral-clinic-b";
const patientId = "fake-referral-patient-a";
const otherPatientId = "fake-referral-patient-b";
const encounterId = "fake-referral-encounter";
const subject = { reference: `Patient/${patientId}` };
const clinicIdentifier = (value: string) => [{ system: "clinic", value }];
const signedReferral = {
  kind: "referral",
  status: "completed",
  referralTo: "Fake Hospital",
  referralContent: "Fake signed referral",
};
const referralBody = {
  patientId,
  specialty: "Cardiology",
  facility: "Fake Hospital",
  reason: "Fake referral reason",
};

const serviceRequest = (id: string, clinic: string, patient: string, text = "Referral to Cardiology") => ({
  resourceType: "ServiceRequest",
  id,
  identifier: clinicIdentifier(clinic),
  subject: { reference: `Patient/${patient}` },
  status: "active",
  intent: "order",
  code: { text },
  performer: [{ display: "Fake Hospital" }],
});

function fixture() {
  const fake = makeFake([
    { resourceType: "Organization", id: clinicId, identifier: clinicIdentifier(clinicId) },
    { resourceType: "Patient", id: patientId, identifier: clinicIdentifier(clinicId) },
    { resourceType: "Patient", id: otherPatientId, identifier: clinicIdentifier(otherClinicId) },
    { resourceType: "Encounter", id: encounterId, identifier: clinicIdentifier(clinicId), subject },
    {
      resourceType: "Procedure",
      id: "fake-signed-referral",
      identifier: clinicIdentifier(clinicId),
      subject,
      encounter: { reference: `Encounter/${encounterId}` },
      status: "completed",
      note: [{ text: JSON.stringify(signedReferral) }],
    },
    serviceRequest("fake-own-referral", clinicId, patientId),
    serviceRequest("fake-foreign-referral", otherClinicId, patientId),
    serviceRequest("fake-other-patient-referral", clinicId, otherPatientId),
    serviceRequest("fake-own-lab-order", clinicId, patientId, "Fake glucose order"),
  ]);
  const search = fake.searchResources;
  fake.searchResources = async (type, query) => {
    const matches = await search(type, query);
    return matches.filter((resource) =>
      (!query.subject || resource.subject?.reference === query.subject) &&
      (!query.encounter || resource.encounter?.reference === query.encounter)
    );
  };
  return fake;
}

let medplum: ReturnType<typeof fixture>;
let authSpy: ReturnType<typeof spyOn<typeof auth, "requireClinicAuth">>;
beforeEach(() => {
  medplum = fixture();
  authSpy = spyOn(auth, "requireClinicAuth").mockResolvedValue({ medplum, clinicId } as never);
});
afterEach(() => authSpy.mockRestore());

function request(path: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/referrals", () => {
  test("creates a referral with the session clinic identifier and the authorized patient", async () => {
    const response = await referrals.POST(request("/api/referrals", "POST", {
      ...referralBody,
      clinicId: otherClinicId,
    }));

    expect(response.status).toBe(200);
    const { success, referralId } = await response.json();
    expect(success).toBe(true);
    expect(medplum.db.get(`ServiceRequest/${referralId}`)).toMatchObject({
      resourceType: "ServiceRequest",
      status: "active",
      intent: "order",
      subject,
      identifier: clinicIdentifier(clinicId),
      code: { text: "Referral to Cardiology" },
      reasonCode: [{ text: referralBody.reason }],
      performer: [{ display: referralBody.facility }],
    });
    expect(medplum.writes).toBe(1);
  });

  test("refuses to create a referral for another clinic's patient", async () => {
    const response = await referrals.POST(request("/api/referrals", "POST", {
      ...referralBody,
      patientId: otherPatientId,
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Patient not found" });
    expect(medplum.writes).toBe(0);
  });

  test("lists only referrals matching both the session clinic and patient", async () => {
    const search = spyOn(medplum, "searchResources");
    const response = await referrals.GET(request(`/api/referrals?patientId=${patientId}`, "GET"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      count: 1,
      referrals: [{ id: "fake-own-referral", patientId, specialty: "Cardiology" }],
    });
    expect(search).toHaveBeenCalledWith("ServiceRequest", expect.objectContaining({
      subject: subject.reference,
      identifier: `clinic|${clinicId}`,
    }));
  });
});

describe("signed referral letters on PATCH /api/consultations", () => {
  test.each([
    ["replace", [{ notes: JSON.stringify({ ...signedReferral, referralTo: "Other Fake Hospital" }) }]],
    ["remove", []],
  ] as const)("refuses to %s a signed referral before any consultation writes", async (_action, procedures) => {
    const deleteResource = spyOn(medplum, "deleteResource");
    const response = await consultations.PATCH(request("/api/consultations", "PATCH", {
      consultationId: encounterId,
      chiefComplaint: "Fake unrelated amendment",
      procedures,
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "Signed documents cannot be edited or deleted. Void the document and issue a new one.",
    });
    expect(medplum.writes).toBe(0);
    expect(deleteResource).not.toHaveBeenCalled();
    expect(medplum.db.get("Procedure/fake-signed-referral").note).toEqual([
      { text: JSON.stringify(signedReferral) },
    ]);
  });
});
