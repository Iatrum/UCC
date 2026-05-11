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
import { requireClinicAuth } from "@/lib/server/medplum-auth";
import { handleRouteError } from "@/lib/server/route-helpers";

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
  try {
    const body = await req.json().catch(() => null);
    const validationError = validateRequestBody(body);

    if (validationError) {
      return NextResponse.json({ success: false, error: validationError }, { status: 400 });
    }

    const { medplum, clinicId } = await requireClinicAuth(req);
    const invoice = await completeCheckoutInvoice(medplum, {
      consultationId: body.consultationId,
      patientId: body.patientId,
      clinicId,
      items: body.items,
      paymentMethod: body.paymentMethod,
      paidAmount: body.paidAmount,
      totalAmount: body.totalAmount,
      invoiceNumber: body.invoiceNumber,
    });

    return NextResponse.json({
      success: true,
      invoiceId: invoice.id,
      invoiceNumber: getInvoiceNumber(invoice),
    });
  } catch (error) {
    if (error instanceof Error && /required|Invalid|must|match|Full payment/.test(error.message)) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
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
