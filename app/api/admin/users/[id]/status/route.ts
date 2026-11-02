import { NextRequest, NextResponse } from "next/server";
import { getCurrentProfile, requirePlatformAdmin } from "@/lib/server/medplum-auth";
import { handleRouteError } from "@/lib/server/route-helpers";
import { getAdminMedplum } from "@/lib/server/medplum-admin";
import { getManagedProjectId, setPractitionerActiveInMedplum } from "@/lib/fhir/admin-service";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const caller = await requirePlatformAdmin(req);
    const [me, projectId] = await Promise.all([
      caller.get("auth/me"),
      getAdminMedplum().then(getManagedProjectId),
    ]);
    if (me.project?.id !== projectId) {
      return NextResponse.json({ error: "Admin access to the managed project is required." }, { status: 403 });
    }
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    if (typeof body?.active !== "boolean") {
      return NextResponse.json(
        { error: "active (boolean) is required" },
        { status: 400 }
      );
    }

    if (body.active === false) {
      const profile = await getCurrentProfile(req);
      if (profile.resourceType === "Practitioner" && profile.id === id) {
        return NextResponse.json(
          { error: "You cannot deactivate your own account." },
          { status: 403 }
        );
      }
    }

    const updated = await setPractitionerActiveInMedplum(id, body.active);
    return NextResponse.json({ success: true, user: updated });
  } catch (error) {
    return handleRouteError(error, "PATCH /api/admin/users/[id]/status");
  }
}
