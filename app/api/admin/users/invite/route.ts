import { NextRequest, NextResponse } from "next/server";
import { invitePractitionerToMedplum } from "@/lib/fhir/admin-service";

export async function POST(req: NextRequest) {
  try {
    const { firstName, lastName, email, clinicId, sendEmail } = await req.json();

    if (!firstName || !lastName || !email || !clinicId) {
      return NextResponse.json(
        { error: "firstName, lastName, email, and clinicId are required" },
        { status: 400 }
      );
    }

    await invitePractitionerToMedplum({
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      email: String(email).trim().toLowerCase(),
      clinicId: String(clinicId).trim(),
      sendEmail: sendEmail !== false,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to invite practitioner:", error);
    return NextResponse.json(
      { error: error.message || "Failed to invite practitioner" },
      { status: 500 }
    );
  }
}
