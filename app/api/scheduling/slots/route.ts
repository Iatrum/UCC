import { NextRequest, NextResponse } from "next/server";
import { requireClinicAuth } from "@/lib/server/medplum-auth";
import { handleRouteError } from "@/lib/server/route-helpers";
import { findSlots } from "@/lib/fhir/scheduling-service";

export async function GET(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    if (!clinicId) {
      return NextResponse.json({ error: "Clinic context is required" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const scheduleId = searchParams.get("scheduleId") || undefined;
    const practitionerId = searchParams.get("practitionerId") || undefined;
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const status = (searchParams.get("status") as "free" | "busy" | "busy-unavailable" | "busy-tentative" | "entered-in-error" | null) || "free";

    if (!start || !end) {
      return NextResponse.json({ error: "Missing start/end query params" }, { status: 400 });
    }

    const slots = await findSlots(medplum, clinicId, {
      scheduleId,
      practitionerId,
      start,
      end,
      status,
    });

    return NextResponse.json({ success: true, slots, count: slots.length });
  } catch (error) {
    return handleRouteError(error, "GET /api/scheduling/slots");
  }
}

