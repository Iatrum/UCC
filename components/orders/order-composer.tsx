"use client";

import { getCatalogSearchState } from "@/lib/orders/catalog-search-state";
import { mergeUnsavedEntries, planWriteOutcome } from "@/lib/plan-save-state";
import { useUnsavedWork } from "@/lib/hooks/use-unsaved-work";

import { PoctSection } from "./poct-section";
import { XraySection } from "./xray-section";

import * as React from "react";
import { Search, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  computeTreatmentPlanSummary,
  type TreatmentPlanEntry,
  type TreatmentPlanEntryInput,
  type TreatmentPlanSummary,
  type TreatmentPlanTab,
} from "@/lib/treatment-plan";
import { fetchOrganizationDetails, type OrganizationDetails } from "@/lib/org";
import { timeChitHours, timeChitError } from "@/lib/time-chit";
import { buildSignedDocumentNote, documentKind } from "@/lib/orders/signed-document-note";
import { buildReferralBody, mcDiagnosisVisible } from "@/lib/clinical-documents";
import { DEFAULT_TIME_CHIT_TEMPLATE, DEFAULT_MC_TEMPLATE, DEFAULT_REFERRAL_TEMPLATE } from "@/lib/document-templates";
import { formatClinicDate, clinicToday } from "@/lib/clinic-dates";
import { renderDocumentHtml } from "@/lib/document-render";
import { printHtml } from "@/lib/print-html";

type CatalogItem = {
  id: string;
  name: string;
  unitPrice?: number;
  meta?: Record<string, string>;
};

interface OrderComposerProps {
  draftId: string;
  patientId: string;
  consultationId?: string;
  consultation?: {
    date?: string | null;
    chiefComplaint?: string | null;
    diagnosis?: string | null;
    notes?: string | null;
    progressNote?: string | null;
  } | null;
  initialEntries?: TreatmentPlanEntry[];
  persistDrafts?: boolean;
  items: CatalogItem[];
  services: CatalogItem[];
  packages?: CatalogItem[];
  documents?: CatalogItem[];
  loadingCatalog?: boolean;
  onLoadCatalogs?: () => void;
  onUnsavedChange?: (unsaved: boolean) => void;
  onPlanChange?: (entries: TreatmentPlanEntry[], summary: TreatmentPlanSummary) => void;
  submitLabel?: string;
  submitting?: boolean;
  patient?: { id: string; fullName: string; nric: string; dateOfBirth?: string | null; medicalHistory?: { allergies?: string[]; medications?: string[] } | null } | null;
  poctEnabled?: boolean;
  pacsEnabled?: boolean;
}

const TABS: Array<{ key: TreatmentPlanTab; label: string }> = [
  { key: "items", label: "Items" },
  { key: "services", label: "Services" },
  { key: "packages", label: "Packages" },
  { key: "documents", label: "Documents" },
];

function kindLabelForTab(tab: TreatmentPlanTab): string {
  switch (tab) {
    case "items":
      return "Medication";
    case "services":
      return "Service";
    case "packages":
      return "Package";
    case "documents":
      return "Document";
    default:
      return tab;
  }
}

function documentDisplayName(item: CatalogItem): string {
  const kind = documentKind(item);
  if (kind === "time-chit") return "TIME CHIT";
  if (kind === "mc") return "MEDICAL CERTIFICATE (MC)";
  if (kind === "referral") return "REFERRAL LETTER";
  return item.name;
}

