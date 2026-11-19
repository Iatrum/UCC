"use client";

import { fillDocumentTemplate, mcDiagnosisVisible, signedDocumentKind as kindFromProcedure, SIGNED_DOCUMENT_STATUS_VOIDED } from "@/lib/clinical-documents";
import { calcAge, clinicLogoHtml, multilineToHtml, renderDocumentHtml, withPrintCss } from "@/lib/document-render";
import { formatClinicDate, mcDaysLabel } from "@/lib/clinic-dates";
import { printHtml } from "@/lib/print-html";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { describeFetchError } from "@/lib/load-state";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Download, FileText, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { getPatientReferrals, deleteReferral, type Referral } from "@/lib/fhir/referral-client";
import { fetchOrganizationDetails, resolveOrganizationDetails, type OrganizationDetails } from "@/lib/org";
import { DEFAULT_TIME_CHIT_TEMPLATE, DEFAULT_MC_TEMPLATE, DEFAULT_REFERRAL_TEMPLATE } from "@/lib/document-templates";
import type { ProcedureRecord } from "@/lib/models";

const formatDateLabel = (value: Date | string | null | undefined): string | null => formatClinicDate(value) || null;

interface ReferralMCSectionProps {
  patient: any;
  consultations?: Array<{
    id?: string;
    date?: string | Date | null;
    procedures?: ProcedureRecord[];
  }>;
}

type SignedDocument = {
  id: string;
  kind: "mc" | "referral" | "time-chit";
  title: string;
  date: string | Date | null | undefined;
  status?: string;
  details: Record<string, string>;
  consultationId: string;
  procedureIndex: number;
  procedure: ProcedureRecord;
};

function parseSignedDocumentNote(value?: string): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, string>;
    }
  } catch {
    return {};
  }
  return {};
}

function signedDocumentKind(procedure: ProcedureRecord): "mc" | "referral" | "time-chit" | null {
  return kindFromProcedure(procedure);
}

function getSignedDocuments(consultations: ReferralMCSectionProps["consultations"] = []): SignedDocument[] {
  return consultations.flatMap((consultation) =>
    (consultation.procedures || []).flatMap((procedure, index): SignedDocument[] => {
      if (procedure.category !== "documents") return [];

      const details = parseSignedDocumentNote(procedure.notes);
      const kind = signedDocumentKind(procedure);
      if (!kind) return [];

      return [
        {
          id: `${consultation.id || "consultation"}-${procedure.procedureId || procedure.name}-${index}`,
          kind,
          title:
            details.title ||
            procedure.name ||
            (kind === "time-chit" ? "Time Chit" : kind === "mc" ? "Medical Certificate (MC)" : "Referral Letter"),
          date: consultation.date,
          status: details.status || undefined,
          details,
          consultationId: consultation.id || "",
          procedureIndex: index,
          procedure,
        },
      ];
    })
  );
}

const TEMPLATE_FETCH_TIMEOUT_MS = 15_000;

