import { NextRequest, NextResponse } from "next/server";
import { requireClinicAuth } from "@/lib/server/medplum-auth";
import { handleRouteError } from "@/lib/server/route-helpers";
import { manualBookAppointmentWithSlotWithAdmin } from "@/lib/fhir/scheduling-service";

export async function POST(request: NextRequest) {
  try {
    const { clinicId } = await requireClinicAuth(request);
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
      reminderDaysBefore,
    } = await request.json();

    if (!patientId || !practitionerId || !scheduledAt || !reason) {
      return NextResponse.json(
        { error: "Missing patientId, practitionerId, scheduledAt, or reason" },
        { status: 400 }
      );
    }

    const result = await manualBookAppointmentWithSlotWithAdmin(clinicId, {
      patientId,
      practitionerId,
      practitionerName,
      scheduledAt,
      durationMinutes: Number(durationMinutes),
      reason,
      type,
      notes,
      reminderDaysBefore,
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
