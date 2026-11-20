import { assertSafeFhirId } from "@/lib/server/clinic-id";
import { NextRequest, NextResponse } from "next/server";
import { getAdminMedplum } from "@/lib/server/medplum-admin";
import { requireClinicAuth } from "@/lib/server/medplum-auth";
import { NotFoundError, handleRouteError } from "@/lib/server/route-helpers";
import {
  getFollowUpClinicId,
  markFollowUpOpened,
  sendFollowUpWithTwilio,
  updateFollowUpStatus,
  deleteFollowUp,
  type FollowUpStatus,
} from "@/lib/fhir/communication-service";

const VALID_STATUSES: FollowUpStatus[] = ["preparation", "in-progress", "completed", "stopped"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { clinicId } = await requireClinicAuth(req);
    const medplum = await getAdminMedplum();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const status = body?.status as FollowUpStatus | undefined;
    const action = body?.action as string | undefined;

    if (!id) {
      return NextResponse.json({ success: false, error: "ID required" }, { status: 400 });
    }
    if (!status && !action) {
      return NextResponse.json({ success: false, error: "status or action required" }, { status: 400 });
    }
    if (action !== undefined && action !== "open" && action !== "send-twilio") {
      return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
    }
    if (status && !VALID_STATUSES.includes(status)) {
      return NextResponse.json({ success: false, error: "Invalid status" }, { status: 400 });
    }

    assertSafeFhirId(id);

    const comm = await medplum.readResource("Communication", id);
    if (getFollowUpClinicId(comm) !== clinicId) {
      throw new NotFoundError("Follow up not found.");
    }

    const followUp =
      action === "open"
        ? await markFollowUpOpened(medplum, id, clinicId)
        : action === "send-twilio"
          ? await sendFollowUpWithTwilio(medplum, id, clinicId)
          : await updateFollowUpStatus(medplum, id, status!, clinicId);
    return NextResponse.json({ success: true, followUp });
  } catch (error) {
    return handleRouteError(error, "PATCH /api/follow-up/[id]");
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { clinicId } = await requireClinicAuth(req);
    const medplum = await getAdminMedplum();
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ success: false, error: "ID required" }, { status: 400 });
    }

    assertSafeFhirId(id);

    const comm = await medplum.readResource("Communication", id);
    if (getFollowUpClinicId(comm) !== clinicId) {
      throw new NotFoundError("Follow up not found.");
    }

    try {
      await deleteFollowUp(medplum, id, clinicId);
    } catch (deleteError) {
      const msg = deleteError instanceof Error ? deleteError.message : String(deleteError);
      const isGone = msg.includes("Gone") || msg.includes("410");
      if (!isGone) throw deleteError;
      // Resource already deleted — treat as success
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/follow-up/[id]");
  }
}
