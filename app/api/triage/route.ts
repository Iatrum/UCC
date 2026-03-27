import { NextRequest, NextResponse } from "next/server";
import { saveTriageEncounter } from "@/lib/fhir/triage-service";
import { TriageLevel, VitalSigns } from "@/lib/types";
import { getCurrentProfile, getMedplumForRequest } from "@/lib/server/medplum-auth";

export async function POST(request: NextRequest) {
  try {
    const medplum = await getMedplumForRequest(request);
    const body = await request.json();
    
    const {
      patientId,
      triageLevel,
      chiefComplaint,
      vitalSigns,
      triageNotes,
      redFlags,
    } = body;

    // Validation
    if (!patientId || !triageLevel || !chiefComplaint) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (triageLevel < 1 || triageLevel > 5) {
      return NextResponse.json(
        { error: "Invalid triage level" },
        { status: 400 }
      );
    }

    // Determine triageBy from Medplum profile (if available)
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

    // Perform triage against Medplum (no Firestore dependency)
    await saveTriageEncounter(patientId, {
      triageLevel: triageLevel as TriageLevel,
      chiefComplaint,
      vitalSigns: vitalSigns as VitalSigns,
      triageNotes,
      redFlags: redFlags || [],
      triageBy,
    }, medplum);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in triage API:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}







