"use client";

import { Fragment, FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { useToast } from "@/components/ui/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OrderComposer } from "@/components/orders/order-composer";
import PatientDocuments from "@/components/patients/patient-documents";
import { LabResultsView } from "@/components/labs/lab-results-view";
import { ImagingResultsView } from "@/components/imaging/imaging-results-view";
import { getMedications } from "@/lib/inventory";
import { getProcedures } from "@/lib/procedures";
import { LAB_TESTS, type LabTestCode } from "@/lib/fhir/lab-constants";
import { IMAGING_PROCEDURES, type ImagingProcedureCode } from "@/lib/fhir/imaging-service";
import { cn, formatDisplayDate } from "@/lib/utils";
import type { Prescription, ProcedureRecord } from "@/lib/models";
import type { SerializedPatient } from "@/components/patients/patient-card";
import type { TreatmentPlanEntry, TreatmentPlanSummary } from "@/lib/treatment-plan";
import ReferralMCSection from "./referral-mc-section";

type ProfileTab = "history" | "labs-imaging" | "referral-mc" | "documents";
type DrawerMode = "consult" | "treatment";

type MedicalHistory = {
  allergies?: string[];
  conditions?: string[];
  medications?: string[];
};

type ProfileConsultation = {
  id?: string;
  patientId: string;
  date?: string | null;
  chiefComplaint: string;
  diagnosis: string;
  notes?: string;
  progressNote?: string | null;
  procedures?: ProcedureRecord[];
  prescriptions?: Prescription[];
};

interface PatientProfileWorkspaceProps {
  patientId: string;
  patient: SerializedPatient;
  consultations: ProfileConsultation[];
  patientAge: number | null;
  medicalHistory: MedicalHistory;
}

const emptyTreatmentSummary: TreatmentPlanSummary = {
  subtotal: 0,
  total: 0,
  currency: "MYR",
  itemCount: 0,
};
const emptyTreatmentEntries: TreatmentPlanEntry[] = [];
const emptyPackages: [] = [];

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "").trim();
}

function consultationVisitKey(consultation: ProfileConsultation): string {
  const dateKey = consultation.date ? consultation.date.slice(0, 10) : "";
  return [
    dateKey,
    stripHtml(consultation.chiefComplaint).toLowerCase(),
    consultation.diagnosis.trim().toLowerCase(),
  ].join("|");
}

function mergeByVisit(consultations: ProfileConsultation[]): ProfileConsultation[] {
  const visits = new Map<string, ProfileConsultation>();

  for (const consultation of consultations) {
    const key = consultationVisitKey(consultation);
    const existing = visits.get(key);

    if (!existing) {
      visits.set(key, {
        ...consultation,
        procedures: [...(consultation.procedures || [])],
        prescriptions: [...(consultation.prescriptions || [])],
      });
      continue;
    }

    existing.procedures = [...(existing.procedures || []), ...(consultation.procedures || [])];
    existing.prescriptions = [...(existing.prescriptions || []), ...(consultation.prescriptions || [])];
    existing.notes = existing.notes || consultation.notes;
    existing.progressNote = existing.progressNote || consultation.progressNote;
  }

  return Array.from(visits.values());
}

