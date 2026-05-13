import { NextRequest, NextResponse } from "next/server";
import { listBillingExceptionTasks } from "@/lib/fhir/billing-task-service";
import { requireClinicAuth } from "@/lib/server/medplum-auth";
import { handleRouteError } from "@/lib/server/route-helpers";

export async function GET(req: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(req);
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "billing-exception";
    const status = searchParams.get("status") || "open";

    if (type !== "billing-exception") {
      return NextResponse.json({ success: false, error: "Unsupported task type" }, { status: 400 });
    }
    if (status !== "open" && status !== "all") {
      return NextResponse.json({ success: false, error: "status must be 'open' or 'all'" }, { status: 400 });
    }

    const tasks = await listBillingExceptionTasks(medplum, status, clinicId);
    return NextResponse.json({ success: true, count: tasks.length, tasks });
  } catch (error) {
    return handleRouteError(error, "GET /api/tasks");
  }
}

