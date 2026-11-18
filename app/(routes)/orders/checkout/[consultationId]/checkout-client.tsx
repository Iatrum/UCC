"use client";

import { checkoutSubtotal, displayInvoiceNumber, hasBillableItems, NO_BILLABLE_ITEMS_MESSAGE } from "@/lib/billing/checkout-guards";
import {
  buildStockNotice,
  CHECKOUT_NOTICE_STORAGE_KEY,
  computeLineStock,
  type LineStock,
  type StockCatalogItem,
} from "@/lib/billing/checkout-stock";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Eye,
  FileText,
  Loader2,
  Printer,
  ReceiptText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Patient, Consultation } from "@/lib/models";
import { formatDisplayDate } from "@/lib/utils";
import { formatMedicationNameWithStrength, formatPrescriptionDetails } from "@/lib/prescriptions";
import type { TreatmentPlanEntry } from "@/lib/treatment-plan";
import { renderDocumentHtml } from "@/lib/document-render";
import { DEFAULT_TIME_CHIT_TEMPLATE, DEFAULT_MC_TEMPLATE, DEFAULT_REFERRAL_TEMPLATE } from "@/lib/document-templates";
import { printHtml } from "@/lib/print-html";
import { fetchOrganizationDetails, type OrganizationDetails } from "@/lib/org";

type CheckoutClientProps = {
  consultationId: string;
  patientId: string;
};

type OrderDetails = {
  patient: Patient;
  consultation: Consultation;
  draftEntries: TreatmentPlanEntry[];
};

type CheckoutItem = {
  id: string;
  name: string;
  description: string;
  type: "Item" | "Service" | "Package" | "Document";
  category: "items" | "services" | "packages" | "documents";
  quantity: number;
  price: number;
  documentDetails?: CheckoutDocumentDetails;
  orderIndex?: number;
  fallbackIndex: number;
};

type PaymentMethod = "cash" | "card" | "qr" | "panel";

/** Same detail keys the composer/Documents tab use (tc*, mc*, referral*, incl. doctor MMC and mcIncludeDiagnosis). */
type CheckoutDocumentDetails = Record<string, string | undefined> & {
  kind: "mc" | "referral" | "time-chit";
  title: string;
  status?: string;
  instruction?: string;
};

function currency(amount: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
  }).format(amount);
}

function patientFacingDescription(value: string | undefined, category?: string) {
  const text = value?.trim() || "";
  if (!text) return "";

  if (category === "documents" && text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as { kind?: string };
      if (parsed.kind === "time-chit" || parsed.kind === "referral" || parsed.kind === "mc") {
        return "";
      }
    } catch {
      return "";
    }
  }

  return text;
}

function parseDocumentDetails(value: string | undefined, fallbackTitle: string): CheckoutDocumentDetails | undefined {
  const text = value?.trim() || "";
  if (!text.startsWith("{")) return undefined;

  try {
    const parsed = JSON.parse(text) as Record<string, string>;
    if (parsed.kind !== "mc" && parsed.kind !== "referral" && parsed.kind !== "time-chit") return undefined;

    return {
      ...parsed,
      kind: parsed.kind,
      title: parsed.title || fallbackTitle || (parsed.kind === "mc" ? "MEDICAL CERTIFICATE (MC)" : "REFERRAL LETTER"),
    };
  } catch {
    return undefined;
  }
}

function documentDetailsFromDraft(entry: TreatmentPlanEntry): CheckoutDocumentDetails | undefined {
  if (entry.tab !== "documents") return undefined;
  const kind =
    entry.meta?.kind === "time-chit" || entry.catalogRef === "letter-time-chit" ? "time-chit" : entry.meta?.kind === "mc" || entry.catalogRef === "letter-mc"
      ? "mc"
      : entry.meta?.kind === "referral" || entry.catalogRef === "letter-referral"
        ? "referral"
        : null;

  if (!kind) return undefined;

  return {
    ...(entry.meta as Record<string, string | undefined> | undefined),
    kind,
    title: entry.name || (kind === "mc" ? "MEDICAL CERTIFICATE (MC)" : "REFERRAL LETTER"),
    status: entry.meta?.documentStatus || "completed",
    instruction: entry.instruction,
  };
}

