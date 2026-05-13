import { NextRequest, NextResponse } from "next/server";
import { requireClinicAuth } from "@/lib/server/medplum-auth";
import { handleRouteError } from "@/lib/server/route-helpers";
import { ensureClinicianSchedule, listClinicSchedules } from "@/lib/fhir/scheduling-service";

export async function GET(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    if (!clinicId) {
      return NextResponse.json({ error: "Clinic context is required" }, { status: 400 });
    }

    const schedules = await listClinicSchedules(medplum, clinicId);
    return NextResponse.json({ success: true, schedules, count: schedules.length });
  } catch (error) {
    return handleRouteError(error, "GET /api/scheduling/schedules");
  }
}

export async function POST(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    if (!clinicId) {
      return NextResponse.json({ error: "Clinic context is required" }, { status: 400 });
    }

    const { practitionerId, practitionerName } = await request.json();
    if (!practitionerId) {
      return NextResponse.json({ error: "Missing practitionerId" }, { status: 400 });
    }

    const schedule = await ensureClinicianSchedule(medplum, {
      clinicId,
      practitionerId,
      practitionerName,
    });

    return NextResponse.json({ success: true, schedule });
  } catch (error) {
    return handleRouteError(error, "POST /api/scheduling/schedules");
  }
}

