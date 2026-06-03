import { NextRequest, NextResponse } from "next/server";
import { requireClinicAuth } from "@/lib/server/medplum-auth";
import { handleRouteError } from "@/lib/server/route-helpers";
import { bookSlotToAppointmentWithAdmin } from "@/lib/fhir/scheduling-service";

export async function POST(request: NextRequest) {
  try {
    const { clinicId } = await requireClinicAuth(request);
    if (!clinicId) {
      return NextResponse.json({ error: "Clinic context is required" }, { status: 400 });
    }

    const {
      slotId,
      patientId,
      reason,
      clinicianDisplayOverride,
      durationMinutes,
      reminderDaysBefore,
    } = await request.json();
    if (!slotId || !patientId || !reason) {
      return NextResponse.json({ error: "Missing slotId, patientId, or reason" }, { status: 400 });
    }

    const result = await bookSlotToAppointmentWithAdmin(clinicId, {
      slotId,
      patientId,
      reason,
      clinicianDisplayOverride,
      durationMinutes,
      reminderDaysBefore,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleRouteError(error, "POST /api/scheduling/book");
  }
}