function prescriptionDetails(prescription: Prescription): string {
  return [
    prescription.medication?.strength,
    prescription.frequency,
    prescription.duration,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function PatientProfileWorkspace({
  patientId,
  patient,
  consultations,
  patientAge,
  medicalHistory,
}: PatientProfileWorkspaceProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<ProfileTab>("history");
  const [drawerMode, setDrawerMode] = useState<DrawerMode>("consult");
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedConsultation, setSelectedConsultation] = useState<ProfileConsultation | null>(null);
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [consultSubmitting, setConsultSubmitting] = useState(false);
  const [treatmentSubmitting, setTreatmentSubmitting] = useState(false);
  const [treatmentEntries, setTreatmentEntries] = useState<TreatmentPlanEntry[]>([]);
  const [treatmentSummary, setTreatmentSummary] = useState<TreatmentPlanSummary>(emptyTreatmentSummary);
  const [procedureOptions, setProcedureOptions] = useState<
    { id: string; label: string; price?: number; codingSystem?: string; codingCode?: string; codingDisplay?: string }[]
  >([]);
  const [medicationOptions, setMedicationOptions] = useState<{ id: string; name: string; unitPrice: number }[]>([]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const [procedures, medications] = await Promise.all([getProcedures(), getMedications()]);
        if (!active) return;
        setProcedureOptions(
          procedures.map((procedure) => ({
            id: procedure.id,
            label: procedure.name,
            price: procedure.defaultPrice,
            codingSystem: procedure.codingSystem,
            codingCode: procedure.codingCode,
            codingDisplay: procedure.codingDisplay,
          }))
        );
        setMedicationOptions(
          medications.map((medication) => ({
            id: medication.id,
            name: medication.name,
            unitPrice: medication.unitPrice || 0,
          }))
        );
      } catch (error) {
        console.error("Failed to load treatment catalogs:", error);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const visibleConsultations = useMemo(() => mergeByVisit(consultations), [consultations]);

  const latestConsultation = useMemo(() => {
    return [...visibleConsultations]
      .filter((consultation) => consultation.chiefComplaint && consultation.diagnosis)
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())[0];
  }, [visibleConsultations]);

  const treatmentItemsCatalog = useMemo(
    () =>
      medicationOptions.map((item) => ({
        id: item.id,
        name: item.name,
        unitPrice: item.unitPrice,
      })),
    [medicationOptions]
  );

  const treatmentServicesCatalog = useMemo(
    () =>
      procedureOptions.map((item) => ({
        id: item.id,
        name: item.label,
        unitPrice: item.price || 0,
      })),
    [procedureOptions]
  );

  const treatmentDocumentsCatalog = useMemo(
    () => [
      {
        id: "letter-mc",
        name: "Medical certificate (MC)",
        unitPrice: 0,
        meta: { kind: "mc" },
      },
      {
        id: "letter-referral",
        name: "Referral letter",
        unitPrice: 0,
        meta: { kind: "referral" },
      },
      ...Object.entries(LAB_TESTS).map(([code, meta]) => ({
        id: `lab-${code}`,
        name: `Lab: ${meta.display}`,
        unitPrice: 0,
        meta: { kind: "lab", code },
      })),
      ...Object.entries(IMAGING_PROCEDURES)
        .filter(([, meta]) => meta.modality === "DX")
        .map(([code, meta]) => ({
          id: `imaging-${code}`,
          name: `Imaging: ${meta.display} (${meta.modality})`,
          unitPrice: 0,
          meta: { kind: "imaging", code },
        })),
    ],
    []
  );

  const handleTreatmentPlanChange = useCallback((entries: TreatmentPlanEntry[], summary: TreatmentPlanSummary) => {
    setTreatmentEntries(entries);
    setTreatmentSummary(summary);
  }, []);

  function handleTabChange(value: string) {
    setActiveTab(value as ProfileTab);
  }

  async function handleConsultSign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (consultSubmitting) return;

    if (!stripHtml(clinicalNotes) || !diagnosis.trim()) {
      toast({
        title: "Validation Error",
        description: "Please fill in clinical notes and diagnosis before signing.",
        variant: "destructive",
      });
      return;
    }

    try {
      setConsultSubmitting(true);
      const response = await fetch("/api/consultations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          chiefComplaint: clinicalNotes,
          diagnosis: diagnosis.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to save consultation");
      }

      toast({
        title: "Consult Signed",
        description: "Clinical notes and diagnosis were saved.",
      });
      setClinicalNotes("");
      setDiagnosis("");
      setPanelOpen(false);
      router.refresh();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save consultation.",
        variant: "destructive",
      });
    } finally {
      setConsultSubmitting(false);
    }
  }

  async function handleTreatmentSign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (treatmentSubmitting) return;

    if (!latestConsultation) {
      toast({
        title: "Consult Required",
        description: "Please sign a consult before signing treatment.",
        variant: "destructive",
      });
      return;
    }

    if (!latestConsultation.id) {
      toast({
        title: "Consult Missing ID",
        description: "Refresh the patient profile and try signing treatment again.",
        variant: "destructive",
      });
      return;
    }

    if (treatmentEntries.length === 0) {
      toast({
        title: "No Treatment Added",
        description: "Add at least one treatment item before signing.",
        variant: "destructive",
      });
      return;
    }

    const medicationEntries = treatmentEntries.filter((entry) => entry.tab === "items");
    const serviceEntries = treatmentEntries.filter((entry) => entry.tab === "services" || entry.tab === "packages");
    const documentEntries = treatmentEntries.filter((entry) => entry.tab === "documents");
    const prescriptions: Prescription[] = medicationEntries.map((entry) => ({
      medication: {
        id: entry.catalogRef || entry.id,
        name: entry.name,
        strength: entry.dosage,
      },
      frequency: entry.frequency || "",
      duration: entry.duration || "",
      quantity: entry.quantity,
      price: entry.unitPrice,
    }));
    const procedures: ProcedureRecord[] = serviceEntries.map((entry) => ({
      name: entry.name,
      quantity: entry.quantity,
      price: entry.unitPrice,
      notes: entry.instruction,
      procedureId: entry.catalogRef,
    }));
    const labSelections = documentEntries
      .filter((entry) => entry.meta?.kind === "lab")
      .map((entry) => entry.meta?.code as LabTestCode)
      .filter(Boolean);
    const imagingSelections = documentEntries
      .filter((entry) => entry.meta?.kind === "imaging")
      .map((entry) => entry.meta?.code as ImagingProcedureCode)
      .filter(Boolean);

    try {
      setTreatmentSubmitting(true);
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consultationId: latestConsultation.id,
          procedures,
          prescriptions,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to save treatment");
      }

      const consultationId = latestConsultation.id;
      const orderErrors: string[] = [];
      if (labSelections.length) {
        try {
          const labResponse = await fetch("/api/labs/order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              patientId,
              encounterId: consultationId,
              tests: labSelections,
              priority: "routine",
              clinicalNotes: latestConsultation.chiefComplaint,
            }),
          });
          if (!labResponse.ok) {
            const labData = await labResponse.json().catch(() => ({}));
            throw new Error(labData?.error || "Lab order failed");
          }
        } catch (error) {
          console.error("Lab order error:", error);
          orderErrors.push("labs");
        }
      }

      if (imagingSelections.length) {
        try {
          const imagingResponse = await fetch("/api/imaging/order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              patientId,
              encounterId: consultationId,
              procedures: imagingSelections,
              priority: "routine",
              clinicalIndication: latestConsultation.diagnosis || latestConsultation.chiefComplaint,
              clinicalQuestion: latestConsultation.chiefComplaint,
              orderedBy: undefined,
            }),
          });
          if (!imagingResponse.ok) {
            const imagingData = await imagingResponse.json().catch(() => ({}));
            throw new Error(imagingData?.error || "Imaging order failed");
          }
        } catch (error) {
          console.error("Imaging order error:", error);
          orderErrors.push("imaging");
        }
      }

      toast({
        title: "Treatment Signed",
        description: orderErrors.length
          ? `Treatment saved. Orders with issues: ${orderErrors.join(", ")}.`
          : "Treatment visit was saved.",
        variant: orderErrors.length ? "destructive" : "default",
      });
      setPanelOpen(false);
      router.refresh();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save treatment.",
        variant: "destructive",
      });
    } finally {
      setTreatmentSubmitting(false);
    }
  }

  return (
    <>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col gap-3">
        <TabsList className="w-auto">
          <TabsTrigger value="history" className="px-3 text-xs">Consultation History</TabsTrigger>
          <TabsTrigger value="labs-imaging" className="px-3 text-xs">Labs & Imaging</TabsTrigger>
          <TabsTrigger value="referral-mc" className="px-3 text-xs">Referral / MC</TabsTrigger>
          <TabsTrigger value="documents" className="px-3 text-xs">Documents</TabsTrigger>
        </TabsList>

        {/* Content row: main tab content + action panel side by side */}
        <div className="flex min-w-0 items-start gap-4">
          <div className="min-w-0 flex-1">
            <TabsContent value="history" className="mt-0">
              <div className="flex justify-end mb-3">
                <Tabs value={panelOpen ? drawerMode : ""}>
                  <TabsList>
                    <TabsTrigger
                      value="consult"
                      className="px-3 text-xs"
                      onClick={() => {
                        if (drawerMode === "consult" && panelOpen) setPanelOpen(false);
                        else { setDrawerMode("consult"); setPanelOpen(true); }
                      }}
                    >Consult</TabsTrigger>
                    <TabsTrigger
                      value="treatment"
                      className="px-3 text-xs"
                      onClick={() => {
                        if (drawerMode === "treatment" && panelOpen) setPanelOpen(false);
                        else { setDrawerMode("treatment"); setPanelOpen(true); }
                      }}
                    >Treatment</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <Card>
                <CardContent>
                  {visibleConsultations.length > 0 ? (
                    <>
                      <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Complaint</TableHead>
                          <TableHead>Diagnosis</TableHead>
                          <TableHead>Prescriptions</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleConsultations.map((consultation) => (
                          <Fragment key={consultation.id}>
                            <TableRow
                              data-selected={selectedConsultation?.id === consultation.id ? true : undefined}
                              aria-selected={selectedConsultation?.id === consultation.id}
                              className={cn(
                                "cursor-pointer",
                                selectedConsultation?.id === consultation.id && "bg-muted/50"
                              )}
                              onClick={() => {
                                setSelectedConsultation((current) =>
                                  current?.id === consultation.id ? null : consultation
                                );
                              }}
                            >
                              <TableCell className="font-medium">{formatDisplayDate(consultation.date)}</TableCell>
                              <TableCell>Consultation</TableCell>
                              <TableCell className="max-w-[200px] truncate">{consultation.chiefComplaint?.replace(/<[^>]*>/g, "") || "—"}</TableCell>
                              <TableCell className="max-w-[200px] truncate">{consultation.diagnosis}</TableCell>
                              <TableCell>{consultation.prescriptions?.length || 0} items</TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                  <Button variant="outline" size="sm" asChild>
                                    <Link href={`/consultations/${consultation.id}`}>View</Link>
                                  </Button>
                                  <Button size="sm" asChild>
                                    <Link href={`/consultations/${consultation.id}/edit`}>Edit</Link>
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                            {selectedConsultation?.id === consultation.id && (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={6} className="bg-muted/30 px-6 pb-5 pt-3">
                                  <div className="space-y-4">
                                    <div>
                                      <p className="mb-1 text-sm font-medium">Clinical Notes</p>
                                      <div className="rich-text-display text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: consultation.chiefComplaint }} />
                                    </div>
                                    <div>
                                      <p className="mb-1 text-sm font-medium">Diagnosis</p>
                                      <p className="text-sm text-muted-foreground">{consultation.diagnosis || "—"}</p>
                                    </div>
                                    {consultation.notes && (
                                      <div>
                                        <p className="mb-1 text-sm font-medium">Notes</p>
                                        <div className="rich-text-display text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: consultation.notes }} />
                                      </div>
                                    )}
                                    {consultation.progressNote && (
                                      <div>
                                        <p className="mb-1 text-sm font-medium">Progress Note</p>
                                        <div className="rich-text-display text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: consultation.progressNote }} />
                                      </div>
                                    )}
                                    {consultation.prescriptions && consultation.prescriptions.length > 0 && (
                                      <div>
                                        <p className="mb-2 text-sm font-medium">Prescriptions</p>
                                        <ul className="space-y-1">
                                          {consultation.prescriptions.map((rx, i) => (
                                            <li key={i} className="text-sm text-muted-foreground">
                                              {rx.medication?.name}
                                              {prescriptionDetails(rx) ? ` — ${prescriptionDetails(rx)}` : ""}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {consultation.procedures && consultation.procedures.length > 0 && (
                                      <div>
                                        <p className="mb-2 text-sm font-medium">Procedures</p>
                                        <ul className="space-y-1">
                                          {consultation.procedures.map((proc, i) => (
                                            <li key={i} className="text-sm text-muted-foreground">
                                              {proc.name}
                                              {proc.notes ? ` — ${proc.notes}` : ""}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {consultation.id && (
                                      <div className="flex flex-wrap gap-2 border-t pt-3">
                                        <Button variant="outline" size="sm" asChild>
                                          <Link href={`/consultations/${consultation.id}`}>Open full</Link>
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        ))}
                      </TableBody>
                    </Table>
                    </>
                  ) : (
                    <p className="text-muted-foreground">No consultation history found.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>


            <TabsContent value="labs-imaging" className="mt-0">
              <div className="grid gap-4 lg:grid-cols-2">
                <LabResultsView patientId={patientId} />
                <ImagingResultsView patientId={patientId} />
              </div>
            </TabsContent>

            <TabsContent value="referral-mc" className="mt-0">
              <Suspense fallback={<div>Loading form...</div>}>
                <ReferralMCSection patient={patient} />
              </Suspense>
            </TabsContent>

            <TabsContent value="documents" className="mt-0">
              <PatientDocuments patientId={patientId} />
            </TabsContent>
          </div>

          {/* Right column: panel content (omitted when closed so main column uses full width) */}
          {panelOpen && (
            <div className="w-[480px] shrink-0 flex flex-col gap-2">
              <div className="flex flex-1 flex-col rounded-lg border bg-card shadow-sm">
                {drawerMode === "consult" && (
                  <form onSubmit={handleConsultSign} className="flex flex-col h-full">
                    <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                      <RichTextEditor
                        placeholder="Clinical notes"
                        minHeight="360px"
                        value={clinicalNotes}
                        onChange={setClinicalNotes}
                      />
                      <Input
                        placeholder="Condition (diagnosis)"
                        value={diagnosis}
                        onChange={(event) => setDiagnosis(event.target.value)}
                      />
                    </div>
                    <div className="border-t px-5 py-4">
                      <Button type="submit" disabled={consultSubmitting} className="w-full">
                        {consultSubmitting ? "Signing..." : "Sign"}
                      </Button>
                    </div>
                  </form>
                )}
                {drawerMode === "treatment" && (
                  <form onSubmit={handleTreatmentSign} className="flex flex-col h-full">
                    <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
                      <OrderComposer
                        draftId={`profile-treatment-${patientId}`}
                        patientId={patientId}
                        initialEntries={emptyTreatmentEntries}
                        items={treatmentItemsCatalog}
                        services={treatmentServicesCatalog}
                        packages={emptyPackages}
                        documents={treatmentDocumentsCatalog}
                        onPlanChange={handleTreatmentPlanChange}
                        submitLabel="Sign"
                        submitting={treatmentSubmitting}
                        patient={patient}
                      />
                      <div className="rounded-md border p-3 text-xs text-muted-foreground">
                        Current order total: <span className="font-semibold">RM {treatmentSummary.total.toFixed(2)}</span>
                      </div>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </Tabs>

    </>
  );
}
