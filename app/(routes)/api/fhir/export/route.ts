import { NextRequest } from "next/server";
import { getConsultationFromMedplum } from "@/lib/fhir/consultation-service";
import { getPatientFromMedplum } from "@/lib/fhir/patient-service";
import { toFhirPatient, toFhirEncounter, toFhirCondition, toFhirMedicationRequest, toFhirServiceRequest } from "@/lib/fhir/mappers";
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

    const body = await req.json();
    const parsed = exportBodySchema.safeParse(body);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 });
    }
    const { consultationId } = parsed.data;

    const consultation = await getConsultationFromMedplum(consultationId, clinicId, medplum);
    if (!consultation) return new Response(JSON.stringify({ error: 'Consultation not found' }), { status: 404 });

    const patient = await getPatientFromMedplum(consultation.patientId, clinicId, medplum);
    if (!patient) return new Response(JSON.stringify({ error: 'Patient not found' }), { status: 404 });

    // Create minimal FHIR resources and link
    const { reference: patientRef } = await toFhirPatient(patient);
    const { reference: encounterRef } = await toFhirEncounter(patientRef, consultation);

    const created: Record<string, any> = { patient: patientRef, encounter: encounterRef };

    if (consultation.diagnosis) {
      created.conditionId = await toFhirCondition(patientRef, encounterRef, consultation.diagnosis);
    }

    if (Array.isArray(consultation.prescriptions)) {
      created.medicationRequestIds = await Promise.all(
        consultation.prescriptions.map(p => toFhirMedicationRequest(patientRef, encounterRef, p))
      );
    }

    if (Array.isArray(consultation.procedures)) {
      created.serviceRequestIds = await Promise.all(
        consultation.procedures.map(pr => toFhirServiceRequest(patientRef, encounterRef, pr))
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

