"use client";

import { Fragment, FormEvent, startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearSignAttemptKey, signAttemptKey } from "@/lib/sign-attempt-key";
import { useConsultationDraft } from "@/lib/hooks/use-consultation-draft";
import { useUnsavedWork } from "@/lib/hooks/use-unsaved-work";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { shouldShowStartConsultButton, withSignedConsultation } from "@/lib/patients/profile-history";
import { DiagnosisSearch } from "@/components/diagnosis-search";
import { getMedications } from "@/lib/inventory";
import { getProcedures } from "@/lib/procedures";
import { formatPrescriptionLine } from "@/lib/prescriptions";
import { buildSignedDocumentNote } from "@/lib/orders/signed-document-note";
import { getClinicalCatalog } from "@/lib/clinical-catalog";
import {
  createComposerCatalogRequester, emptyComposerCatalogs, loadComposerCatalogs, shouldLoadComposerCatalogs, type ComposerCatalogs,
} from "@/lib/orders/composer-catalogs";
import { cn, formatDisplayDate } from "@/lib/utils";
import type { Prescription, ProcedureRecord } from "@/lib/models";
import type { SerializedPatient } from "@/components/patients/patient-card";
import type { TreatmentPlanEntry, TreatmentPlanSummary } from "@/lib/treatment-plan";
import type { QueueStatus } from "@/lib/types";

// Heavy views only mount when their tab / drawer is used, so they stay out of the first-load bundle.
const tabFallback = <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
const RichTextEditor = dynamic(
  () => import("@/components/ui/rich-text-editor").then((m) => m.RichTextEditor),
  { loading: () => tabFallback },
);
const OrderComposer = dynamic(
  () => import("@/components/orders/order-composer").then((m) => m.OrderComposer),
  { loading: () => tabFallback },
);
const PatientDocuments = dynamic(() => import("@/components/patients/patient-documents"), { loading: () => tabFallback });
const LabResultsView = dynamic(
  () => import("@/components/labs/lab-results-view").then((m) => m.LabResultsView),
  { loading: () => tabFallback },
);
const ImagingResultsView = dynamic(
  () => import("@/components/imaging/imaging-results-view").then((m) => m.ImagingResultsView),
  { loading: () => tabFallback },
);
const ReferralMCSection = dynamic(() => import("./referral-mc-section"), { loading: () => tabFallback });

type ProfileTab = "history" | "labs-imaging" | "documents";
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

type SignedConsultationForTreatment = ProfileConsultation & { id: string };

interface PatientProfileWorkspaceProps {
  patientId: string;
  patient: SerializedPatient;
  consultations: ProfileConsultation[];
  patientAge: number | null;
  medicalHistory: MedicalHistory;
  poctEnabled: boolean;
  pacsEnabled: boolean;
}

const emptyTreatmentSummary: TreatmentPlanSummary = {
  subtotal: 0,
  total: 0,
  currency: "MYR",
  itemCount: 0,
};
const emptyTreatmentEntries: TreatmentPlanEntry[] = [];
const emptyPackages: [] = [];
const consultationServiceCatalogItem = {
  id: "consultation-fee",
  name: "Consultation Fee",
  unitPrice: 0,
};

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "").trim();
}

function patientFacingProcedureNote(value: string | undefined, category?: string) {
  const text = value?.trim() || "";
  if (!text) return "";

  if (category === "documents" && text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as { kind?: string };
      if (parsed.kind === "referral" || parsed.kind === "mc") {
        return "";
      }
    } catch {
      return "";
    }
  }

  return text;
}

function consultationPreviewText(value: string | undefined) {
  return stripHtml(value || "") || "—";
}

