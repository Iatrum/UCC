import { NextRequest, NextResponse } from "next/server";
import { requireClinicAuth } from "@/lib/server/medplum-auth";
import { handleRouteError } from "@/lib/server/route-helpers";
import { manualBookAppointmentWithSlot } from "@/lib/fhir/scheduling-service";
import { getPatientFromMedplum } from "@/lib/fhir/patient-service";

export async function POST(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    if (!clinicId) {
      return NextResponse.json({ error: "Clinic context is required" }, { status: 400 });
    }

    const {
      patientId,
      practitionerId,
      practitionerName,
      scheduledAt,
      durationMinutes = 30,
      reason,
      type,
      notes,
    } = await request.json();

    if (!patientId || !practitionerId || !scheduledAt || !reason) {
      return NextResponse.json(
        { error: "Missing patientId, practitionerId, scheduledAt, or reason" },
        { status: 400 }
      );
    }

    const patient = await getPatientFromMedplum(patientId, clinicId, medplum, {
      includeMedicalHistory: false,
    });
    if (!patient) {
      return NextResponse.json({ error: "Patient not found in clinic scope" }, { status: 404 });
    }

    const result = await manualBookAppointmentWithSlot(medplum, clinicId, {
      patientId,
      practitionerId,
      practitionerName,
      scheduledAt,
      durationMinutes: Number(durationMinutes),
      reason,
      type,
      notes,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/overlap|unavailable|no longer available/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return handleRouteError(error, "POST /api/scheduling/manual-book");
  }
}
