import { NextRequest, NextResponse } from "next/server";
import {
  saveTriageEncounter,
  getTriageForPatient,
  updateTriageEncounter,
  getActiveTriageEncounter,
} from "@/lib/fhir/triage-service";
import { getPatientFromMedplum } from "@/lib/fhir/patient-service";
import { TriageLevel, VitalSigns } from "@/lib/types";
import { getCurrentProfile, requireClinicAuth } from "@/lib/server/medplum-auth";
import { handleRouteError } from "@/lib/server/route-helpers";

export async function POST(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const body = await request.json();

    const {
      patientId,
      triageLevel,
      chiefComplaint,
      vitalSigns,
      visitIntent,
      payerType,
      paymentMethod,
      assignedClinician,
      billingPerson,
      dependentName,
      dependentRelationship,
      dependentPhone,
      triageNotes,
      redFlags,
    } = body;

    if (!patientId || !triageLevel || !chiefComplaint) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (triageLevel < 1 || triageLevel > 5) {
      return NextResponse.json({ error: "Invalid triage level" }, { status: 400 });
    }

    const patient = await getPatientFromMedplum(patientId, clinicId, medplum);
    if (!patient) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    let triageBy = "Unknown";
    try {
      const profile = await getCurrentProfile(request);
      triageBy =
        (profile as any)?.name?.[0]?.text ||
        (profile as any)?.name?.[0]?.family ||
        (profile as any)?.id ||
        triageBy;
    } catch {
      // non-blocking
    }

    await saveTriageEncounter(patientId, {
      triageLevel: triageLevel as TriageLevel,
      chiefComplaint,
      vitalSigns: vitalSigns as VitalSigns,
      visitIntent,
      payerType,
      paymentMethod,
      assignedClinician,
      billingPerson,
      dependentName,
      dependentRelationship,
      dependentPhone,
      registrationSource: "triage",
      registrationAt: new Date().toISOString(),
      triageNotes,
      redFlags: redFlags || [],
      triageBy,
    }, medplum, clinicId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, "POST /api/triage");
  }
}

export async function GET(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get("patientId");

    if (!patientId) {
      return NextResponse.json({ error: "Missing patientId" }, { status: 400 });
    }

    const patient = await getPatientFromMedplum(patientId, clinicId, medplum);
    if (!patient) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    const triage = await getTriageForPatient(patientId, medplum, clinicId);
    return NextResponse.json({ success: true, triage });
  } catch (error) {
    return handleRouteError(error, "GET /api/triage");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const body = await request.json();
    const { patientId, ...triageData } = body;

    if (!patientId) {
      return NextResponse.json({ error: "Missing patientId" }, { status: 400 });
    }

    const patient = await getPatientFromMedplum(patientId, clinicId, medplum);
    if (!patient) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    await updateTriageEncounter(patientId, triageData, medplum, clinicId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, "PATCH /api/triage");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const body = await request.json();
    const { patientId } = body;

    if (!patientId) {
      return NextResponse.json({ error: "Missing patientId" }, { status: 400 });
    }

    const patient = await getPatientFromMedplum(patientId, clinicId, medplum);
    if (!patient) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    const existing = await getActiveTriageEncounter(patientId, medplum, clinicId);
    if (!existing) {
      return NextResponse.json({ error: "No active triage encounter found" }, { status: 404 });
    }

    await medplum.deleteResource("Encounter", existing.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/triage");
  }
}