function htmlToPlainText(value?: string | null): string {
  return (value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function buildReferralDefaultContent({
  patientName,
  consultation,
  medications,
  orderedMedications,
  allergies,
}: {
  patientName?: string | null;
  consultation?: OrderComposerProps["consultation"];
  medications?: string[];
  orderedMedications?: string[];
  allergies?: string[];
}): string {
  return buildReferralBody({
    patientName,
    visitDate: consultation?.date ? formatClinicDate(consultation.date) : "",
    clinicalSummary: htmlToPlainText(consultation?.chiefComplaint),
    diagnosis: (consultation?.diagnosis || "").trim(),
    notes: htmlToPlainText(consultation?.notes),
    progressNote: htmlToPlainText(consultation?.progressNote),
    medications,
    orderedMedications,
    allergies,
  });
}

export { buildSignedDocumentNote };

const SIGNER_KEY = "ucc.document-signer";
/** Remember the last doctor name / MMC number typed on an MC or referral (browser-local, not clinic data). */
function rememberSigner(name: string, mmc: string) {
  try {
    if (name.trim()) localStorage.setItem(SIGNER_KEY, JSON.stringify({ name: name.trim(), mmc: mmc.trim() }));
  } catch {}
}
function recallSigner(): { name: string; mmc: string } {
  try {
    const parsed = JSON.parse(localStorage.getItem(SIGNER_KEY) || "{}");
    return { name: String(parsed.name || ""), mmc: String(parsed.mmc || "") };
  } catch {
    return { name: "", mmc: "" };
  }
}

export function OrderComposer({
  draftId,
  patientId,
  consultationId,
  consultation = null,
  initialEntries = [],
  persistDrafts = false,
  items,
  services,
  packages = [],
  documents = [],
  loadingCatalog = false,
  onLoadCatalogs,
  onPlanChange,
  onUnsavedChange,
  submitLabel = "Sign Order",
  submitting = false,
  patient = null,
  poctEnabled = false,
  pacsEnabled = false,
}: OrderComposerProps) {
  const { toast } = useToast();
  React.useEffect(() => {
    if (!onLoadCatalogs) return;

    if (typeof window.requestIdleCallback === "function") {
      const idle = window.requestIdleCallback(onLoadCatalogs, { timeout: 150 });
      return () => window.cancelIdleCallback(idle);
    }

    const timer = window.setTimeout(onLoadCatalogs, 0);
    return () => window.clearTimeout(timer);
  }, [onLoadCatalogs]);

  const [searchQuery, setSearchQuery] = React.useState("");
  const [entries, setEntries] = React.useState<TreatmentPlanEntry[]>([]);
  const entriesRef = React.useRef<TreatmentPlanEntry[]>([]);
  const userTouchedRef = React.useRef(false);
  const removedIdsRef = React.useRef(new Set<string>());
  const lastDraftIdRef = React.useRef<string | null>(null);
  const [summary, setSummary] = React.useState<TreatmentPlanSummary>(() => computeTreatmentPlanSummary([]));
  const draftKey = `${patientId}:${consultationId || ""}:${draftId}`;
  const [hydratedKey, setHydratedKey] = React.useState<string | null>(null);
  const hydrated = hydratedKey === draftKey;
  const [loadAttempt, setLoadAttempt] = React.useState(0);
  const [failedSaves, setFailedSaves] = React.useState<Record<string, () => Promise<void>>>({});
  const failedSavesRef = React.useRef(failedSaves);
  // Latest-value ref kept in sync during render on purpose: moving it to an effect would change timing seen by in-flight saves.
  // eslint-disable-next-line react-hooks/refs
  failedSavesRef.current = failedSaves;
  const [savingIds, setSavingIds] = React.useState<Record<string, number>>({});
  const [persistenceDisabled, setPersistenceDisabled] = React.useState(!persistDrafts);
  const [saveErrorMessage, setSaveErrorMessage] = React.useState<string | null>(null);
  const persistenceDisabledRef = React.useRef(persistenceDisabled);
  const disablePersistence = React.useCallback(() => {
    persistenceDisabledRef.current = true;
    setPersistenceDisabled(true);
  }, []);
  const unsaved = Object.keys(savingIds).length > 0 || Object.keys(failedSaves).length > 0 ||
    !!saveErrorMessage || (persistenceDisabled && entries.length > 0);
  useUnsavedWork(onUnsavedChange ? false : unsaved);
  React.useEffect(() => { onUnsavedChange?.(unsaved); }, [onUnsavedChange, unsaved]);
  const writeQueue = React.useRef<Promise<unknown>>(Promise.resolve());
  const queuedFetch = React.useCallback((url: string, options: RequestInit) => {
    const request = writeQueue.current.catch(() => {}).then(() => fetch(url, options));
    writeQueue.current = request.then(async response => { await response.clone().text(); });
    return request;
  }, []);
  const [detailEntryId, setDetailEntryId] = React.useState<string | null>(null);
  const [editingDocumentEntryId, setEditingDocumentEntryId] = React.useState<string | null>(null);
  const [tcDetails, setTcDetails] = React.useState({ tcDate: clinicToday(), tcTimeIn: "", tcTimeOut: "", tcDoctorName: "", tcDoctorMmc: "" });
  const [tcTemplate, setTcTemplate] = React.useState(DEFAULT_TIME_CHIT_TEMPLATE);
  React.useEffect(() => {
    fetch("/api/document-templates?type=time-chit")
      .then(r => r.ok ? r.json() : null).then(data => { if (data?.html) setTcTemplate(data.html); }).catch(() => {});
  }, []);
  const [mcDays, setMcDays] = React.useState(1);
  const [mcDiagnosis, setMcDiagnosis] = React.useState("");
  const [mcStartDate, setMcStartDate] = React.useState(() => clinicToday());
  const [mcDoctorName, setMcDoctorName] = React.useState("");
  const [mcDoctorMmc, setMcDoctorMmc] = React.useState("");
  const [mcIncludeDiagnosis, setMcIncludeDiagnosis] = React.useState(false);
  const [referralDoctorName, setReferralDoctorName] = React.useState("");
  const [referralDoctorMmc, setReferralDoctorMmc] = React.useState("");
  const [referralTo, setReferralTo] = React.useState("");
  const [referralDiagnosis, setReferralDiagnosis] = React.useState("");
  const [referralContent, setReferralContent] = React.useState(
    "Please include any medical information you deem relevant for the referral"
  );
  const [organization, setOrganization] = React.useState<OrganizationDetails | null>(null);
  const [orgLoaded, setOrgLoaded] = React.useState(false);
  const [mcTemplateHtml, setMcTemplateHtml] = React.useState<string | null>(null);
  const [referralTemplateHtml, setReferralTemplateHtml] = React.useState<string | null>(null);


  React.useEffect(() => {
    persistenceDisabledRef.current = persistenceDisabled;
  }, [persistenceDisabled]);

  const catalogByTab = React.useMemo<Record<TreatmentPlanTab, CatalogItem[]>>(
    () => ({
      items,
      services,
      packages,
      documents,
    }),
    [items, services, packages, documents]
  );

  const unifiedCatalogRows = React.useMemo(
    () =>
      TABS.flatMap((tab) =>
        catalogByTab[tab.key].map((item) => ({
          tab: tab.key,
          item,
          kindLabel: kindLabelForTab(tab.key),
        }))
      ),
    [catalogByTab]
  );

  const filteredPickerRows = React.useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    if (!term) return [];
    return unifiedCatalogRows.filter(({ item, kindLabel }) => {
      const h = `${documentDisplayName(item)} ${item.name} ${kindLabel}`.toLowerCase();
      return h.includes(term);
    });
  }, [unifiedCatalogRows, searchQuery]);

  const sortedEntries = React.useMemo(
    () => [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [entries]
  );

  const detailEntry = detailEntryId ? entries.find((e) => e.id === detailEntryId) : undefined;
  const editingDocumentEntry = editingDocumentEntryId
    ? entries.find((e) => e.id === editingDocumentEntryId)
    : undefined;
  const editingDocumentKind =
    editingDocumentEntry?.catalogRef === "letter-time-chit" || editingDocumentEntry?.meta?.kind === "time-chit"
      ? "time-chit"
      : editingDocumentEntry?.catalogRef === "letter-mc" || editingDocumentEntry?.meta?.kind === "mc"
      ? "mc"
      : editingDocumentEntry?.catalogRef === "letter-referral" || editingDocumentEntry?.meta?.kind === "referral"
      ? "referral"
      : null;

  const defaultReferralDiagnosis = React.useMemo(
    () => (consultation?.diagnosis || "").trim(),
    [consultation?.diagnosis]
  );

  const defaultReferralContent = React.useMemo(
    () => buildReferralDefaultContent({
      patientName: patient?.fullName,
      consultation,
      medications: patient?.medicalHistory?.medications ?? [],
      orderedMedications: entries.filter((e) => e.tab === "items").map((e) => e.name),
      allergies: patient?.medicalHistory?.allergies ?? [],
    }),
    [consultation, patient?.fullName, patient?.medicalHistory, entries]
  );

  React.useEffect(() => {
    if (detailEntryId && !entries.some((e) => e.id === detailEntryId)) {
      queueMicrotask(() => {
        setDetailEntryId(null);
      });
    }
  }, [entries, detailEntryId]);

  React.useEffect(() => {
    if (editingDocumentEntryId && !entries.some((e) => e.id === editingDocumentEntryId)) {
      queueMicrotask(() => {
        setEditingDocumentEntryId(null);
      });
    }
  }, [entries, editingDocumentEntryId]);

  React.useEffect(() => {
    if (!editingDocumentEntry || orgLoaded) return;
    Promise.all([
      fetchOrganizationDetails(),
      fetch("/api/document-templates?type=mc").then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/document-templates?type=referral").then((r) => r.ok ? r.json() : null).catch(() => null),
    ]).then(([info, mcData, refData]) => {
      setOrganization(info);
      setMcTemplateHtml(mcData?.html ?? DEFAULT_MC_TEMPLATE);
      setReferralTemplateHtml(refData?.html ?? DEFAULT_REFERRAL_TEMPLATE);
    }).finally(() => setOrgLoaded(true));
  }, [editingDocumentEntry, orgLoaded]);

  const publishPlan = React.useCallback(
    (nextEntries: TreatmentPlanEntry[]) => {
      const nextSummary = computeTreatmentPlanSummary(nextEntries);
      entriesRef.current = nextEntries;
      setEntries(nextEntries);
      setSummary(nextSummary);
      onPlanChange?.(nextEntries, nextSummary);
    },
    [onPlanChange]
  );

  // Same renderer as the Documents tab and checkout. The issue date is the day the doctor signs (MYT).
  const mcPreviewHtml = React.useMemo(() => {
    if (!mcTemplateHtml) return null;
    return renderDocumentHtml({
      kind: "mc",
      template: mcTemplateHtml,
      details: { mcDays: String(mcDays), mcStartDate, mcDiagnosis, mcDoctorName, mcDoctorMmc, mcIncludeDiagnosis: mcIncludeDiagnosis ? "true" : "" },
      patient,
      organization,
      issuedDate: clinicToday(),
    });
  }, [mcTemplateHtml, mcDays, mcStartDate, mcDiagnosis, mcIncludeDiagnosis, mcDoctorName, mcDoctorMmc, organization, patient]);

  const referralPreviewHtml = React.useMemo(() => {
    if (!referralTemplateHtml) return null;
    return renderDocumentHtml({
      kind: "referral",
      template: referralTemplateHtml,
      details: { referralTo, referralContent, referralDiagnosis, referralDoctorName, referralDoctorMmc },
      patient,
      organization,
      issuedDate: clinicToday(),
    });
  }, [referralTemplateHtml, referralTo, referralContent, referralDiagnosis, referralDoctorName, referralDoctorMmc, organization, patient]);

  const tcPreviewHtml = React.useMemo(() => renderDocumentHtml({
    kind: "time-chit",
    template: tcTemplate,
    details: { ...tcDetails, tcHours: timeChitHours(tcDetails.tcTimeIn, tcDetails.tcTimeOut) || "" },
    patient,
    organization,
    issuedDate: clinicToday(),
  }), [tcTemplate, tcDetails, organization, patient]);

  // Read the current callbacks without making parent renders restart hydration.
  const hydrationContext = React.useRef({ initialEntries, publishPlan });
  // Latest-value ref (see failedSavesRef); effect-based sync would alter hydration timing.
  // eslint-disable-next-line react-hooks/refs
  hydrationContext.current = { initialEntries, publishPlan };

  const loadDraft = React.useCallback(async () => {
    const response = await fetch(
      `/api/consultations/plan?draftId=${encodeURIComponent(draftId)}&patientId=${encodeURIComponent(
        patientId
      )}${consultationId ? `&consultationId=${encodeURIComponent(consultationId)}` : ""}`,
      { cache: "no-store" }
    );
    const data = await response.json().catch(() => ({}));
    if (planWriteOutcome(response.ok, data) === "failed") {
      throw new Error(data?.error || "Failed to load treatment plan draft");
    }
    return data as {
      plan: { entries: TreatmentPlanEntry[]; summary: TreatmentPlanSummary };
      persistenceAvailable?: boolean;
    };
  }, [consultationId, draftId, patientId]);

  React.useEffect(() => {
    const { initialEntries, publishPlan } = hydrationContext.current;
    if (lastDraftIdRef.current !== draftKey) {
      const isDraftTransition = lastDraftIdRef.current !== null;
      lastDraftIdRef.current = draftKey;
      persistenceDisabledRef.current = !persistDrafts;
      queueMicrotask(() => {
        setPersistenceDisabled(!persistDrafts);
        setSaveErrorMessage(null);
        setFailedSaves({});
      });
      userTouchedRef.current = false;
      removedIdsRef.current.clear();
      if (isDraftTransition) {
        publishPlan(initialEntries);
      }
    }

    const publishHydratedPlan = (serverEntries: TreatmentPlanEntry[]) => {
      if (!userTouchedRef.current) {
        publishPlan(serverEntries);
        return;
      }
      const localEntries = entriesRef.current;
      const localIds = new Set(localEntries.map((entry) => entry.id));
      publishPlan([
        ...localEntries,
        ...serverEntries.filter((entry) => !localIds.has(entry.id) && !removedIdsRef.current.has(entry.id)),
      ]);
    };

    if (!persistDrafts) {
      queueMicrotask(() => {
        publishHydratedPlan(initialEntries);
        setHydratedKey(draftKey);
      });
      return;
    }

    let active = true;
    (async () => {
      try {
        const data = await loadDraft();
        if (!active) return;
        setSaveErrorMessage(null);
        if (data.persistenceAvailable === false) {
          disablePersistence();
          publishHydratedPlan(initialEntries);
          return;
        }
        if (data.plan.entries.length > 0) {
          publishHydratedPlan(data.plan.entries);
          return;
        }
        publishHydratedPlan(initialEntries);
      } catch (error) {
        if (!active) return;
        publishHydratedPlan(initialEntries);
        setSaveErrorMessage("Could not load saved draft.");
        toast({
          title: "Could not load saved draft",
          description: "The previously saved draft could not be loaded.",
          variant: "destructive",
        });
      } finally {
        if (active) setHydratedKey(draftKey);
      }
    })();
    return () => {
      active = false;
    };
  }, [draftKey, loadAttempt, loadDraft, persistDrafts, disablePersistence, toast]);

  const persistEntry = React.useCallback(
    async (entry: TreatmentPlanEntryInput): Promise<void> => {
      if (persistenceDisabled) {
        return;
      }
      const pendingKey = entry.id || `${entry.tab}:${entry.catalogRef || entry.name}`;
      setSavingIds((prev) => ({ ...prev, [pendingKey]: (prev[pendingKey] || 0) + 1 }));
      try {
        const response = await queuedFetch("/api/consultations/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId, patientId, consultationId, entry }),
        });
        const data = await response.json().catch(() => ({}));
        const outcome = planWriteOutcome(response.ok, data);
        if (outcome === "local-only") {
          disablePersistence();
          return;
        }
        if (outcome === "failed") {
          throw new Error(data?.error || "Failed to save treatment plan entry");
        }
        if (persistenceDisabledRef.current) {
          return;
        }
        setFailedSaves((prev) => {
          const next = { ...prev };
          delete next[pendingKey];
          return next;
        });
        publishPlan(
          mergeUnsavedEntries(
            data.plan.entries as TreatmentPlanEntry[],
            entriesRef.current,
            new Set(Object.keys(failedSavesRef.current).filter((id) => id !== pendingKey))
          )
        );
      } catch (error) {
        // Keep the doctor's item on screen: status says "Failed to save", Sign stays disabled, Retry replays it.
        // Retry replays this call; the self-reference is resolved at call time, after initialisation.
        // eslint-disable-next-line react-hooks/immutability
        setFailedSaves((prev) => ({ ...prev, [pendingKey]: () => persistEntry(entry) }));
        toast({
          title: "Autosave failed",
          description: error instanceof Error ? error.message : "Failed to save treatment plan changes.",
          variant: "destructive",
        });
      } finally {
        setSavingIds((prev) => {
          const next = { ...prev };
          if (next[pendingKey] > 1) next[pendingKey]--;
          else delete next[pendingKey];
          return next;
        });
      }
    },
    [consultationId, draftId, patientId, persistenceDisabled, publishPlan, toast, queuedFetch, disablePersistence]
  );

  const addCatalogItem = React.useCallback(
    async (tab: TreatmentPlanTab, item: CatalogItem) => {
      userTouchedRef.current = true;
      const nowIso = new Date().toISOString();
      const optimistic: TreatmentPlanEntry = {
        id: crypto.randomUUID(),
        tab,
        catalogRef: item.id,
        name: documentDisplayName(item),
        quantity: 1,
        unitPrice: Number(item.unitPrice || 0),
        lineTotal: Number((item.unitPrice || 0).toFixed(2)),
        meta: item.meta,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const prev = entries;
      publishPlan([...prev, optimistic]);
      await persistEntry(
        {
          id: optimistic.id,
          tab: optimistic.tab,
          catalogRef: optimistic.catalogRef,
          name: optimistic.name,
          quantity: optimistic.quantity,
          unitPrice: optimistic.unitPrice,
          meta: optimistic.meta,
        }
      );
    },
    [entries, persistEntry, publishPlan]
  );

  const removeEntry = React.useCallback(
    async (entry: TreatmentPlanEntry, retrying = false): Promise<void> => {
      userTouchedRef.current = true;
      removedIdsRef.current.add(entry.id);
      const prev = entries;
      const next = prev.filter((item) => item.id !== entry.id);
      if (!retrying) publishPlan(next);
      setDetailEntryId((id) => (id === entry.id ? null : id));
      setEditingDocumentEntryId((id) => (id === entry.id ? null : id));
      // A pending failed save for this entry is moot once the user removes it.
      setFailedSaves((failed) => {
        if (!(entry.id in failed)) return failed;
        const { [entry.id]: _dropped, ...rest } = failed;
        return rest;
      });
      if (persistenceDisabled) {
        return;
      }
      const pendingKey = `delete:${entry.id}`;
      setSavingIds((prev) => ({ ...prev, [pendingKey]: (prev[pendingKey] || 0) + 1 }));
      try {
        const response = await queuedFetch("/api/consultations/plan", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId, patientId, consultationId, entryId: entry.id }),
        });
        const data = await response.json().catch(() => ({}));
        const outcome = planWriteOutcome(response.ok, data);
        if (outcome === "local-only") {
          disablePersistence();
          return;
        }
        if (outcome === "failed") {
          throw new Error(data?.error || "Failed to delete entry");
        }
        if (persistenceDisabledRef.current) {
          return;
        }
        setFailedSaves((prev) => {
          const next = { ...prev };
          delete next[pendingKey];
          return next;
        });
        publishPlan(
          mergeUnsavedEntries(
            data.plan.entries as TreatmentPlanEntry[],
            entriesRef.current,
            new Set(Object.keys(failedSavesRef.current).filter((id) => id !== pendingKey))
          )
        );
      } catch (error) {
        if (!retrying) publishPlan(prev);
        // Retry replays this call; the self-reference is resolved at call time, after initialisation.
        // eslint-disable-next-line react-hooks/immutability
        setFailedSaves((prev) => ({ ...prev, [pendingKey]: () => removeEntry(entry, true) }));
        toast({
          title: "Autosave failed",
          description: error instanceof Error ? error.message : "Failed to delete treatment plan entry.",
          variant: "destructive",
        });
      } finally {
        setSavingIds((prev) => {
          const next = { ...prev };
          if (next[pendingKey] > 1) next[pendingKey]--;
          else delete next[pendingKey];
          return next;
        });
      }
    },
    [draftId, patientId, consultationId, entries, persistenceDisabled, publishPlan, toast, queuedFetch, disablePersistence]
  );

  function handlePickerRowClick(row: { tab: TreatmentPlanTab; item: CatalogItem; kindLabel: string }) {
    void addCatalogItem(row.tab, row.item);
    setSearchQuery("");
  }

  async function handleCompleteDocumentDialog(status: "draft" | "completed") {
    if (!editingDocumentEntry) return;
    if (editingDocumentKind === "referral" && !referralTo.trim()) {
      toast({ title: "Enter who the referral is addressed to", variant: "destructive" });
      return;
    }
    if (editingDocumentKind === "time-chit") {
      const error = timeChitError(tcDetails);
      if (error) {
        toast({ title: error, variant: "destructive" });
        return;
      }
    }
    await updateEntryField(editingDocumentEntry, {
      meta: {
        ...(editingDocumentEntry.meta || {}),
        documentStatus: status,
        ...(editingDocumentKind === "time-chit" ? { ...tcDetails, kind: "time-chit", tcHours: timeChitHours(tcDetails.tcTimeIn, tcDetails.tcTimeOut)! } : {}),
        ...(editingDocumentKind === "mc"
          ? { mcDays: String(mcDays), mcDiagnosis, mcStartDate, mcDoctorName, mcDoctorMmc, mcIncludeDiagnosis: mcIncludeDiagnosis ? "true" : "" }
          : {}),
        ...(editingDocumentKind === "referral" ? { referralTo, referralDiagnosis, referralContent, referralDoctorName, referralDoctorMmc } : {}),
      },
    });
    toast({
      title: status === "completed" ? "Document completed" : "Document saved as incomplete",
      description: `${editingDocumentEntry.name} updated.`,
    });
    setEditingDocumentEntryId(null);
    rememberSigner(
      editingDocumentKind === "time-chit" ? tcDetails.tcDoctorName : editingDocumentKind === "mc" ? mcDoctorName : referralDoctorName,
      editingDocumentKind === "time-chit" ? tcDetails.tcDoctorMmc : editingDocumentKind === "mc" ? mcDoctorMmc : referralDoctorMmc
    );
    setMcStartDate(clinicToday());
    setMcDoctorName("");
    setMcDoctorMmc("");
    setMcIncludeDiagnosis(false);
    setReferralDoctorName("");
    setReferralDoctorMmc("");
  }

  const updateEntryField = React.useCallback(
    async (entry: TreatmentPlanEntry, patch: Partial<TreatmentPlanEntryInput>) => {
      userTouchedRef.current = true;
      const prev = entries;
      const next = prev.map((item) => {
        if (item.id !== entry.id) return item;
        const quantity = Number(patch.quantity ?? item.quantity);
        const unitPrice = Number(patch.unitPrice ?? item.unitPrice);
        return {
          ...item,
          ...patch,
          quantity,
          unitPrice,
          lineTotal: Number((quantity * unitPrice).toFixed(2)),
          updatedAt: new Date().toISOString(),
        };
      });
      publishPlan(next);
      await persistEntry(
        {
          id: entry.id,
          tab: entry.tab,
          catalogRef: entry.catalogRef,
          name: (patch.name ?? entry.name) as string,
          quantity: Number(patch.quantity ?? entry.quantity),
          unitPrice: Number(patch.unitPrice ?? entry.unitPrice),
          instruction: patch.instruction ?? entry.instruction,
          dosage: patch.dosage ?? entry.dosage,
          frequency: patch.frequency ?? entry.frequency,
          duration: patch.duration ?? entry.duration,
          meta: patch.meta ?? entry.meta,
        }
      );
    },
    [entries, persistEntry, publishPlan]
  );

  const searchState = getCatalogSearchState({
    loading: loadingCatalog,
    query: searchQuery,
    resultCount: filteredPickerRows.length,
  });

  return (
    <div className="flex h-full flex-col md:sticky md:top-2">
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Search treatment catalog"
              placeholder="Search medicines, services, documents..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="pl-8"
            />
          </div>

          {searchState === "loading" ? (
            <p className="text-xs text-muted-foreground" role="status">Loading…</p>
          ) : null}
          {searchState === "empty" ? (
            <p className="text-xs text-muted-foreground">No matches.</p>
          ) : null}
          {filteredPickerRows.length > 0 ? (
            <div className="max-h-40 space-y-1 overflow-auto">
              {filteredPickerRows.map((row) => (
                <button
                  key={`${row.tab}-${row.item.id}`}
                  type="button"
                  className="w-full rounded-md border px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => handlePickerRowClick(row)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate">{documentDisplayName(row.item)}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        {row.kindLabel}
                      </Badge>
                      <span className="text-xs text-muted-foreground">RM {(row.item.unitPrice || 0).toFixed(2)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {poctEnabled && (
            <PoctSection entries={entries} query={searchQuery} onAdd={(item) => addCatalogItem("services", item)} />
          )}
          {pacsEnabled && (
            <XraySection entries={entries} query={searchQuery} onAdd={(item) => addCatalogItem("services", item)} />
          )}
          <div className="space-y-2">
            <p className="text-sm font-medium">Order</p>
            {sortedEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No line items yet.</p>
            ) : (
              sortedEntries.map((entry) => {
                const openEntry = () => {
                  if (entry.meta?.kind === "poct" || entry.meta?.kind === "xray") return;
                  const kind = documentKind({ id: entry.catalogRef || "", name: entry.name, meta: entry.meta });
                  if (entry.tab === "documents" && kind !== null) {
                                    const tcSigner = recallSigner();
                    setTcDetails({ tcDate: entry.meta?.tcDate || clinicToday(),
                      tcTimeIn: entry.meta?.tcTimeIn || "", tcTimeOut: entry.meta?.tcTimeOut || "",
                      tcDoctorName: entry.meta?.tcDoctorName || tcSigner.name, tcDoctorMmc: entry.meta?.tcDoctorMmc || tcSigner.mmc });
                    setMcDays(Number(entry.meta?.mcDays || 1));
                    setMcDiagnosis(entry.meta?.mcDiagnosis || "");
                    setMcStartDate(entry.meta?.mcStartDate || clinicToday());
                    const signer = recallSigner();
                    setMcDoctorName(entry.meta?.mcDoctorName || signer.name);
                    setMcDoctorMmc(entry.meta?.mcDoctorMmc || signer.mmc);
                    setMcIncludeDiagnosis(mcDiagnosisVisible({ mcIncludeDiagnosis: entry.meta?.mcIncludeDiagnosis }));
                    setReferralDoctorName(entry.meta?.referralDoctorName || signer.name);
                    setReferralDoctorMmc(entry.meta?.referralDoctorMmc || signer.mmc);
                    setReferralTo(entry.meta?.referralTo || "");
                    setReferralDiagnosis(entry.meta?.referralDiagnosis || defaultReferralDiagnosis);
                    setReferralContent(entry.meta?.referralContent || defaultReferralContent);
                    setEditingDocumentEntryId(entry.id);
                  } else {
                    setDetailEntryId(entry.id);
                  }
                };

                return (
                  <div
                    key={entry.id}
                    role="button"
                    tabIndex={0}
                    className="flex w-full items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-left text-sm hover:bg-muted/50"
                    onClick={openEntry}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openEntry();
                      }
                    }}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                        {entry.meta?.kind === "poct" ? "POCT" : entry.meta?.kind === "xray" ? "X-RAY" : kindLabelForTab(entry.tab)}
                      </Badge>
                      <span className="min-w-0"><span className="block truncate font-medium">{entry.name}</span>{entry.meta?.kind === "poct" && <span className="block truncate text-xs text-muted-foreground">Will run on {entry.meta.analyserName}</span>}{entry.meta?.kind === "xray" && <span className="block truncate text-xs text-muted-foreground">Will run on {entry.meta.deviceName}</span>}</span>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {entry.quantity} × RM {entry.unitPrice.toFixed(2)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${entry.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void removeEntry(entry);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="shrink-0 space-y-2 border-t bg-background pt-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>RM {summary.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>Total</span>
            <span>RM {summary.total.toFixed(2)}</span>
          </div>
          <Button type="submit" className="w-full" disabled={!hydrated || submitting || Object.keys(savingIds).length > 0 || Object.keys(failedSaves).length > 0 || !!saveErrorMessage}>
            {submitting ? "Saving…" : submitLabel}
          </Button>
          {persistDrafts ? (
            <div className="min-h-16 text-[11px] leading-4 text-muted-foreground">
              <p role="status" aria-live="polite" aria-atomic="true" data-testid="composer-save-status">
                {!hydrated
                  ? "Checking saved draft…"
                  : Object.keys(savingIds).length > 0
                  ? "Saving…"
                  : saveErrorMessage || Object.keys(failedSaves).length > 0
                  ? "Failed to save"
                  : persistenceDisabled
                  ? "Saved on this device only — on this screen; lost on reload. Sign to save to server."
                  : "Saved (server)"}
              </p>
              {hydrated && (saveErrorMessage || Object.keys(failedSaves).length > 0) ? (
                <button
                  type="button"
                  className="inline-flex min-h-8 items-center underline underline-offset-2"
                  disabled={Object.keys(savingIds).length > 0}
                  onClick={() => {
                    if (saveErrorMessage) {
                      setHydratedKey(null);
                      setLoadAttempt((attempt) => attempt + 1);
                    } else {
                      void (async () => {
                        for (const retry of Object.values(failedSaves)) await retry();
                      })();
                    }
                  }}
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <Dialog open={Boolean(editingDocumentEntry)} onOpenChange={(open) => !open && setEditingDocumentEntryId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{editingDocumentEntry?.name ?? "Document"}</DialogTitle>
            <DialogDescription>
              Fill out information below to complete document.
            </DialogDescription>
          </DialogHeader>
          {editingDocumentKind === "time-chit" && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                {([ ["tcDate", "Attendance date", "date"], ["tcTimeIn", "Time in", "time"], ["tcTimeOut", "Time out", "time"], ["tcDoctorName", "Doctor's name", "text"], ["tcDoctorMmc", "MMC registration no.", "text"] ] as const).map(([field, label, type]) => (
                  <div key={field}>
                    <Label htmlFor={`tc-${field}`}>{label}</Label>
                    <Input id={`tc-${field}`} type={type} value={tcDetails[field]}
                      onChange={e => setTcDetails(prev => ({ ...prev, [field]: e.target.value }))} />
                  </div>
                ))}
                <p className="text-sm">Duration: {timeChitHours(tcDetails.tcTimeIn, tcDetails.tcTimeOut) || "—"} hour(s)</p>
                {timeChitError(tcDetails) && <p className="text-xs text-muted-foreground">{timeChitError(tcDetails)}</p>}
              </div>
              <div className="space-y-2">
                <Button type="button" variant="outline" size="sm" onClick={() => printHtml(tcPreviewHtml)} disabled={Boolean(timeChitError(tcDetails))}>
                  Print Time Chit
                </Button>
                <iframe title="Time Chit preview" sandbox="" className="h-[420px] w-full rounded-lg border bg-white" srcDoc={tcPreviewHtml} />
              </div>
            </div>
          )}
          {editingDocumentKind === "mc" ? (
            <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
              <div className="space-y-3">
                <div>
                  <Label className="text-xs" htmlFor="mc-no-of-days">No of days</Label>
                  <Input id="mc-no-of-days"
                    type="number"
                    min="1"
                    value={mcDays}
                    onChange={(event) => {
                      userTouchedRef.current = true;
                      setMcDays(Number(event.target.value || 1));
                    }}
                  />
                </div>
                <div>
                  <Label className="text-xs" htmlFor="mc-start-date">Start date</Label>
                  <Input id="mc-start-date"
                    type="date"
                    value={mcStartDate}
                    onChange={(event) => {
                      userTouchedRef.current = true;
                      setMcStartDate(event.target.value);
                    }}
                  />
                </div>
                <div>
                  <Label className="text-xs" htmlFor="mc-doctors-name">Doctor&apos;s name</Label>
                  <Input id="mc-doctors-name"
                    placeholder="Dr. ..."
                    value={mcDoctorName}
                    onChange={(event) => {
                      userTouchedRef.current = true;
                      setMcDoctorName(event.target.value);
                    }}
                  />
                </div>
                <div>
                  <Label className="text-xs" htmlFor="mc-mmc-registration-no">MMC registration no.</Label>
                  <Input id="mc-mmc-registration-no"
                    placeholder="MMC no."
                    value={mcDoctorMmc}
                    onChange={(event) => {
                      userTouchedRef.current = true;
                      setMcDoctorMmc(event.target.value);
                    }}
                  />
                </div>
                <div>
                  <Label className="text-xs" htmlFor="mc-diagnosis">Diagnosis</Label>
                  <Input id="mc-diagnosis"
                    placeholder="Diagnosis"
                    value={mcDiagnosis}
                    onChange={(event) => {
                      userTouchedRef.current = true;
                      setMcDiagnosis(event.target.value);
                    }}
                  />
                  <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={mcIncludeDiagnosis}
                      onChange={(event) => {
                        userTouchedRef.current = true;
                        setMcIncludeDiagnosis(event.target.checked);
                      }}
                    />
                    Show diagnosis on the MC (hidden by default)
                  </label>
                </div>
                {mcPreviewHtml ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => printHtml(mcPreviewHtml)}>
                    Print MC
                  </Button>
                ) : null}
              </div>
              <div className="rounded-lg border overflow-hidden h-[420px]">
                {mcPreviewHtml ? (
                  <iframe srcDoc={mcPreviewHtml} className="w-full h-full" title="MC preview" />
                ) : (
                  <p className="p-4 text-sm text-muted-foreground" role="status">Preparing preview...</p>
                )}
              </div>
            </div>
          ) : null}
          {editingDocumentKind === "referral" ? (
            <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
              <div className="space-y-3">
                <div>
                  <Label className="text-xs" htmlFor="referral-to">Referral to:</Label>
                  <Input
                    id="referral-to"
                    placeholder="Hospital / clinic name"
                    aria-required="true"
                    value={referralTo}
                    onChange={(event) => {
                      userTouchedRef.current = true;
                      setReferralTo(event.target.value);
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Doctor&apos;s name</Label>
                    <Input
                      placeholder="Dr. ..."
                      value={referralDoctorName}
                      onChange={(event) => {
                        userTouchedRef.current = true;
                        setReferralDoctorName(event.target.value);
                      }}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">MMC registration no.</Label>
                    <Input
                      placeholder="MMC no."
                      value={referralDoctorMmc}
                      onChange={(event) => {
                        userTouchedRef.current = true;
                        setReferralDoctorMmc(event.target.value);
                      }}
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Diagnosis</Label>
                  <Input
                    placeholder="Diagnosis"
                    value={referralDiagnosis}
                    onChange={(event) => {
                      userTouchedRef.current = true;
                      setReferralDiagnosis(event.target.value);
                    }}
                  />
                </div>
                <div>
                  <Label className="text-xs">Compose content</Label>
                  <Textarea
                    className="min-h-[260px] leading-6"
                    value={referralContent}
                    onChange={(event) => {
                      userTouchedRef.current = true;
                      setReferralContent(event.target.value);
                    }}
                  />
                </div>
                {referralPreviewHtml ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => printHtml(referralPreviewHtml)}>
                    Print referral letter
                  </Button>
                ) : null}
              </div>
              <div className="rounded-lg border overflow-hidden h-[420px]">
                {referralPreviewHtml ? (
                  <iframe srcDoc={referralPreviewHtml} className="w-full h-full" title="Referral preview" />
                ) : (
                  <p className="p-4 text-sm text-muted-foreground" role="status">Preparing preview...</p>
                )}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            {editingDocumentKind === "referral" && (!referralDoctorName.trim() || !referralDoctorMmc.trim()) ? (
              <p className="mr-auto text-xs text-amber-700" role="status">
                Doctor name or MMC number is empty; the letter will print without it.
              </p>
            ) : null}
            <Button
              type="button"
              disabled={editingDocumentKind === "referral" && !referralTo.trim()}
              onClick={() => void handleCompleteDocumentDialog("completed")}
            >
              Complete document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(detailEntry)} onOpenChange={(open) => !open && setDetailEntryId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Line item</DialogTitle>
            <DialogDescription>{detailEntry?.name}</DialogDescription>
          </DialogHeader>
          {detailEntry ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{kindLabelForTab(detailEntry.tab)}</Badge>
              </div>
              <div>
                <Label className="text-xs">Name</Label>
                <Input
                  value={detailEntry.name}
                  onChange={(event) => {
                    userTouchedRef.current = true;
                    const next = entries.map((item) =>
                      item.id === detailEntry.id ? { ...item, name: event.target.value } : item
                    );
                    publishPlan(next);
                  }}
                  onBlur={(event) => void updateEntryField(detailEntry, { name: event.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Qty</Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={detailEntry.quantity}
                    onChange={(event) => {
                      userTouchedRef.current = true;
                      const value = Number(event.target.value || 0);
                      const next = entries.map((item) =>
                        item.id === detailEntry.id
                          ? {
                              ...item,
                              quantity: value,
                              lineTotal: Number((value * item.unitPrice).toFixed(2)),
                            }
                          : item
                      );
                      publishPlan(next);
                    }}
                    onBlur={(event) =>
                      void updateEntryField(detailEntry, { quantity: Number(event.target.value || 0) })
                    }
                  />
                </div>
                <div>
                  <Label className="text-xs">Unit Price</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={detailEntry.unitPrice}
                    onChange={(event) => {
                      userTouchedRef.current = true;
                      const value = Number(event.target.value || 0);
                      const next = entries.map((item) =>
                        item.id === detailEntry.id
                          ? {
                              ...item,
                              unitPrice: value,
                              lineTotal: Number((value * item.quantity).toFixed(2)),
                            }
                          : item
                      );
                      publishPlan(next);
                    }}
                    onBlur={(event) =>
                      void updateEntryField(detailEntry, { unitPrice: Number(event.target.value || 0) })
                    }
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Instruction</Label>
                <Input
                  placeholder="Instruction"
                  value={detailEntry.instruction || ""}
                  onChange={(event) => {
                    userTouchedRef.current = true;
                    const next = entries.map((item) =>
                      item.id === detailEntry.id ? { ...item, instruction: event.target.value } : item
                    );
                    publishPlan(next);
                  }}
                  onBlur={(event) => void updateEntryField(detailEntry, { instruction: event.target.value })}
                />
              </div>
              {(detailEntry.tab === "items" || detailEntry.tab === "services") && (
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    placeholder="Dosage"
                    value={detailEntry.dosage || ""}
                    onChange={(event) => {
                      userTouchedRef.current = true;
                      const next = entries.map((item) =>
                        item.id === detailEntry.id ? { ...item, dosage: event.target.value } : item
                      );
                      publishPlan(next);
                    }}
                    onBlur={(event) => void updateEntryField(detailEntry, { dosage: event.target.value })}
                  />
                  <Input
                    placeholder="Frequency"
                    value={detailEntry.frequency || ""}
                    onChange={(event) => {
                      userTouchedRef.current = true;
                      const next = entries.map((item) =>
                        item.id === detailEntry.id ? { ...item, frequency: event.target.value } : item
                      );
                      publishPlan(next);
                    }}
                    onBlur={(event) => void updateEntryField(detailEntry, { frequency: event.target.value })}
                  />
                  <Input
                    placeholder="Duration"
                    value={detailEntry.duration || ""}
                    onChange={(event) => {
                      userTouchedRef.current = true;
                      const next = entries.map((item) =>
                        item.id === detailEntry.id ? { ...item, duration: event.target.value } : item
                      );
                      publishPlan(next);
                    }}
                    onBlur={(event) => void updateEntryField(detailEntry, { duration: event.target.value })}
                  />
                </div>
              )}
              <p className="text-right text-xs text-muted-foreground">
                Line total: RM {detailEntry.lineTotal.toFixed(2)}
              </p>
            </div>
          ) : null}
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="destructive" onClick={() => detailEntry && void removeEntry(detailEntry)}>
              <Trash2 className="mr-2 h-4 w-4" />
              Remove
            </Button>
            <Button type="button" variant="default" onClick={() => setDetailEntryId(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