export default function ReferralMCSection({ patient, consultations = [] }: ReferralMCSectionProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Referral | null>(null);
  const [viewingSigned, setViewingSigned] = useState<SignedDocument | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    { type: "signed"; doc: SignedDocument } | { type: "referral"; referral: Referral } | null
  >(null);
  const [organization, setOrganization] = useState<OrganizationDetails | null>(null);
  const [viewingHtml, setViewingHtml] = useState<string | null>(null);
  const [viewingHtmlLoading, setViewingHtmlLoading] = useState(false);
  // Task 686: a stalled/failed template load shows an inline error + Retry instead of a blank dialog.
  const [viewingHtmlError, setViewingHtmlError] = useState<string | null>(null);
  const signedDocuments = getSignedDocuments(consultations);

  const loadReferrals = useCallback(() => {
    let active = true;
    (async () => {
      try {
        setLoadError(null);
        const list = await getPatientReferrals(patient.id);
        if (!active) return;
        setReferrals(list as any);
      } catch (error) {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Failed to load documents.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [patient.id]);

  useEffect(() => loadReferrals(), [loadReferrals]);

  useEffect(() => {
    let active = true;
    (async () => {
      const orgDetails = await fetchOrganizationDetails();
      if (!active) return;
      setOrganization(orgDetails);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleDelete(referralId: string) {
    setDeleting(referralId);
    try {
      await deleteReferral(referralId);
      setReferrals((prev) => prev.filter((r) => r.id !== referralId));
      toast({ title: "Document deleted" });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.message || "Failed to delete document.",
        variant: "destructive",
      });
    } finally {
      setDeleting(null);
    }
  }

  async function updateSignedDocumentProcedures(doc: SignedDocument, procedures: ProcedureRecord[]) {
    if (!doc.consultationId) {
      throw new Error("This generated document is missing its consultation reference.");
    }

    const response = await fetch("/api/consultations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consultationId: doc.consultationId, procedures }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || payload?.message || "Failed to update generated document.");
    }
  }

  function getConsultationProcedures(doc: SignedDocument) {
    const consultation = consultations.find((item) => item.id === doc.consultationId);
    return consultation?.procedures || [];
  }

  /**
   * Signed documents are legal records: they are voided (record kept, marked VOID)
   * and reissued from a consult, never edited or deleted. The server enforces this.
   */
  async function handleVoidSignedDocument(doc: SignedDocument, reason: string) {
    const currentProcedures = getConsultationProcedures(doc);
    if (!currentProcedures[doc.procedureIndex]) {
      toast({
        title: "Document not found",
        description: "Refresh the page and try again.",
        variant: "destructive",
      });
      return;
    }

    setDeleting(doc.id);
    try {
      const voided: ProcedureRecord = {
        ...doc.procedure,
        notes: JSON.stringify({
          ...doc.details,
          status: SIGNED_DOCUMENT_STATUS_VOIDED,
          voidedAt: new Date().toISOString(),
          ...(reason.trim() ? { voidReason: reason.trim() } : {}),
        }),
      };
      const nextProcedures = currentProcedures.map((procedure, index) =>
        index === doc.procedureIndex ? voided : procedure
      );
      await updateSignedDocumentProcedures(doc, nextProcedures);
      if (viewingSigned?.id === doc.id) setViewingSigned(null);
      toast({ title: "Document voided", description: "Issue a new one from a consult if it is still needed." });
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.message || "Failed to void generated document.",
        variant: "destructive",
      });
    } finally {
      setDeleting(null);
    }
  }

  async function buildDocumentHtml(doc: SignedDocument): Promise<string> {
    const res = await fetchWithTimeout(`/api/document-templates?type=${doc.kind}`, {}, TEMPLATE_FETCH_TIMEOUT_MS);
    let html: string;
    if (res.ok) {
      html = (await res.json()).html;
    } else {
      const body = await res.json().catch(() => null);
      console.warn("Template fetch failed:", body?.error ?? `HTTP ${res.status}`, "— using default");
      html = doc.kind === "time-chit" ? DEFAULT_TIME_CHIT_TEMPLATE : doc.kind === "mc" ? DEFAULT_MC_TEMPLATE : DEFAULT_REFERRAL_TEMPLATE;
    }
    // doc.date is the consultation (issue) date: a reprint never shows today's date.
    return renderDocumentHtml({
      kind: doc.kind,
      template: html,
      details: doc.details,
      patient,
      organization: await resolveOrganizationDetails(organization),
      issuedDate: doc.date,
    });
  }

  async function buildLegacyReferralHtml(r: Referral): Promise<string> {
    const res = await fetchWithTimeout("/api/document-templates?type=referral", {}, TEMPLATE_FETCH_TIMEOUT_MS);
    let html: string;
    if (res.ok) {
      html = (await res.json()).html;
    } else {
      const body = await res.json().catch(() => null);
      console.warn("Template fetch failed:", body?.error ?? `HTTP ${res.status}`, "— using default");
      html = DEFAULT_REFERRAL_TEMPLATE;
    }
    const org = await resolveOrganizationDetails(organization);
    const toLine = [r.department, r.facility].filter(Boolean).join(", ") || "";
    return withPrintCss(fillDocumentTemplate(html, {
      clinicLogo: clinicLogoHtml(org?.logoUrl),
      clinicName: org?.name || "",
      clinicAddress: org?.address || "",
      clinicPhone: org?.phone || "",
      patientName: patient.fullName || "",
      patientNric: patient.nric || "",
      patientAge: calcAge(patient.dateOfBirth),
      referralTo: toLine,
      referralFrom: r.doctorName || org?.name || "",
      referralBody: multilineToHtml((r as any).letterText || ""),
      diagnosis: r.specialty || "",
      doctorName: r.doctorName || "",
      mmcLine: "",
      date: formatClinicDate(r.date) || formatClinicDate(new Date()),
    }, { rawKeys: ["clinicLogo", "referralBody", "mmcLine"] }));
  }

  async function openSignedDocumentViewer(doc: SignedDocument) {
    setViewingSigned(doc);
    setViewingHtml(null);
    setViewingHtmlError(null);
    setViewingHtmlLoading(true);
    try {
      const html = await buildDocumentHtml(doc);
      setViewingHtml(html);
    } catch (err: any) {
      setViewingHtmlError(describeFetchError(err, "Could not load document preview."));
      toast({
        title: "Preview failed",
        description: err?.message || "Could not load document preview.",
        variant: "destructive",
      });
    } finally {
      setViewingHtmlLoading(false);
    }
  }

  async function openLegacyReferralViewer(r: Referral) {
    setViewing(r);
    setViewingHtml(null);
    setViewingHtmlError(null);
    setViewingHtmlLoading(true);
    try {
      const html = await buildLegacyReferralHtml(r);
      setViewingHtml(html);
    } catch (err: any) {
      setViewingHtmlError(describeFetchError(err, "Could not load document preview."));
      toast({
        title: "Preview failed",
        description: err?.message || "Could not load document preview.",
        variant: "destructive",
      });
    } finally {
      setViewingHtmlLoading(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Generated Documents</CardTitle>
          <CardDescription>Saved MCs, time chits and referral letters.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!loading && loadError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm font-medium text-destructive">Could not load generated documents.</p>
              <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => loadReferrals()}
              >
                Retry
              </Button>
            </div>
          )}
          {!loading && !loadError && referrals.length === 0 && signedDocuments.length === 0 && (
            <div className="rounded-lg border border-dashed p-4">
              <p className="text-sm font-medium">No generated documents yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Signed MCs, time chits and referral letters will appear here after a consult is completed.
              </p>
            </div>
          )}
          {signedDocuments.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/40"
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-4 text-left"
                onClick={() => openSignedDocumentViewer(doc)}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium">
                    {doc.kind === "time-chit" ? "Time Chit" : doc.kind === "mc" ? "Medical Certificate (MC)" : "Referral Letter"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[
                      doc.kind === "time-chit" ? `${doc.details.tcTimeIn}–${doc.details.tcTimeOut} (${doc.details.tcHours} hour(s))` : doc.kind === "mc"
                        ? [
                            [
                              doc.details.mcStartDate ? formatDateLabel(doc.details.mcStartDate) : null,
                              doc.details.mcDays ? `(${mcDaysLabel(doc.details.mcDays)})` : null,
                            ]
                              .filter(Boolean)
                              .join(" "),
                            // Never list a diagnosis the printed MC hides.
                            mcDiagnosisVisible(doc.details) ? doc.details.mcDiagnosis : null,
                          ]
                            .filter(Boolean)
                            .join(" • ")
                        : [doc.details.referralTo, doc.details.referralDiagnosis]
                            .filter(Boolean)
                            .join(" • "),
                      [
                        doc.date ? `Issued ${formatDateLabel(doc.date)}` : null,
                        doc.status ? (doc.status === "completed" ? "Signed" : doc.status === SIGNED_DOCUMENT_STATUS_VOIDED ? "Voided" : doc.status) : null,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                    ]
                      .filter(Boolean)
                      .join(" — ")}
                  </p>
                </div>
              </button>
              <div className="flex items-center gap-2">
                {doc.status !== SIGNED_DOCUMENT_STATUS_VOIDED && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleting === doc.id}
                    aria-label="Void document"
                    onClick={() => { setVoidReason(""); setPendingDelete({ type: "signed", doc }); }}
                  >
                    {deleting === doc.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Ban className="h-4 w-4 text-destructive" />
                    )}
                    <span className="sr-only">Void document</span>
                  </Button>
                )}
              </div>
            </div>
          ))}
          {referrals.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/40"
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-4 text-left"
                onClick={() => openLegacyReferralViewer(r)}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium">{r.specialty} Referral</p>
                  <p className="text-sm text-muted-foreground">
                    {[r.facility, r.department].filter(Boolean).join(" • ")}
                    {r.date ? ` — ${formatClinicDate(r.date)}` : ""}
                  </p>
                </div>
              </button>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleting === r.id}
                  aria-label={`Delete ${r.specialty} referral`}
                  onClick={() => setPendingDelete({ type: "referral", referral: r })}
                >
                  {deleting === r.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 text-destructive" />
                  )}
                </Button>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" />
              {signedDocuments.length > 0 ? "Checking for older referral letters…" : "Loading documents…"}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingDelete?.type === "signed" ? "Void this document?" : "Delete this document?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.type === "signed"
                ? `Void this signed ${
                    pendingDelete.doc.kind === "mc" ? "MC" : pendingDelete.doc.kind === "time-chit" ? "time chit" : "referral letter"
                  } for ${patient.fullName}? It stays on record marked VOID and cannot be printed. Issue a new one from a consult to replace it.`
                : `Delete this referral letter for ${patient.fullName}? This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingDelete?.type === "signed" && (
            <div className="grid gap-2">
              <Label htmlFor="void-reason">Reason (optional)</Label>
              <Input id="void-reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const target = pendingDelete;
                setPendingDelete(null);
                if (target?.type === "signed") void handleVoidSignedDocument(target.doc, voidReason);
                else if (target) void handleDelete(target.referral.id);
              }}
            >
              {pendingDelete?.type === "signed" ? "Void" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* View signed document — HTML template iframe */}
      <Dialog
        open={!!viewingSigned}
        onOpenChange={(open) => {
          if (!open) {
            setViewingSigned(null);
            setViewingHtml(null);
          }
        }}
      >
        <DialogContent className="w-[95vw] overflow-hidden p-0 sm:max-w-5xl">
          <div className="flex h-[90dvh] flex-col">
            <DialogHeader className="space-y-2 border-b px-4 py-3 sm:px-6 sm:py-4">
              <DialogTitle>
                {viewingSigned?.kind === "time-chit" ? "Time Chit" : viewingSigned?.kind === "mc" ? "Medical Certificate (MC)" : "Referral Letter"}
              </DialogTitle>
              <DialogDescription>
                {viewingSigned ? formatDateLabel(viewingSigned.date) : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 px-2 py-2 sm:px-6 sm:py-4">
              {viewingHtmlLoading && (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground" role="status">Preparing preview...</span>
                </div>
              )}
              {!viewingHtmlLoading && !viewingHtml && viewingHtmlError && (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center" role="alert">
                  <p className="text-sm text-destructive">{viewingHtmlError}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => viewingSigned && void openSignedDocumentViewer(viewingSigned)}>Retry</Button>
                </div>
              )}
              {!viewingHtmlLoading && viewingHtml && (
                <iframe
                  srcDoc={viewingHtml}
                  className="h-full w-full rounded-lg border"
                  title="Document preview"
                />
              )}
            </div>

            <div className="flex justify-end gap-2 border-t px-4 py-3 sm:px-6 sm:py-4">
              <Button
                variant="outline"
                onClick={() => {
                  setViewingSigned(null);
                  setViewingHtml(null);
                }}
              >
                Close
              </Button>
              <Button
                disabled={!viewingHtml || viewingSigned?.status === SIGNED_DOCUMENT_STATUS_VOIDED}
                onClick={() => viewingHtml && printHtml(viewingHtml)}
              >
                <Download className="mr-2 h-4 w-4" /> Print / Save PDF
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* View legacy FHIR referral — HTML template iframe */}
      <Dialog
        open={!!viewing}
        onOpenChange={(open) => {
          if (!open) {
            setViewing(null);
            setViewingHtml(null);
          }
        }}
      >
        <DialogContent className="w-[95vw] overflow-hidden p-0 sm:max-w-5xl">
          <div className="flex h-[90dvh] flex-col">
            <DialogHeader className="space-y-2 border-b px-4 py-3 sm:px-6 sm:py-4">
              <DialogTitle>Referral Letter</DialogTitle>
              <DialogDescription>
                {viewing ? `${viewing.specialty} — ${viewing.facility}` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 px-2 py-2 sm:px-6 sm:py-4">
              {viewingHtmlLoading && (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground" role="status">Preparing preview...</span>
                </div>
              )}
              {!viewingHtmlLoading && !viewingHtml && viewingHtmlError && (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center" role="alert">
                  <p className="text-sm text-destructive">{viewingHtmlError}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => viewing && void openLegacyReferralViewer(viewing)}>Retry</Button>
                </div>
              )}
              {!viewingHtmlLoading && viewingHtml && (
                <iframe
                  srcDoc={viewingHtml}
                  className="h-full w-full rounded-lg border"
                  title="Document preview"
                />
              )}
            </div>

            <div className="flex justify-end gap-2 border-t px-4 py-3 sm:px-6 sm:py-4">
              <Button
                variant="outline"
                onClick={() => {
                  setViewing(null);
                  setViewingHtml(null);
                }}
              >
                Close
              </Button>
              <Button
                disabled={!viewingHtml}
                onClick={() => viewingHtml && printHtml(viewingHtml)}
              >
                <Download className="mr-2 h-4 w-4" /> Print / Save PDF
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
