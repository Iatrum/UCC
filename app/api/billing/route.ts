import { NextRequest, NextResponse } from "next/server";
import {
  completeCheckoutInvoice,
  generateInvoiceNumber,
  getInvoiceNumber,
  getInvoice,
  getPatientInvoices,
  getConsultationInvoice,
  voidInvoice,
  deleteInvoice,
} from "@/lib/fhir/billing-service";
import { createBillingExceptionTask } from "@/lib/fhir/billing-task-service";
import { requireClinicAuth } from "@/lib/server/medplum-auth";
import { handleRouteError } from "@/lib/server/route-helpers";
import { getCurrentProfile } from "@/lib/server/medplum-auth";

function isClientFixableBillingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /required|Invalid|must|match|Full payment/i.test(error.message);
}

function getRequesterReferenceFromProfile(profile: Awaited<ReturnType<typeof getCurrentProfile>>): string | undefined {
  if (!profile?.resourceType || !profile?.id) return undefined;
  return `${profile.resourceType}/${profile.id}`;
}

function validateRequestBody(body: any): string | null {
  if (!body || typeof body !== "object") {
    return "Invalid JSON body";
  }

  if (!body.consultationId || !body.patientId) {
    return "consultationId and patientId are required";
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return "At least one invoice item is required";
  }

  if (!["cash", "card", "qr", "panel"].includes(body.paymentMethod)) {
    return "Invalid payment method";
  }

  const paidAmount = Number(body.paidAmount);
  const totalAmount = Number(body.totalAmount);
  if (!Number.isFinite(paidAmount) || !Number.isFinite(totalAmount)) {
    return "paidAmount and totalAmount must be valid amounts";
  }

  if (paidAmount + 0.01 < totalAmount) {
    return "Full payment is required before checkout completion";
  }

  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const validationError = validateRequestBody(body);

  if (validationError) {
    return NextResponse.json({ success: false, error: validationError }, { status: 400 });
  }

  try {
    const { medplum, clinicId } = await requireClinicAuth(req);
    const profile = await getCurrentProfile(req).catch(() => null);
    const requesterReference = profile ? getRequesterReferenceFromProfile(profile) : undefined;

    const result = await completeCheckoutInvoice(medplum, {
      consultationId: body.consultationId,
      patientId: body.patientId,
      clinicId,
      items: body.items,
      paymentMethod: body.paymentMethod,
      paidAmount: body.paidAmount,
      totalAmount: body.totalAmount,
      invoiceNumber: body.invoiceNumber,
    });
    const invoice = result.invoice;

    if (result.queueUpdateError) {
      await createBillingExceptionTask(medplum, {
        consultationId: body.consultationId,
        patientId: body.patientId,
        clinicId,
        paymentMethod: body.paymentMethod,
        invoiceId: invoice.id,
        errorClass: "queue-update-failed",
        errorSummary: `Invoice saved, but queue status update failed: ${result.queueUpdateError}`,
        requesterReference,
      });
    }

    return NextResponse.json({
      success: true,
      invoiceId: invoice.id,
      invoiceNumber: getInvoiceNumber(invoice),
    });
  } catch (error) {
    if (isClientFixableBillingError(error)) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : "Invalid billing request" },
        { status: 400 }
      );
    }

    // Validation already passed above; failures here are operational and should be queued.
    try {
      const { medplum, clinicId } = await requireClinicAuth(req);
      const profile = await getCurrentProfile(req).catch(() => null);
      const requesterReference = profile ? getRequesterReferenceFromProfile(profile) : undefined;
      await createBillingExceptionTask(medplum, {
        consultationId: body.consultationId,
        patientId: body.patientId,
        clinicId,
        paymentMethod: body.paymentMethod,
        errorClass: "billing-checkout-failed",
        errorSummary: error instanceof Error ? error.message : "Billing checkout failed unexpectedly",
        requesterReference,
      });
    } catch (taskError) {
      console.error("[POST /api/billing] Failed to create billing exception task", taskError);
    }

    return handleRouteError(error, "POST /api/billing");
  }
}

export async function GET(req: NextRequest) {
  try {
    const { medplum } = await requireClinicAuth(req);
    const { searchParams } = new URL(req.url);
    const invoiceId = searchParams.get("id");
    const patientId = searchParams.get("patientId");
    const consultationId = searchParams.get("consultationId");

    if (invoiceId) {
      const invoice = await getInvoice(medplum, invoiceId);
      if (!invoice) return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 });
      return NextResponse.json({ success: true, invoice, invoiceNumber: getInvoiceNumber(invoice) });
    }

    if (consultationId) {
      const invoice = await getConsultationInvoice(medplum, consultationId);
      if (!invoice && searchParams.get("previewNumber") === "true") {
        return NextResponse.json({ success: true, invoice: null, invoiceNumber: await generateInvoiceNumber(medplum) });
      }
      if (!invoice) return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 });
      return NextResponse.json({ success: true, invoice, invoiceNumber: getInvoiceNumber(invoice) });
    }

    if (patientId) {
      const invoices = await getPatientInvoices(medplum, patientId);
      return NextResponse.json({ success: true, count: invoices.length, invoices });
    }

    return NextResponse.json({ success: false, error: "Missing query parameter: id, patientId, or consultationId" }, { status: 400 });
  } catch (error) {
    return handleRouteError(error, "GET /api/billing");
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { medplum } = await requireClinicAuth(req);
    const body = await req.json().catch(() => null);
    const { invoiceId, action } = body || {};

    if (!invoiceId) return NextResponse.json({ success: false, error: "invoiceId is required" }, { status: 400 });
    if (action !== "void") return NextResponse.json({ success: false, error: "action must be 'void'" }, { status: 400 });

    const invoice = await voidInvoice(medplum, invoiceId);
    return NextResponse.json({ success: true, invoiceId: invoice.id });
  } catch (error) {
    return handleRouteError(error, "PATCH /api/billing");
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { medplum } = await requireClinicAuth(req);
    const body = await req.json().catch(() => null);
    const { invoiceId } = body || {};

    if (!invoiceId) return NextResponse.json({ success: false, error: "invoiceId is required" }, { status: 400 });

    await deleteInvoice(medplum, invoiceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/billing");
  }
}
