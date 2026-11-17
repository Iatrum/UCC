import { NextRequest, NextResponse } from "next/server";
import { updateTwilioDeliveryStatus } from "@/lib/fhir/communication-service";
import { getAdminMedplum } from "@/lib/server/medplum-admin";
import { handleRouteError } from "@/lib/server/route-helpers";
import { isValidTwilioSignature } from "@/lib/server/twilio-signature";

const forbidden = () => NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });

export async function POST(req: NextRequest) {
  try {
    // Twilio status callbacks are application/x-www-form-urlencoded and signed over the
    // exact StatusCallback URL we gave Twilio (not the proxied request URL) plus the params.
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/x-www-form-urlencoded")) return forbidden();

    const params: Record<string, string> = {};
    for (const [key, value] of (await req.formData()).entries()) {
      if (typeof value === "string") params[key] = value;
    }

    // Authenticate BEFORE any Medplum access. Unset token/URL or a bad signature => 403.
    const valid = isValidTwilioSignature({
      authToken: process.env.TWILIO_AUTH_TOKEN,
      url: process.env.TWILIO_STATUS_CALLBACK_URL,
      signature: req.headers.get("x-twilio-signature"),
      params,
    });
    if (!valid) {
      console.warn("[POST /api/follow-up/twilio/status] Rejected callback: invalid or unverifiable signature");
      return forbidden();
    }

    const messageSid = String(params.MessageSid || params.SmsSid || "");
    const status = String(params.MessageStatus || params.SmsStatus || "");
    const error = params.ErrorCode ? `Twilio error ${params.ErrorCode}` : undefined;

    if (!messageSid || !status) {
      return NextResponse.json({ success: false, error: "MessageSid and status are required" }, { status: 400 });
    }

    const medplum = await getAdminMedplum();
    const followUp = await updateTwilioDeliveryStatus(medplum, messageSid, status, error);
    return NextResponse.json({ success: true, found: Boolean(followUp) });
  } catch (error) {
    return handleRouteError(error, "POST /api/follow-up/twilio/status");
  }
}
