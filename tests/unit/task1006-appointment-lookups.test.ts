import { expect, spyOn, test } from "bun:test";
import { loadAppointmentLookups, type AppointmentLookup } from "@/modules/appointments/pages/appointment-lookups";
import type { Patient } from "@/lib/fhir/patient-client";
import type { PractitionerOption } from "@/lib/fhir/practitioner-client";

test("the booking page receives its patient options before a pending clinician request fails", async () => {
  const clinicianRequest = Promise.withResolvers<Response>();
  const patients = Promise.withResolvers<AppointmentLookup<Patient>>();
  const clinicians = Promise.withResolvers<AppointmentLookup<PractitionerOption>>();
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (input === "/api/practitioners") return clinicianRequest.promise;
    expect(input).toBe("/api/patients?limit=200");
    return Response.json({
      success: true,
      patients: [{ id: "fake-patient", fullName: "Fake Patient" }],
    });
  });

  const cancel = loadAppointmentLookups(patients.resolve, clinicians.resolve);
  try {
    expect(await patients.promise).toMatchObject({
      options: [{ id: "fake-patient", fullName: "Fake Patient" }],
      error: null,
    });
    clinicianRequest.resolve(Response.json({
      error: "You do not have permission to perform this action.",
    }, { status: 403 }));
    expect(await clinicians.promise).toEqual({
      options: [],
      error: "Unable to load clinicians. You do not have permission to perform this action.",
    });
  } finally {
    cancel();
    fetchMock.mockRestore();
  }
});
