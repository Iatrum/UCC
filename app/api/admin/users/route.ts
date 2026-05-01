import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/server/medplum-auth";
import { handleRouteError } from "@/lib/server/route-helpers";
import { getPractitionersFromMedplum } from "@/lib/fhir/admin-service";
import { getAdminMedplum } from "@/lib/server/medplum-admin";

export async function GET(req: NextRequest) {
  try {
    await requirePlatformAdmin(req);
    const medplum = await getAdminMedplum();
    const users = await getPractitionersFromMedplum(medplum);
    return NextResponse.json({ success: true, count: users.length, users });
  } catch (error) {
    return handleRouteError(error, "GET /api/admin/users");
  }
}