function checkoutItemType(category: CheckoutItem["category"]): CheckoutItem["type"] {
  if (category === "items") return "Item";
  if (category === "packages") return "Package";
  if (category === "documents") return "Document";
  return "Service";
}

function normalizeProcedureCategory(procedure: Consultation["procedures"][number]): CheckoutItem["category"] {
  if (procedure.category === "documents" && /^(Lab|Imaging):/i.test(procedure.name || "")) {
    return "services";
  }
  return procedure.category || "services";
}

function buildCheckoutItems(consultation: Consultation | null): CheckoutItem[] {
  if (!consultation) return [];

  const procedures = [...(consultation.procedures || []), ...(consultation.billingItems || [])].map((procedure, index) => {
    const category = normalizeProcedureCategory(procedure);
    return {
      id: `procedure-${index}`,
      name: procedure.name || "Service",
      description: patientFacingDescription(procedure.notes, procedure.category),
      type: checkoutItemType(category),
      category,
      quantity: procedure.quantity ?? 1,
      price: procedure.price ?? 0,
      documentDetails: category === "documents" ? parseDocumentDetails(procedure.notes, procedure.name || "Document") : undefined,
      orderIndex: procedure.orderIndex,
      fallbackIndex: index,
    };
  });

  const procedureCount = procedures.length;
  const prescriptions = (consultation.prescriptions || []).map((prescription, index) => {
    const category = prescription.category || "items";
    return {
      id: `prescription-${index}`,
      name: formatMedicationNameWithStrength(prescription.medication?.name, prescription.medication?.strength),
      description: formatPrescriptionDetails(prescription),
      type: checkoutItemType(category),
      category,
      quantity: prescription.quantity ?? 1,
      price: prescription.price ?? 0,
      orderIndex: prescription.orderIndex,
      fallbackIndex: procedureCount + index,
    };
  });

  const items = [...procedures, ...prescriptions].sort((a, b) => {
    const aOrder = Number.isInteger(a.orderIndex) ? Number(a.orderIndex) : Number.POSITIVE_INFINITY;
    const bOrder = Number.isInteger(b.orderIndex) ? Number(b.orderIndex) : Number.POSITIVE_INFINITY;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.fallbackIndex - b.fallbackIndex;
  });

  if (items.length > 0) {
    return items;
  }

  return [];
}

function buildDraftCheckoutItems(entries: TreatmentPlanEntry[]): CheckoutItem[] {
  return [...entries]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((entry, index) => ({
      id: entry.id,
      name: entry.name,
      description: entry.instruction || formatDraftDetails(entry),
      type: checkoutItemType(entry.tab),
      category: entry.tab,
      quantity: entry.quantity,
      price: entry.unitPrice,
      documentDetails: documentDetailsFromDraft(entry),
      orderIndex: index,
      fallbackIndex: index,
    }));
}

