import { NextRequest, NextResponse } from "next/server";
import { saveOrganizationDetailsToMedplum } from "@/lib/fhir/organization-service";

/**
 * POST /api/admin/clinics
 * Create a new clinic Organisation in Medplum.
 */
export async function POST(req: NextRequest) {
  try {
    const { name, subdomain, phone, address, logoUrl } = await req.json();

    if (!name || !subdomain) {
      return NextResponse.json(
        { error: "name and subdomain are required" },
        { status: 400 }
      );
    }

    // Validate subdomain format
    if (!/^[a-z0-9-]+$/.test(subdomain)) {
      return NextResponse.json(
        { error: "subdomain must be lowercase alphanumeric + hyphens only" },
        { status: 400 }
      );
    }

    await saveOrganizationDetailsToMedplum(
      { name, phone: phone || undefined, address: address || undefined, logoUrl: logoUrl || undefined },
      subdomain
    );

    return NextResponse.json({ success: true, subdomain });
  } catch (error: any) {
    console.error("Failed to create clinic:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create clinic" },
      { status: 500 }
    );
  }
}
