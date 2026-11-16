import { NextRequest } from "next/server";
import { getConsultationFromMedplum } from "@/lib/fhir/consultation-service";
import { getPatientFromMedplum } from "@/lib/fhir/patient-service";
import { toFhirEncounter, toFhirCondition, toFhirMedicationRequest, toFhirServiceRequest } from "@/lib/fhir/mappers";
import { assertPatientInClinic, assertEncounterInClinic } from "@/lib/fhir/write-containment";
import { requireClinicAuth } from "@/lib/server/medplum-auth";
import { z } from "zod";
import { writeServerAuditLog } from "@/lib/server/logging";

const exportBodySchema = z.object({
  consultationId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    // Auth: require valid Medplum session (practitioner token)
    let authContext: Awaited<ReturnType<typeof requireClinicAuth>>;
    try {
      authContext = await requireClinicAuth(req);
    } catch {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    const { medplum, clinicId } = authContext;
    const practitionerProfile = medplum.getProfile();
    const actorId = practitionerProfile?.id ?? 'unknown';

    // Fail closed: exports are always clinic-scoped.
    if (!clinicId) return new Response(JSON.stringify({ error: 'Clinic context is required' }), { status: 400 });

    const body = await req.json();
    const parsed = exportBodySchema.safeParse(body);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 });
    }
    const { consultationId } = parsed.data;
    // Authorize before loading the consultation graph with all its clinical data.
    try {
      await assertEncounterInClinic(medplum, clinicId, consultationId);
    } catch {
      return new Response(JSON.stringify({ error: 'Consultation not found' }), { status: 404 });
    }

    const consultation = await getConsultationFromMedplum(consultationId, clinicId, medplum);
    if (!consultation) return new Response(JSON.stringify({ error: 'Consultation not found' }), { status: 404 });

    const patient = await getPatientFromMedplum(consultation.patientId, clinicId, medplum);
    if (!patient) return new Response(JSON.stringify({ error: 'Patient not found' }), { status: 404 });

    // Task 350: prove patient + visit belong to this clinic before any create, and
    // re-use the existing Patient instead of creating an untagged duplicate.
    try {
      await assertPatientInClinic(medplum, clinicId, consultation.patientId, consultation.id);
    } catch {
      return new Response(JSON.stringify({ error: 'Consultation not found' }), { status: 404 });
    }
    const patientRef = `Patient/${consultation.patientId}`;
    const { reference: encounterRef } = await toFhirEncounter(patientRef, consultation, undefined, clinicId, medplum);

    const created: Record<string, any> = { patient: patientRef, encounter: encounterRef };

    if (consultation.diagnosis) {
      created.conditionId = await toFhirCondition(patientRef, encounterRef, consultation.diagnosis, clinicId, medplum);
    }

    if (Array.isArray(consultation.prescriptions)) {
      created.medicationRequestIds = await Promise.all(
        consultation.prescriptions.map(p => toFhirMedicationRequest(patientRef, encounterRef, p, clinicId, medplum))
      );
    }

    if (Array.isArray(consultation.procedures)) {
      created.serviceRequestIds = await Promise.all(
        consultation.procedures.map(pr => toFhirServiceRequest(patientRef, encounterRef, pr, clinicId, medplum))
      );
    }

    await writeServerAuditLog({
      action: 'fhir_export',
      subjectType: 'consultation',
      subjectId: consultation.id!,
      userId: actorId,
      metadata: { createdRefs: created },
    });

    return new Response(JSON.stringify({ ok: true, created }), { status: 200 });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: 'Unexpected error' }), { status: 500 });
  }
}