function formatDraftDetails(entry: TreatmentPlanEntry): string {
  return [entry.dosage, entry.frequency, entry.duration].filter(Boolean).join(" · ");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildPrintableBillHtml({
  invoiceNumber,
  date,
  patientName,
  billToName,
  paymentMethod,
  paid,
  balance,
  total,
  items,
}: {
  invoiceNumber: string;
  date: string;
  patientName: string;
  billToName: string;
  paymentMethod: PaymentMethod;
  paid: number;
  balance: number;
  total: number;
  items: CheckoutItem[];
}) {
  const rows = items
    .map(
      (item) => `
        <tr>
          <td>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.description || "")}</span>
          </td>
          <td>${escapeHtml(String(item.quantity))}</td>
          <td>${escapeHtml(currency(item.price))}</td>
          <td>${escapeHtml(currency(item.quantity * item.price))}</td>
        </tr>`
    )
    .join("");

  return `<!doctype html>
    <html>
      <head>
        <title>${escapeHtml(displayInvoiceNumber(invoiceNumber))}</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; background: #fff; color: #111827; font-family: Arial, sans-serif; font-size: 13px; }
          .bill { width: 720px; margin: 0 auto; padding: 32px; }
          .top { display: flex; justify-content: space-between; gap: 24px; border-bottom: 1px solid #d1d5db; padding-bottom: 18px; }
          h1 { margin: 0; font-size: 22px; letter-spacing: 0; }
          .muted { color: #6b7280; }
          .meta { text-align: right; line-height: 1.6; }
          .section { margin-top: 22px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
          .label { color: #6b7280; font-size: 11px; text-transform: uppercase; margin-bottom: 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th { text-align: left; color: #6b7280; font-size: 11px; border-bottom: 1px solid #d1d5db; padding: 8px 0; }
          td { border-bottom: 1px solid #e5e7eb; padding: 10px 0; vertical-align: top; }
          td span { display: block; margin-top: 2px; color: #6b7280; font-size: 12px; }
          th:nth-child(n+2), td:nth-child(n+2) { text-align: right; }
          .totals { margin-left: auto; width: 260px; margin-top: 20px; }
          .line { display: flex; justify-content: space-between; padding: 5px 0; }
          .total { border-top: 1px solid #111827; margin-top: 6px; padding-top: 8px; font-weight: 700; font-size: 15px; }
          .footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid #e5e7eb; color: #6b7280; text-align: center; font-size: 12px; }
          @page { margin: 14mm; }
          @media print { .bill { width: auto; margin: 0; padding: 0; } }
        </style>
      </head>
      <body>
        <main class="bill">
          <div class="top">
            <div>
              <h1>Patient Bill</h1>
              <div class="muted">Clinic checkout invoice</div>
            </div>
            <div class="meta">
              <div><strong>${escapeHtml(displayInvoiceNumber(invoiceNumber))}</strong></div>
              <div>${escapeHtml(date)}</div>
            </div>
          </div>
          <div class="section grid">
            <div>
              <div class="label">Patient</div>
              <div><strong>${escapeHtml(patientName)}</strong></div>
            </div>
            <div>
              <div class="label">Bill to</div>
              <div><strong>${escapeHtml(billToName)}</strong></div>
            </div>
          </div>
          <div class="section">
            <div class="label">Items</div>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <div class="totals">
            <div class="line"><span>Subtotal</span><strong>${escapeHtml(currency(total))}</strong></div>
            <div class="line"><span>Paid (${escapeHtml(paymentMethod.toUpperCase())})</span><strong>${escapeHtml(currency(paid))}</strong></div>
            <div class="line"><span>${balance < 0 ? "Change" : "Balance"}</span><strong>${escapeHtml(currency(balance < 0 ? Math.abs(balance) : balance))}</strong></div>
            <div class="line total"><span>Total</span><strong>${escapeHtml(currency(total))}</strong></div>
          </div>
          <div class="footer">Thank you.</div>
        </main>
      </body>
    </html>`;
}

const DEFAULT_TEMPLATES = { mc: DEFAULT_MC_TEMPLATE, referral: DEFAULT_REFERRAL_TEMPLATE, "time-chit": DEFAULT_TIME_CHIT_TEMPLATE } as const;

/** Checkout uses the same HTML template renderer as the composer preview and the Documents tab. */
async function buildCheckoutDocumentHtml({
  item, patient, issuedDate, organization,
}: {
  item: CheckoutItem;
  patient: Patient;
  issuedDate: Date | string | null | undefined;
  organization: OrganizationDetails | null;
}): Promise<string | null> {
  const details = item.documentDetails;
  if (!details) return null;
  let template: string = DEFAULT_TEMPLATES[details.kind];
  try {
    const res = await fetch(`/api/document-templates?type=${details.kind}`);
    if (res.ok) template = (await res.json()).html || template;
  } catch {
    // fall back to the built-in default
  }
  return renderDocumentHtml({ kind: details.kind, template, details, patient, organization, issuedDate });
}

export default function CheckoutClient({ consultationId, patientId }: CheckoutClientProps) {
  const router = useRouter();
  const [details, setDetails] = useState<OrderDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paidAmount, setPaidAmount] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [billPreviewOpen, setBillPreviewOpen] = useState(false);
  const [documentPreviewItem, setDocumentPreviewItem] = useState<CheckoutItem | null>(null);
  const [documentPreviewHtml, setDocumentPreviewHtml] = useState<string | null>(null);
  const [documentPreviewLoading, setDocumentPreviewLoading] = useState(false);
  const [organization, setOrganization] = useState<OrganizationDetails | null>(null);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [effectivePatientId, setEffectivePatientId] = useState(patientId);
  const [stockCatalog, setStockCatalog] = useState<StockCatalogItem[]>([]);

  useEffect(() => {
    let active = true;

    async function loadDetails() {
      if (!consultationId) {
        setError("Missing checkout consultation reference.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // The patient comes from the consultation (clinic-scoped on the server),
        // so the link works without ?patientId=.
        const orderResponse = await fetch(
          `/api/orders?consultationId=${encodeURIComponent(consultationId)}${
            patientId ? `&patientId=${encodeURIComponent(patientId)}` : ""
          }`
        );
        const payload = await orderResponse.json().catch(() => ({}));
        if (!orderResponse.ok || !payload.patient || !payload.consultation) {
          throw new Error(
            orderResponse.status === 404
              ? "Consultation not found."
              : payload.error || "Failed to load checkout details."
          );
        }
        const resolvedPatientId = String(payload.consultation.patientId || payload.patient.id || patientId);
        const [invoiceResponse, draftResponse] = await Promise.all([
          fetch(
            `/api/billing?consultationId=${encodeURIComponent(consultationId)}`,
            { cache: "no-store" }
          ),
          fetch(
            `/api/consultations/plan?draftId=${encodeURIComponent(`profile-treatment-${resolvedPatientId}-${consultationId}`)}&patientId=${encodeURIComponent(resolvedPatientId)}&consultationId=${encodeURIComponent(consultationId)}`,
            { cache: "no-store" }
          ),
        ]);
        const invoicePayload = await invoiceResponse.json().catch(() => ({}));
        const draftPayload = await draftResponse.json().catch(() => ({}));

        if (active) {
          setEffectivePatientId(resolvedPatientId);
          setDetails({
            patient: payload.patient,
            consultation: payload.consultation,
            draftEntries: draftResponse.ok && draftPayload?.success
              ? draftPayload.plan?.entries || []
              : [],
          });
          if (invoiceResponse.ok && invoicePayload?.invoiceNumber) {
            setInvoiceNumber(String(invoicePayload.invoiceNumber));
          }
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load checkout details.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadDetails();

    return () => {
      active = false;
    };
  }, [consultationId, patientId]);

  // Read-only stock preview (Task 504). Best effort: checkout works without it.
  useEffect(() => {
    let active = true;
    fetch("/api/inventory", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!active || !Array.isArray(payload?.medications)) return;
        setStockCatalog(
          payload.medications.map((m: { id: string; name: string; strengths?: string[]; stock?: number; unit?: string }) => ({
            id: String(m.id),
            name: String(m.name ?? ""),
            strengths: Array.isArray(m.strengths) ? m.strengths : [],
            stock: Number(m.stock) || 0,
            unit: m.unit,
          }))
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetchOrganizationDetails().then((info) => {
      if (active) setOrganization(info);
    });
    return () => {
      active = false;
    };
  }, []);

  const previewPatient = details?.patient ?? null;
  const previewIssuedDate = details?.consultation?.date ?? null;
  useEffect(() => {
    if (!documentPreviewItem || !previewPatient) {
      setDocumentPreviewHtml(null);
      return;
    }
    let active = true;
    setDocumentPreviewHtml(null);
    setDocumentPreviewLoading(true);
    buildCheckoutDocumentHtml({ item: documentPreviewItem, patient: previewPatient, issuedDate: previewIssuedDate, organization })
      .then((html) => { if (active) setDocumentPreviewHtml(html); })
      .finally(() => { if (active) setDocumentPreviewLoading(false); });
    return () => {
      active = false;
    };
  }, [documentPreviewItem, previewPatient, previewIssuedDate, organization]);

  const checkoutItems = useMemo(
    () => {
      const signedItems = buildCheckoutItems(details?.consultation ?? null);
      return signedItems.length > 0 ? signedItems : buildDraftCheckoutItems(details?.draftEntries || []);
    },
    [details?.consultation, details?.draftEntries]
  );
  const stockByLine = useMemo(() => computeLineStock(checkoutItems, stockCatalog), [checkoutItems, stockCatalog]);
  const lowStockNames = checkoutItems.filter((item) => stockByLine.get(item.id)?.low).map((item) => item.name);
  const stockItemCount = checkoutItems.filter((item) => item.type === "Item" && item.quantity > 0).length;
  const subtotal = checkoutSubtotal(checkoutItems);
  const billable = hasBillableItems(checkoutItems);
  const paid = Number.parseFloat(paidAmount) || 0;
  const balance = subtotal - paid;
  const handleCompleteVisitation = async () => {
    if (!details || completing || balance > 0 || !billable) return;
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    setCompleting(true);
    setCompletionError(null);

    try {
      const response = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consultationId,
          patientId: effectivePatientId,
          items: checkoutItems,
          paymentMethod,
          paidAmount: paid,
          totalAmount: subtotal,
          invoiceNumber: invoiceNumber || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to complete checkout.");
      }

      const notice = buildStockNotice(payload);
      try {
        if (notice) window.sessionStorage.setItem(CHECKOUT_NOTICE_STORAGE_KEY, JSON.stringify(notice));
      } catch {
        // storage unavailable: the invoice is saved either way
      }
      const params = new URLSearchParams({ checkout: "completed" });
      if (payload.invoiceId) params.set("invoiceId", payload.invoiceId);
      if (payload.invoiceNumber) params.set("invoiceNumber", payload.invoiceNumber);
      router.push(`/orders?${params.toString()}`);
    } catch (err) {
      setCompletionError(err instanceof Error ? err.message : "Failed to complete checkout.");
    } finally {
      isSubmittingRef.current = false;
      setCompleting(false);
    }
  };

  if (loading) {
    return (
      <main className="container mx-auto flex min-h-[70vh] items-center justify-center py-8">
        <div className="text-sm text-muted-foreground">Loading checkout...</div>
      </main>
    );
  }

  if (error || !details) {
    return (
      <main className="container mx-auto max-w-3xl py-8">
        <Button asChild variant="ghost" className="mb-4">
          <Link href="/orders">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Billing
          </Link>
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>Checkout unavailable</CardTitle>
            <CardDescription>{error || "The selected consultation could not be loaded."}</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const { patient, consultation } = details;
  const billToName =
    patient.billingPerson === "dependent" && patient.dependentName
      ? patient.dependentName
      : patient.fullName;
  const billDate = formatDisplayDate(consultation.date);
  const canPreviewBill = checkoutItems.length > 0;
  const handlePrintBill = () => {
    if (!canPreviewBill) return;

    const printWindow = window.open("", "_blank", "width=840,height=900");
    if (!printWindow) {
      setCompletionError("Unable to open print preview. Please allow pop-ups for this site.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(
      buildPrintableBillHtml({
        invoiceNumber,
        date: billDate,
        patientName: patient.fullName,
        billToName,
        paymentMethod,
        paid,
        balance,
        total: subtotal,
        items: checkoutItems,
      })
    );
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };
  const handlePrintDocument = () => {
    if (documentPreviewHtml) printHtml(documentPreviewHtml);
  };

  return (
    <main className="w-full space-y-6 px-3 py-8 sm:px-4 lg:px-5 2xl:px-6">
      <div className="flex flex-col gap-4">
        <div className="space-y-3">
          <Button asChild variant="ghost" className="-ml-3 w-fit">
            <Link href="/orders">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Billing
            </Link>
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">Invoice</h1>
              <Badge variant="secondary">Checkout</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {patient.fullName} · {billDate}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_minmax(0,1fr)_340px] 2xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-5 pt-6">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Patient</p>
                <Link href={`/patients/${patient.id}`} className="mt-1 block font-medium text-primary hover:underline">
                  {patient.fullName}
                </Link>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">NRIC / Passport</p>
                  <p className="mt-1 font-medium">{patient.nric || "N/A"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Phone</p>
                  <p className="mt-1 font-medium">{patient.phone || "N/A"}</p>
                </div>
              </div>

              <Separator />

              <div>
                <p className="text-xs font-medium text-muted-foreground">Bill to</p>
                <p className="mt-1 font-medium">{billToName}</p>
                {patient.billingPerson === "dependent" ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {patient.dependentRelationship || "Dependent"} · {patient.dependentPhone || "No phone recorded"}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">Self</p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Address</p>
                <p className="mt-1 text-sm">{patient.address || "No address recorded"}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardContent className="pt-6">
              <div className="mb-4 grid gap-3 rounded-md border bg-muted/20 px-4 py-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Invoice number</p>
                  <p className="mt-1 font-semibold">{displayInvoiceNumber(invoiceNumber)}</p>
                  <p className="text-xs text-muted-foreground">Issued when the invoice is saved.</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-xs font-medium text-muted-foreground">Date</p>
                  <p className="mt-1 font-medium">{billDate}</p>
                </div>
              </div>
              <Tabs defaultValue="all">
                <TabsList className="mb-4 flex w-full overflow-x-auto md:w-fit">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="items">Items</TabsTrigger>
                  <TabsTrigger value="services">Services</TabsTrigger>
                  <TabsTrigger value="packages">Packages</TabsTrigger>
                  <TabsTrigger value="documents">Documents</TabsTrigger>
                </TabsList>
                <TabsContent value="all">
                  <TreatmentRows items={checkoutItems} stockByLine={stockByLine} />
                </TabsContent>
                <TabsContent value="items">
                  <TreatmentRows items={checkoutItems.filter((item) => item.category === "items")} emptyText="No items added." stockByLine={stockByLine} />
                </TabsContent>
                <TabsContent value="services">
                  <TreatmentRows items={checkoutItems.filter((item) => item.category === "services")} emptyText="No services added." />
                </TabsContent>
                <TabsContent value="packages">
                  <TreatmentRows items={checkoutItems.filter((item) => item.category === "packages")} emptyText="No packages added." />
                </TabsContent>
                <TabsContent value="documents">
                  <TreatmentRows
                    items={checkoutItems.filter((item) => item.category === "documents")}
                    emptyText="No chargeable documents added."
                    onPreviewDocument={setDocumentPreviewItem}
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ReceiptText className="h-5 w-5" />
                Totals
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">{currency(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Discount</span>
                <span className="font-medium">{currency(0)}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between text-lg font-semibold">
                <span>Total</span>
                <span>{currency(subtotal)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Patient bill
              </CardTitle>
              <CardDescription>Preview or print the bill before completing visitation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                className="w-full"
                type="button"
                disabled={!canPreviewBill}
                onClick={() => setBillPreviewOpen(true)}
              >
                <Eye className="mr-2 h-4 w-4" />
                Preview bill
              </Button>
              {!canPreviewBill ? (
                <p className="text-xs text-muted-foreground">
                  Add at least one billable item before previewing.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Payments
              </CardTitle>
              <CardDescription>Record the amount collected before completing visitation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="payment-method">Payment method</Label>
                <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}>
                  <SelectTrigger id="payment-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="qr">QR / DuitNow</SelectItem>
                    <SelectItem value="panel">Panel claim</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="paid-amount">Paid amount</Label>
                <Input
                  id="paid-amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={paidAmount}
                  onChange={(event) => setPaidAmount(event.target.value)}
                />
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{balance < 0 ? "Change" : "Balance"}</span>
                  <span className={`font-semibold${balance < 0 ? " text-green-600" : ""}`}>
                    {currency(balance < 0 ? Math.abs(balance) : balance)}
                  </span>
                </div>
              </div>
              {completionError ? (
                <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{completionError}</span>
                </div>
              ) : null}
              <span
                className="block"
                title="e-Invoice submission is not available yet. Complete visitation saves the invoice."
              >
                <Button
                  variant="outline"
                  className="w-full"
                  type="button"
                  disabled
                  aria-describedby="e-invoice-unavailable"
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Submit e-Invoice
                </Button>
              </span>
              <p id="e-invoice-unavailable" className="text-xs text-muted-foreground">
                e-Invoice is not available yet.
              </p>
              {lowStockNames.length > 0 ? (
                <div
                  role="status"
                  data-testid="low-stock-warning"
                  className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Stock is below the billed quantity for {lowStockNames.join(", ")}. You can still complete; stock will go negative.
                  </span>
                </div>
              ) : null}
              <Button
                className="w-full"
                disabled={balance > 0 || completing || !billable}
                onClick={() => setConfirmComplete(true)}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {completing ? "Completing..." : "Complete visitation"}
              </Button>
              {!billable ? (
                <div
                  role="alert"
                  data-testid="no-billable-items-warning"
                  className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{NO_BILLABLE_ITEMS_MESSAGE}</span>
                </div>
              ) : null}
              {billable && balance > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Collect the full total to enable completion.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </div>

      <AlertDialog open={confirmComplete} onOpenChange={setConfirmComplete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete Visitation</AlertDialogTitle>
            <AlertDialogDescription>
              {stockItemCount > 0
                ? `This saves the invoice and deducts stock for ${stockItemCount} item${stockItemCount === 1 ? "" : "s"}.`
                : "This saves the invoice."}{" "}
              Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmComplete(false); void handleCompleteVisitation(); }}>
              Complete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={billPreviewOpen} onOpenChange={setBillPreviewOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Patient bill preview</DialogTitle>
            <DialogDescription>
              {displayInvoiceNumber(invoiceNumber)} · {patient.fullName}
            </DialogDescription>
          </DialogHeader>
          <BillPreview
            invoiceNumber={invoiceNumber}
            date={billDate}
            patientName={patient.fullName}
            billToName={billToName}
            items={checkoutItems}
            subtotal={subtotal}
            paid={paid}
            balance={balance}
            paymentMethod={paymentMethod}
          />
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setBillPreviewOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={handlePrintBill} disabled={!canPreviewBill}>
              <Printer className="mr-2 h-4 w-4" />
              Print bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!documentPreviewItem} onOpenChange={(open) => !open && setDocumentPreviewItem(null)}>
        <DialogContent className="w-[95vw] overflow-hidden p-0 sm:max-w-5xl">
          <div className="flex h-[90dvh] flex-col">
            <DialogHeader className="space-y-2 border-b px-4 py-3 sm:px-6 sm:py-4">
              <DialogTitle>Document preview</DialogTitle>
              <DialogDescription>
                {documentPreviewItem?.documentDetails?.title || documentPreviewItem?.name || "Generated document"} · {patient.fullName}
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 px-6 py-4">
              {documentPreviewLoading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground" role="status">Preparing preview...</span>
                </div>
              ) : documentPreviewHtml ? (
                <iframe
                  srcDoc={documentPreviewHtml}
                  className="h-full w-full rounded-lg border"
                  title="Document preview"
                />
              ) : (
                <EmptyPanel text="This document cannot be previewed from checkout." />
              )}
            </div>

            <DialogFooter className="border-t px-6 py-4">
              <Button variant="outline" type="button" onClick={() => setDocumentPreviewItem(null)}>
                Close
              </Button>
              <Button type="button" onClick={handlePrintDocument} disabled={!documentPreviewHtml}>
                <Printer className="mr-2 h-4 w-4" />
                Print document
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function TreatmentRows({
  items,
  emptyText = "No billable items added.",
  onPreviewDocument,
  stockByLine,
}: {
  items: CheckoutItem[];
  emptyText?: string;
  onPreviewDocument?: (item: CheckoutItem) => void;
  stockByLine?: Map<string, LineStock>;
}) {
  if (items.length === 0) {
    return <EmptyPanel text={emptyText} />;
  }

  const showPreviewColumn = Boolean(onPreviewDocument);

  return (
    <div className="overflow-hidden rounded-md border">
      <div
        className={`grid ${
          showPreviewColumn ? "grid-cols-[1fr_80px_120px_112px]" : "grid-cols-[1fr_80px_120px]"
        } bg-muted/60 px-4 py-2 text-xs font-medium text-muted-foreground`}
      >
        <span>Item</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Amount</span>
        {showPreviewColumn ? <span className="text-right">Preview</span> : null}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          className={`grid ${
            showPreviewColumn ? "grid-cols-[1fr_80px_120px_112px]" : "grid-cols-[1fr_80px_120px]"
          } items-center border-t px-4 py-3 text-sm`}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{item.name}</p>
              <Badge variant="outline">{item.type}</Badge>
            </div>
            {item.description ? (
              <p className="mt-1 truncate text-xs text-muted-foreground">{item.description}</p>
            ) : null}
            <StockHint stock={stockByLine?.get(item.id)} quantity={item.quantity} />
          </div>
          <span className="text-right">{item.quantity}</span>
          <span className="text-right font-medium">{currency(item.quantity * item.price)}</span>
          {showPreviewColumn ? (
            <div className="text-right">
              {item.documentDetails ? (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => onPreviewDocument?.(item)}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Preview
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function BillPreview({
  invoiceNumber,
  date,
  patientName,
  billToName,
  items,
  subtotal,
  paid,
  balance,
  paymentMethod,
}: {
  invoiceNumber: string;
  date: string;
  patientName: string;
  billToName: string;
  items: CheckoutItem[];
  subtotal: number;
  paid: number;
  balance: number;
  paymentMethod: PaymentMethod;
}) {
  return (
    <div className="rounded-md border bg-white p-6 text-sm text-slate-950 shadow-sm">
      <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-normal">Patient Bill</h2>
          <p className="mt-1 text-slate-500">Clinic checkout invoice</p>
        </div>
        <div className="text-left sm:text-right">
          <p className="font-semibold">{displayInvoiceNumber(invoiceNumber)}</p>
          <p className="mt-1 text-slate-500">{date}</p>
        </div>
      </div>

      <div className="grid gap-4 py-5 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase text-slate-500">Patient</p>
          <p className="mt-1 font-semibold">{patientName}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-slate-500">Bill to</p>
          <p className="mt-1 font-semibold">{billToName}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        <div className="grid grid-cols-[1fr_56px_96px] bg-slate-50 px-3 py-2 text-xs font-medium uppercase text-slate-500 sm:grid-cols-[1fr_64px_110px_110px]">
          <span>Item</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Unit</span>
          <span className="hidden text-right sm:block">Amount</span>
        </div>
        {items.map((item) => (
          <div
            key={item.id}
            className="grid grid-cols-[1fr_56px_96px] items-start border-t px-3 py-3 sm:grid-cols-[1fr_64px_110px_110px]"
          >
            <div className="min-w-0">
              <p className="font-medium">{item.name}</p>
              {item.description ? (
                <p className="mt-1 text-xs text-slate-500">{item.description}</p>
              ) : null}
              <p className="mt-1 text-xs font-medium sm:hidden">{currency(item.quantity * item.price)}</p>
            </div>
            <span className="text-right">{item.quantity}</span>
            <span className="text-right">{currency(item.price)}</span>
            <span className="hidden text-right font-medium sm:block">{currency(item.quantity * item.price)}</span>
          </div>
        ))}
      </div>

      <div className="ml-auto mt-5 w-full max-w-xs space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Subtotal</span>
          <span className="font-medium">{currency(subtotal)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Paid ({paymentMethod.toUpperCase()})</span>
          <span className="font-medium">{currency(paid)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">{balance < 0 ? "Change" : "Balance"}</span>
          <span className="font-medium">{currency(balance < 0 ? Math.abs(balance) : balance)}</span>
        </div>
        <div className="flex items-center justify-between border-t pt-2 text-base font-semibold">
          <span>Total</span>
          <span>{currency(subtotal)}</span>
        </div>
      </div>

      <p className="mt-6 border-t pt-4 text-center text-xs text-slate-500">Thank you.</p>
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function StockHint({ stock, quantity }: { stock?: LineStock; quantity: number }) {
  if (!stock) return null;
  if (stock.match !== "matched") {
    return (
      <p className="mt-1 text-xs text-amber-700" data-testid="stock-hint">
        {stock.match === "ambiguous"
          ? "Matches several stock items: stock will not be deducted."
          : "Not in inventory: stock will not be deducted."}
      </p>
    );
  }
  const unit = stock.unit || "units";
  return (
    <p
      className={`mt-1 text-xs ${stock.low ? "font-medium text-amber-700" : "text-muted-foreground"}`}
      data-testid="stock-hint"
    >
      {quantity} {unit} · stock {stock.onHand}
      {stock.low ? ` (below billed ${stock.needed})` : ""}
    </p>
  );
}
