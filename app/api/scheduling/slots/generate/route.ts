import { NextRequest, NextResponse } from "next/server";
import { requireClinicAuth } from "@/lib/server/medplum-auth";
import { handleRouteError } from "@/lib/server/route-helpers";
import { ensureClinicianSchedule, generateSlotsForSchedule } from "@/lib/fhir/scheduling-service";

export async function POST(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    if (!clinicId) {
      return NextResponse.json({ error: "Clinic context is required" }, { status: 400 });
    }

    const {
      practitionerId,
      practitionerName,
      scheduleId,
      start,
      end,
      durationMinutes = 30,
    } = await request.json();

    if (!start || !end) {
      return NextResponse.json({ error: "Missing start/end fields" }, { status: 400 });
    }

    let resolvedScheduleId = scheduleId as string | undefined;
    if (!resolvedScheduleId) {
      if (!practitionerId) {
        return NextResponse.json({ error: "Missing practitionerId or scheduleId" }, { status: 400 });
      }
      const schedule = await ensureClinicianSchedule(medplum, {
        clinicId,
        practitionerId,
        practitionerName,
      });
      resolvedScheduleId = schedule.id;
    }

    const result = await generateSlotsForSchedule(medplum, clinicId, {
      scheduleId: resolvedScheduleId,
      start,
      end,
      durationMinutes: Number(durationMinutes),
    });

    return NextResponse.json({
      success: true,
      scheduleId: resolvedScheduleId,
      ...result,
    });
  } catch (error) {
    return handleRouteError(error, "POST /api/scheduling/slots/generate");
  }
}