function isDocumentProcedure(procedure: ProcedureRecord) {
  return procedure.category === "documents";
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

function latestSignedConsultation(consultations: ProfileConsultation[]): SignedConsultationForTreatment | null {
  return consultations.reduce<SignedConsultationForTreatment | null>((latest, consultation) => {
    if (!consultation.id) return latest;

    const signedConsultation = consultation as SignedConsultationForTreatment;
    if (!latest) return signedConsultation;

    const latestTime = latest.date ? new Date(latest.date).getTime() : 0;
    const candidateTime = consultation.date ? new Date(consultation.date).getTime() : 0;
    return candidateTime > latestTime ? signedConsultation : latest;
  }, null);
}

export default function PatientProfileWorkspace({
  patientId,
  patient,
  consultations,
  patientAge,
  medicalHistory,
  poctEnabled,
  pacsEnabled,
}: PatientProfileWorkspaceProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<ProfileTab>("history");
  const [drawerMode, setDrawerMode] = useState<DrawerMode>("consult");
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedConsultation, setSelectedConsultation] = useState<ProfileConsultation | null>(null);
  const consultDraft = useConsultationDraft(patientId);
  const consultSubmitRef = useRef(false);
  const treatmentSubmitRef = useRef(false);
  const { clinicalNotes, diagnosis } = consultDraft;
  const [treatmentUnsaved, setTreatmentUnsaved] = useState(false);
  useUnsavedWork(consultDraft.unsaved || treatmentUnsaved);
  const [signedConsultationForTreatment, setSignedConsultationForTreatment] =
    useState<SignedConsultationForTreatment | null>(null);
  const [treatmentPanelAnimationVersion, setTreatmentPanelAnimationVersion] = useState(0);
  const [consultSubmitting, setConsultSubmitting] = useState(false);
  const [consultSaveFailed, setConsultSaveFailed] = useState(false);
  const [treatmentSubmitting, setTreatmentSubmitting] = useState(false);
  const [treatmentEntries, setTreatmentEntries] = useState<TreatmentPlanEntry[]>([]);
  const [treatmentSummary, setTreatmentSummary] = useState<TreatmentPlanSummary>(emptyTreatmentSummary);
  const [queueStatus, setQueueStatus] = useState<QueueStatus>(patient.queueStatus ?? null);
  const [catalogs, setCatalogs] = useState<ComposerCatalogs>(emptyComposerCatalogs);
  // "Loading…" (not "No matches") in the composer until catalogs arrive; a failure stops the spinner-like state.
  const [catalogsSettled, setCatalogsSettled] = useState(false);
  const catalogRequester = useRef<ReturnType<typeof createComposerCatalogRequester> | null>(null);
  const { procedures: procedureOptions, medications: medicationOptions, labs: labCatalog,
    imaging: imagingCatalog, documents: documentCatalog } = catalogs;

  // The mounted Treatment composer invokes this when the browser is idle.
  const requestTreatmentCatalogs = useCallback(() => {
    catalogRequester.current ??= createComposerCatalogRequester(
      () => loadComposerCatalogs({ getProcedures, getMedications, getClinicalCatalog }),
      (loaded) => {
        startTransition(() => {
          setCatalogs(loaded);
          setCatalogsSettled(true);
        });
      },
      (error) => {
        console.error("Failed to load treatment catalogs:", error);
        setCatalogsSettled(true);
      },
    );
    if (!shouldLoadComposerCatalogs(drawerMode, panelOpen, catalogRequester.current.requested())) return;
    setCatalogsSettled(false); // a retry after a failed load shows Loading… again
    catalogRequester.current.request();
  }, [drawerMode, panelOpen]);

  const updateQueueStatus = useCallback(async (status: Exclude<QueueStatus, null>) => {
    const response = await fetch("/api/queue", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientId, status }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.success) {
      throw new Error(data?.error || "Failed to update queue status");
    }
    setQueueStatus(status);
  }, [patientId]);

  useEffect(() => {
    if (queueStatus !== "arrived" && queueStatus !== "waiting") return;

    queueMicrotask(() => {
      void updateQueueStatus("in_consultation").catch((error) => {
        toast({
          title: "Queue Status Not Updated",
          description: error instanceof Error ? error.message : "Failed to mark patient as in consultation.",
          variant: "destructive",
        });
      });
    });
  }, [queueStatus, toast, updateQueueStatus]);

  const visibleConsultations = useMemo(
    () => mergeByVisit(withSignedConsultation(consultations, signedConsultationForTreatment)),
    [consultations, signedConsultationForTreatment]
  );
  const latestTreatmentConsultation = useMemo(
    () => latestSignedConsultation(visibleConsultations),
    [visibleConsultations]
  );
  const treatmentConsultation = signedConsultationForTreatment ?? latestTreatmentConsultation;
  const treatmentDraftId = `profile-treatment-${patientId}-${treatmentConsultation?.id || "pending"}`;

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
    () => {
      const catalog = procedureOptions.map((item) => ({
        id: item.id,
        name: item.label,
        unitPrice: item.price || 0,
      }));
      const labServices = labCatalog.map((item) => ({
        id: `lab-${item.id}`,
        name: `Lab: ${item.display || item.name}`,
        unitPrice: item.defaultPrice || 0,
        meta: {
          kind: "lab",
          code: item.code || item.id,
          display: item.display || item.name,
          system: item.system || "",
        },
      }));
      const imagingServices = imagingCatalog
        .map((item) => ({
          id: `imaging-${item.id}`,
          name: `Imaging: ${item.display || item.name}${item.modality ? ` (${item.modality})` : ""}`,
          unitPrice: item.defaultPrice || 0,
          meta: {
            kind: "imaging",
            code: item.code || item.id,
            display: item.display || item.name,
            system: item.system || "",
            modality: item.modality || "",
          },
        }));
      const hasConsultationService = catalog.some((item) => /\bconsultation\b/i.test(item.name));
      const serviceCatalog = hasConsultationService ? catalog : [consultationServiceCatalogItem, ...catalog];

      return [...serviceCatalog, ...labServices, ...imagingServices];
    },
    [imagingCatalog, labCatalog, procedureOptions]
  );

  const treatmentDocumentsCatalog = useMemo(
    () => [
      ...(!documentCatalog.some(item => /time[- ]chit/i.test(`${item.code} ${item.name}`))
        ? [{ id: "letter-time-chit", name: "Time Chit", unitPrice: 0, meta: { kind: "time-chit" } }] : []),
      ...documentCatalog.flatMap((item) => {
        const key = `${item.code || item.id} ${item.name}`.toLowerCase();
        const kind = key.includes("time-chit") || key.includes("time chit") ? "time-chit" : key.includes("mc") || key.includes("medical certificate")
          ? "mc"
          : key.includes("referral")
            ? "referral"
            : null;
        if (!kind) return [];
        return [{
          id: kind === "time-chit" ? "letter-time-chit" : item.code === "letter-mc" || item.id === "letter-mc" ? "letter-mc" : item.code === "letter-referral" || item.id === "letter-referral" ? "letter-referral" : item.id,
          name: item.display || item.name,
          unitPrice: item.defaultPrice || 0,
          meta: { kind },
        }];
      }),
    ],
    [documentCatalog]
  );

  const handleTreatmentPlanChange = useCallback((entries: TreatmentPlanEntry[], summary: TreatmentPlanSummary) => {
    setTreatmentEntries(entries);
    setTreatmentSummary(summary);
  }, []);

  function handleTabChange(value: string) {
    setActiveTab(value as ProfileTab);
  }

  function canLeaveTreatment() {
    return drawerMode !== "treatment" || !treatmentUnsaved || window.confirm("Treatment changes are not saved. Close and lose those changes?");
  }

  function closePanel() {
    if (canLeaveTreatment()) { setTreatmentUnsaved(false); setPanelOpen(false); }
  }

  function openConsultPanel() {
    if (!canLeaveTreatment()) return;
    setTreatmentUnsaved(false);
    if (drawerMode === "consult" && panelOpen) {
      setPanelOpen(false);
      return;
    }

    setDrawerMode("consult");
    setPanelOpen(true);
  }

  function openTreatmentPanel() {
    if (!treatmentConsultation) {
      setDrawerMode("consult");
      setPanelOpen(true);
      toast({
        title: "Consult Required",
        description: "Please fill in and sign the consult before adding treatment.",
        variant: "destructive",
      });
      return;
    }

    if (drawerMode === "treatment" && panelOpen) {
      closePanel();
      return;
    }

    setDrawerMode("treatment");
    setPanelOpen(true);
  }

  async function handleConsultSign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Task 712: a ref flips synchronously, so a double click cannot start a second request before React re-renders.
    if (consultSubmitting || consultSubmitRef.current) return;

    if (!stripHtml(clinicalNotes) || !diagnosis.trim()) {
      toast({
        title: "Validation Error",
        description: "Please fill in clinical notes and diagnosis before signing.",
        variant: "destructive",
      });
      return;
    }

    const signedChiefComplaint = clinicalNotes;
    const signedDiagnosis = diagnosis.trim();

    consultSubmitRef.current = true;
    try {
      consultDraft.setSigning(true);
      setConsultSubmitting(true);
      await consultDraft.save();
      setConsultSaveFailed(false);
      const response = await fetch("/api/consultations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          chiefComplaint: signedChiefComplaint,
          diagnosis: signedDiagnosis,
          idempotencyKey: signAttemptKey(patientId, signedChiefComplaint, signedDiagnosis),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to save consultation");
      }

      const signedConsultationId = typeof data.consultationId === "string" ? data.consultationId : "";
      if (!signedConsultationId) {
        throw new Error("Consultation was saved but no consultation ID was returned.");
      }
      clearSignAttemptKey(patientId);
      setSignedConsultationForTreatment({
        id: signedConsultationId,
        patientId,
        date: new Date().toISOString(),
        chiefComplaint: signedChiefComplaint,
        diagnosis: signedDiagnosis,
        procedures: [],
        prescriptions: [],
      });

      toast({
        title: "Consult Signed",
        description: "Clinical notes and diagnosis were saved. Treatment is ready.",
      });
      if (queueStatus && queueStatus !== "completed") {
        setQueueStatus("meds_and_bills");
      }
      try { await consultDraft.clear(); } catch {
        toast({ title: "Consult signed", description: "Saved draft cleanup failed. Do not sign this note again.", variant: "destructive" });
      }
      setTreatmentUnsaved(false);
      setTreatmentEntries([]);
      setTreatmentSummary(emptyTreatmentSummary);
      setTreatmentPanelAnimationVersion((current) => current + 1);
      setDrawerMode("treatment");
      setPanelOpen(true);
      router.refresh();
    } catch (error) {
      setConsultSaveFailed(true);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save consultation.",
        variant: "destructive",
      });
    } finally {
      consultSubmitRef.current = false;
      consultDraft.setSigning(false);
      setConsultSubmitting(false);
    }
  }

  async function handleTreatmentSign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (treatmentSubmitting || treatmentSubmitRef.current) return;

    if (!treatmentConsultation) {
      toast({
        title: "Consult Required",
        description: "Please fill in and sign the consult before adding treatment.",
        variant: "destructive",
      });
      setDrawerMode("consult");
      setPanelOpen(true);
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

    const orderedTreatmentEntries = [...treatmentEntries]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((entry, orderIndex) => ({ ...entry, orderIndex }));
    const medicationEntries = orderedTreatmentEntries.filter((entry) => entry.tab === "items");
    const serviceEntries = orderedTreatmentEntries.filter((entry) => entry.tab === "services" || entry.tab === "packages");
    const documentEntries = orderedTreatmentEntries.filter((entry) => entry.tab === "documents");
    const prescriptions: Prescription[] = medicationEntries.map((entry) => ({
      medication: {
        id: entry.catalogRef || entry.id,
        name: entry.name,
        strength: entry.dosage,
      },
      frequency: entry.frequency || "",
      duration: entry.duration || "",
      quantity: entry.quantity,
      orderIndex: entry.orderIndex,
      category: "items",
      price: entry.unitPrice,
    }));
    const investigationEntries = serviceEntries.filter((entry) => entry.meta?.kind === "poct" || entry.meta?.kind === "lab" || entry.meta?.kind === "xray");
    const poctEntries = investigationEntries.filter((entry) => entry.meta?.kind === "poct");
    const xrayEntries = investigationEntries.filter((entry) => entry.meta?.kind === "xray");
    const billableProcedureEntries = [...serviceEntries.filter((entry) => entry.meta?.kind !== "poct" && entry.meta?.kind !== "lab" && entry.meta?.kind !== "xray"), ...documentEntries];
    const procedures: ProcedureRecord[] = billableProcedureEntries.map((entry) => ({
      name: entry.name,
      quantity: entry.quantity,
      orderIndex: entry.orderIndex,
      category: entry.tab,
      price: entry.unitPrice,
      notes: entry.tab === "documents" ? buildSignedDocumentNote(entry) : entry.instruction,
      procedureId: entry.catalogRef,
      ...(entry.meta?.kind === "imaging" ? { signEntryId: entry.id } : {}),
    }));
    const clinicalServiceEntries = [...serviceEntries, ...documentEntries];
    const labSelections = clinicalServiceEntries
      .filter((entry) => entry.meta?.kind === "lab")
      .map((entry) => ({
        code: entry.meta?.code || entry.catalogRef || entry.id,
        display: entry.meta?.display || entry.name.replace(/^Lab:\s*/, ""),
        system: entry.meta?.system || "http://loinc.org",
      }));
    const imagingSelections = clinicalServiceEntries
      .filter((entry) => entry.meta?.kind === "imaging")
      .map((entry) => ({
        code: entry.meta?.code || entry.catalogRef || entry.id,
        display: entry.meta?.display || entry.name.replace(/^Imaging:\s*/, ""),
        system: entry.meta?.system || "http://loinc.org",
        modality: entry.meta?.modality || "DX",
      }));

    if (poctEntries.length > 0 && !poctEnabled) {
      toast({ title: "POCT is disabled for this clinic", variant: "destructive" });
      return;
    }
    if (xrayEntries.length > 0 && !pacsEnabled) {
      toast({ title: "PACS is disabled for this clinic", variant: "destructive" });
      return;
    }

    treatmentSubmitRef.current = true;
    try {
      setTreatmentSubmitting(true);
      // Place POCT/X-ray first: failed/offline orders leave the composer intact for retry.
      // The server uses each draft entry id as a conditional-create key.
      for (const entry of poctEntries) {
        const poctResponse = await fetch("/api/labs/order", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patientId, encounterId: treatmentConsultation.id,
            tests: [{ code: entry.meta?.code, display: entry.name }],
            poct: { code: entry.meta?.code, analyserId: entry.meta?.analyserId, entryId: entry.id },
          }),
        });
        if (!poctResponse.ok) {
          const failure = await poctResponse.json().catch(() => ({}));
          throw new Error(failure.error || "POCT order failed. Please check the analyser.");
        }
      }
      for (const entry of xrayEntries) {
        const xrayResponse = await fetch("/api/imaging/order", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patientId, encounterId: treatmentConsultation.id,
            procedures: [{ code: entry.meta?.code, display: entry.name }],
            clinicalIndication: treatmentConsultation.diagnosis || treatmentConsultation.chiefComplaint || entry.name,
            xray: { code: entry.meta?.code, deviceId: entry.meta?.deviceId, entryId: entry.id },
          }),
        });
        if (!xrayResponse.ok) {
          const failure = await xrayResponse.json().catch(() => ({}));
          throw new Error(failure.error || "X-ray order failed. Please check the device.");
        }
      }
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consultationId: treatmentConsultation.id,
          procedures,
          prescriptions,
          billingItems: investigationEntries.map((entry) => ({ id: entry.id, name: entry.name, price: entry.unitPrice,
            quantity: entry.quantity, orderIndex: entry.orderIndex, category: entry.tab })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to save treatment");
      }

      const consultationId = treatmentConsultation.id;
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
              clinicalNotes: treatmentConsultation.chiefComplaint,
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
              clinicalIndication: treatmentConsultation.diagnosis || treatmentConsultation.chiefComplaint,
              clinicalQuestion: treatmentConsultation.chiefComplaint,
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

      try {
        await fetch("/api/consultations/plan", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId: treatmentDraftId, patientId, consultationId: treatmentConsultation.id, clearAll: true }),
        });
      } catch (error) {
        console.error("Treatment draft clear error:", error);
      }

      toast({
        title: "Treatment Signed",
        description: orderErrors.length
          ? `Treatment saved. Orders with issues: ${orderErrors.join(", ")}.`
          : "Treatment visit was saved.",
        variant: orderErrors.length ? "destructive" : "default",
      });
      setTreatmentUnsaved(false);
      setTreatmentEntries([]);
      setTreatmentSummary(emptyTreatmentSummary);
      setTreatmentPanelAnimationVersion((current) => current + 1);
      setPanelOpen(false);
      router.refresh();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save treatment.",
        variant: "destructive",
      });
    } finally {
      treatmentSubmitRef.current = false;
      setTreatmentSubmitting(false);
    }
  }

  return (
    <>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col gap-3">
        <TabsList className="w-auto max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="history" className="px-3 text-xs">Consultation History</TabsTrigger>
          <TabsTrigger value="labs-imaging" className="px-3 text-xs">Labs & Imaging</TabsTrigger>
          <TabsTrigger value="documents" className="px-3 text-xs">Documents</TabsTrigger>
        </TabsList>

        {/* Content row: main tab content + action panel */}
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <TabsContent value="history" className="mt-0">
              <div className="mb-3 flex justify-end">
                <Tabs value={panelOpen ? drawerMode : ""}>
                  <TabsList>
                    <TabsTrigger
                      value="consult"
                      className="px-3 text-xs"
                      onClick={() => {
                        openConsultPanel();
                      }}
                    >Consult</TabsTrigger>
                    <TabsTrigger
                      value="treatment"
                      className="px-3 text-xs"
                      onClick={(event) => {
                        event.preventDefault();
                        openTreatmentPanel();
                      }}
                    >Treatment</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <Card>
                <CardContent className="space-y-4">
                  {visibleConsultations.length > 0 ? (
                    <>
                      <div className="md:hidden space-y-3">
                        {visibleConsultations.map((consultation) => (
                          <button
                            key={consultation.id}
                            type="button"
                            className={cn(
                              "w-full rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/40",
                              selectedConsultation?.id === consultation.id && "border-primary bg-muted/40"
                            )}
                            onClick={() => {
                              setSelectedConsultation((current) =>
                                current?.id === consultation.id ? null : consultation
                              );
                            }}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium">{formatDisplayDate(consultation.date)}</p>
                                <p className="mt-1 text-xs text-muted-foreground">Consultation</p>
                              </div>
                              <p className="text-xs text-muted-foreground">{consultation.prescriptions?.length || 0} items</p>
                            </div>
                            <div className="mt-3 space-y-2">
                              <div>
                                <p className="text-xs text-muted-foreground">Clinical notes</p>
                                <p className="text-sm">{consultationPreviewText(consultation.chiefComplaint)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Diagnosis</p>
                                <p className="text-sm">{consultation.diagnosis || "—"}</p>
                              </div>
                            </div>
                          </button>
                        ))}
                        {selectedConsultation && (
                          <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                            <div>
                              <p className="text-sm font-medium">{formatDisplayDate(selectedConsultation.date)}</p>
                              <p className="text-sm text-muted-foreground">{consultationPreviewText(selectedConsultation.chiefComplaint)}</p>
                            </div>
                            <div>
                              <p className="mb-1 text-sm font-medium">Diagnosis</p>
                              <p className="text-sm text-muted-foreground">{selectedConsultation.diagnosis || "—"}</p>
                            </div>
                            {selectedConsultation.notes && (
                              <div>
                                <p className="mb-1 text-sm font-medium">Notes</p>
                                <div className="rich-text-display text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: selectedConsultation.notes }} />
                              </div>
                            )}
                            {selectedConsultation.progressNote && (
                              <div>
                                <p className="mb-1 text-sm font-medium">Progress Note</p>
                                <div className="rich-text-display text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: selectedConsultation.progressNote }} />
                              </div>
                            )}
                            {selectedConsultation.prescriptions && selectedConsultation.prescriptions.length > 0 && (
                              <div>
                                <p className="mb-2 text-sm font-medium">Prescriptions</p>
                                <ul className="space-y-1">
                                  {selectedConsultation.prescriptions.map((rx, i) => (
                                    <li key={i} className="text-sm text-muted-foreground">
                                      {formatPrescriptionLine(rx)}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {selectedConsultation.procedures?.some((proc) => !isDocumentProcedure(proc)) && (
                              <div>
                                <p className="mb-2 text-sm font-medium">Services</p>
                                <ul className="space-y-1">
                                  {selectedConsultation.procedures
                                    .filter((proc) => !isDocumentProcedure(proc))
                                    .map((proc, i) => (
                                      <ProcedureListItem key={i} procedure={proc} />
                                    ))}
                                </ul>
                              </div>
                            )}
                            {selectedConsultation.procedures?.some(isDocumentProcedure) && (
                              <div>
                                <p className="mb-2 text-sm font-medium">Documents</p>
                                <ul className="space-y-1">
                                  {selectedConsultation.procedures
                                    .filter(isDocumentProcedure)
                                    .map((proc, i) => (
                                      <ProcedureListItem key={i} procedure={proc} />
                                    ))}
                                </ul>
                              </div>
                            )}
                            {selectedConsultation.id && (
                              <div className="flex flex-wrap gap-2 border-t pt-3">
                                <Button variant="outline" size="sm" asChild>
                                  <Link href={`/consultations/${selectedConsultation.id}`} prefetch={false}>Open full</Link>
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="hidden overflow-x-auto md:block">
                        <Table className="min-w-[760px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead className="min-w-[160px]">Complaint</TableHead>
                            <TableHead className="min-w-[160px]">Diagnosis</TableHead>
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
                                <TableCell className="min-w-[160px] max-w-[200px] truncate">{consultationPreviewText(consultation.chiefComplaint)}</TableCell>
                                <TableCell className="min-w-[160px] max-w-[200px] truncate">{consultation.diagnosis}</TableCell>
                                <TableCell>{consultation.prescriptions?.length || 0} items</TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                    <Button variant="outline" size="sm" asChild>
                                      <Link href={`/consultations/${consultation.id}`} prefetch={false}>View</Link>
                                    </Button>
                                    <Button size="sm" asChild>
                                      <Link href={`/consultations/${consultation.id}/edit`} prefetch={false}>Edit</Link>
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
                                                {formatPrescriptionLine(rx)}
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}
                                      {consultation.procedures?.some((proc) => !isDocumentProcedure(proc)) && (
                                        <div>
                                          <p className="mb-2 text-sm font-medium">Services</p>
                                          <ul className="space-y-1">
                                            {consultation.procedures
                                              .filter((proc) => !isDocumentProcedure(proc))
                                              .map((proc, i) => (
                                                <ProcedureListItem key={i} procedure={proc} />
                                              ))}
                                          </ul>
                                        </div>
                                      )}
                                      {consultation.procedures?.some(isDocumentProcedure) && (
                                        <div>
                                          <p className="mb-2 text-sm font-medium">Documents</p>
                                          <ul className="space-y-1">
                                            {consultation.procedures
                                              .filter(isDocumentProcedure)
                                              .map((proc, i) => (
                                                <ProcedureListItem key={i} procedure={proc} />
                                              ))}
                                          </ul>
                                        </div>
                                      )}
                                      {consultation.id && (
                                        <div className="flex flex-wrap gap-2 border-t pt-3">
                                          <Button variant="outline" size="sm" asChild>
                                            <Link href={`/consultations/${consultation.id}`} prefetch={false}>Open full</Link>
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
                      </div>
                    </>
                  ) : (
                    <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">No consultation history yet.</p>
                      <p className="mt-1">Start the first consult to build the record here.</p>
                      {shouldShowStartConsultButton(panelOpen) && (
                        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={openConsultPanel}>
                          Start consult
                        </Button>
                      )}
                    </div>
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

            <TabsContent value="documents" className="mt-0">
              <div className="grid gap-4">
                <Suspense fallback={<div>Loading documents...</div>}>
                  <ReferralMCSection patient={patient} consultations={visibleConsultations} />
                </Suspense>
                <PatientDocuments patientId={patientId} />
              </div>
            </TabsContent>
          </div>

          {panelOpen && (
            <div className="w-full lg:w-[480px] lg:shrink-0 lg:sticky lg:top-6">
              <div className="flex flex-col rounded-lg border bg-card shadow-sm">
                <div className="flex items-center justify-between border-b px-5 py-3">
                  <div>
                    <p className="text-sm font-medium capitalize">{drawerMode}</p>
                    <p className="text-xs text-muted-foreground">Patient profile workspace</p>
                  </div>
                  <Button variant="ghost" size="sm" type="button" onClick={closePanel}>
                    Close
                  </Button>
                </div>
                {drawerMode === "consult" && (
                  <form
                    key="consult-panel"
                    onSubmit={handleConsultSign}
                    className="patient-panel-enter-left flex flex-col"
                  >
                    <fieldset inert={consultSubmitting || consultDraft.status === "cleanup-failed"} disabled={consultSubmitting || consultDraft.status === "cleanup-failed"} className="space-y-4 px-5 py-4">
                      <RichTextEditor
                        placeholder="Clinical notes"
                        minHeight="360px"
                        value={clinicalNotes}
                        onChange={(value) => consultDraft.change("clinicalNotes", value)}
                      />
                      <DiagnosisSearch value={diagnosis} onChange={(value) => consultDraft.change("diagnosis", value)} />
                    </fieldset>
                    <div className="border-t px-5 py-4">
                      <Button type="submit" disabled={consultSubmitting || consultDraft.status === "checking" || consultDraft.status === "cleanup-failed"} className="w-full">
                        {consultSubmitting ? "Saving…" : consultSaveFailed ? "Retry" : "Sign"}
                      </Button>
                      <p role="status" aria-live="polite" aria-atomic="true" data-testid="consult-save-status" className="mt-2 min-h-8 text-[11px] leading-4 text-muted-foreground">
                        {consultSubmitting ? "Saving…" : consultSaveFailed ? "Failed to save" : consultDraft.status === "cleanup-failed" ? "Consult signed — saved draft cleanup failed" : consultDraft.status === "checking" ? "Checking saved draft…" : consultDraft.status === "failed" ? "Failed to save draft — current screen only" : consultDraft.status === "saving" || consultDraft.status === "pending" ? "Saving draft…" : "Draft saved (server) — unsigned"}
                      </p>
                      {consultDraft.status === "cleanup-failed" && <Button type="button" size="sm" variant="outline" onClick={() => { void consultDraft.clear().catch(() => {}); }}>Retry draft cleanup</Button>}
                      {consultDraft.status === "failed" && <div className="text-xs text-destructive"><p>{consultDraft.error}</p><Button type="button" size="sm" variant="outline" onClick={consultDraft.retry}>Retry draft save</Button></div>}
                    </div>
                  </form>
                )}
                {drawerMode === "treatment" && (
                  <form
                    key={`treatment-panel-${treatmentPanelAnimationVersion}`}
                    onSubmit={handleTreatmentSign}
                    className="patient-panel-enter-treatment flex flex-col"
                  >
                    <div className="space-y-3 px-5 py-4">
                      <OrderComposer
                        draftId={treatmentDraftId}
                        patientId={patientId}
                        consultationId={treatmentConsultation?.id}
                        consultation={treatmentConsultation}
                        initialEntries={emptyTreatmentEntries}
                        persistDrafts
                        items={treatmentItemsCatalog}
                        services={treatmentServicesCatalog}
                        packages={emptyPackages}
                        documents={treatmentDocumentsCatalog}
                        loadingCatalog={!catalogsSettled}
                        onLoadCatalogs={requestTreatmentCatalogs}
                        onPlanChange={handleTreatmentPlanChange}
                        onUnsavedChange={setTreatmentUnsaved}
                        submitLabel="Sign"
                        submitting={treatmentSubmitting}
                        patient={patient}
                        poctEnabled={poctEnabled}
                        pacsEnabled={pacsEnabled}
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

function ProcedureListItem({ procedure }: { procedure: ProcedureRecord }) {
  const note = patientFacingProcedureNote(procedure.notes, procedure.category);

  return (
    <li className="text-sm text-muted-foreground">
      {procedure.name}
      {note ? ` — ${note}` : ""}
    </li>
  );
}
