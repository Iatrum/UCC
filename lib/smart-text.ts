import { format } from "date-fns";

import { getConsultationsByPatientId, type Consultation } from "./models";

type MaybeDate = Date | string | null | undefined;

export type SmartTextPatient = {
  fullName?: string | null;
  lastVisit?: MaybeDate;
  medicalHistory?: {
    allergies?: string[];
    conditions?: string[];
    medications?: string[];
  };
};

export type SmartTextContext = {
  patientId: string | null;
  patient?: SmartTextPatient | null;
};

export type SmartTextResult = {
  text: string;
  meta?: string;
};

export type SmartTextCommand = {
  key: string;
  label: string;
  description?: string;
  run: (context: SmartTextContext) => Promise<SmartTextResult>;
};

const consultationCache = new Map<string, Consultation[]>();

async function getConsultationsCached(patientId: string): Promise<Consultation[]> {
  if (consultationCache.has(patientId)) {
    return consultationCache.get(patientId)!;
  }
  const consultations = await getConsultationsByPatientId(patientId);
  const sorted = consultations
    .slice()
    .sort((a, b) => (toDate(b.date)?.getTime() ?? 0) - (toDate(a.date)?.getTime() ?? 0));
  consultationCache.set(patientId, sorted);
  return sorted;
}

function toDate(value: MaybeDate): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function truncateSingleLine(text: string, max = 160): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }
  if (cleaned.length <= max) {
    return cleaned;
  }
  return `${cleaned.slice(0, max - 1)}…`;
}

function formatConsultationLine(consultation: Consultation): string {
  const visitDate = toDate(consultation.date);
  const prefix = visitDate ? format(visitDate, "d MMM yyyy") : "Unknown date";
  const fragments: string[] = [];

  if (consultation.diagnosis) {
    fragments.push(`Dx: ${truncateSingleLine(consultation.diagnosis, 80)}`);
  }
  if (consultation.chiefComplaint) {
    fragments.push(`CC: ${truncateSingleLine(consultation.chiefComplaint, 80)}`);
  }
  if (consultation.notes) {
    const noteSnippet = truncateSingleLine(consultation.notes);
    if (noteSnippet) {
      fragments.push(noteSnippet);
    }
  }
  if (consultation.prescriptions && consultation.prescriptions.length > 0) {
    const meds = consultation.prescriptions
      .map((prescription) => prescription.medication?.name)
      .filter((name): name is string => Boolean(name));
    if (meds.length > 0) {
      fragments.push(`Rx: ${meds.slice(0, 3).join(", ")}`);
    }
  }

  if (fragments.length === 0) {
    fragments.push("No additional details recorded.");
  }

  return `${prefix} — ${fragments.join(" | ")}`;
}

type VitalSnapshot = {
  recordedAt: Date | null;
  bp?: string;
  hr?: string;
  rr?: string;
  temp?: string;
  spo2?: string;
  weight?: string;
};

function extractVitalsFromText(blob: string): Partial<VitalSnapshot> {
  const text = blob;
  const snapshot: Partial<VitalSnapshot> = {};

  const bpMatch = text.match(/(?:BP|Blood Pressure)\s*[:=]?\s*(\d{2,3}\s*\/\s*\d{2,3})(?:\s*(mmHg))?/i);
  if (bpMatch) {
    snapshot.bp = bpMatch[1].replace(/\s+/g, "") + (bpMatch[2] ? ` ${bpMatch[2]}` : " mmHg");
  }

  const hrMatch = text.match(/(?:HR|Heart Rate|Pulse)\s*[:=]?\s*(\d{2,3})(?:\s*(?:bpm))?/i);
  if (hrMatch) {
    snapshot.hr = `${hrMatch[1]} bpm`;
  }

  const rrMatch = text.match(/(?:RR|Resp(?:iratory)? Rate)\s*[:=]?\s*(\d{2})(?:\s*(?:\/min|bpm))?/i);
  if (rrMatch) {
    snapshot.rr = `${rrMatch[1]} /min`;
  }

  const tempMatch = text.match(/(?:Temp(?:erature)?|T)\s*[:=]?\s*(\d{2}(?:\.\d)?)(?:\s*°?\s*([CF]))?/i);
  if (tempMatch) {
    const unit = tempMatch[2] ? tempMatch[2].toUpperCase() : "C";
    snapshot.temp = `${tempMatch[1]} °${unit}`;
  }

  const spo2Match = text.match(/(?:SpO2|O2 Sat|SaO2)\s*[:=]?\s*(\d{2,3})(?:\s*%?)/i);
  if (spo2Match) {
    snapshot.spo2 = `${spo2Match[1]} %`;
  }

  const weightMatch = text.match(/(?:Wt|Weight)\s*[:=]?\s*(\d{2,3}(?:\.\d)?)(?:\s*(?:kg|kgs|kilograms?))?/i);
  if (weightMatch) {
    snapshot.weight = `${weightMatch[1]} kg`;
  }

  return snapshot;
}

function getLatestVitals(consultations: Consultation[]): VitalSnapshot | null {
  for (const consultation of consultations) {
    const blob = [
      consultation.notes,
      consultation.chiefComplaint,
      consultation.diagnosis,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" ");

    if (!blob) {
      continue;
    }

    const parsed = extractVitalsFromText(blob);
    const hasValue = Object.values(parsed).some(Boolean);
    if (!hasValue) {
      continue;
    }

    return {
      recordedAt: toDate(consultation.date),
      ...parsed,
    };
  }

  return null;
}

function buildHistorySummary(patient?: SmartTextPatient | null): string | null {
  if (!patient?.medicalHistory) {
    return null;
  }

  const sections: string[] = [];

  if (patient.medicalHistory.conditions && patient.medicalHistory.conditions.length > 0) {
    sections.push(`Chronic conditions: ${patient.medicalHistory.conditions.join(", ")}`);
  }

  if (patient.medicalHistory.medications && patient.medicalHistory.medications.length > 0) {
    sections.push(`Long-term meds: ${patient.medicalHistory.medications.join(", ")}`);
  }

  if (patient.medicalHistory.allergies && patient.medicalHistory.allergies.length > 0) {
    sections.push(`Allergies: ${patient.medicalHistory.allergies.join(", ")}`);
  }

  if (sections.length === 0) {
    return null;
  }

  return sections.join("\n");
}

const summaryCommand: SmartTextCommand = {
  key: ".summary",
  label: "Previous visit summary",
  description: "Summarize the most recent consultations for this patient.",
  async run(context) {
    if (!context.patientId) {
      return {
        text: "Previous consultations: patient context not available.",
        meta: "No patient selected.",
      };
    }

    try {
      const aiSummary = await requestAiSummary(context.patientId);
      if (aiSummary) {
        return {
          text: aiSummary.text,
          meta: aiSummary.meta ?? "AI summary generated.",
        };
      }
    } catch (error) {
      console.error("AI smart text summary failed:", error);
    }

    return buildFallbackSummary(context);
  },
};

const vitalsCommand: SmartTextCommand = {
  key: ".vs",
  label: "Vital signs",
  description: "Insert the latest documented vital signs or a template.",
  async run(context) {
    if (!context.patientId) {
      return {
        text: [
          "Vital signs:",
          "- BP: ___",
          "- HR: ___",
          "- RR: ___",
          "- Temp: ___",
          "- SpO2: ___",
          "- Weight: ___",
        ].join("\n"),
        meta: "No patient selected, inserted blank template.",
      };
    }

    const consultations = await getConsultationsCached(context.patientId);
    const latest = getLatestVitals(consultations);

    const defaultTemplate = [
      "Vital signs:",
      "- BP: ___",
      "- HR: ___",
      "- RR: ___",
      "- Temp: ___",
      "- SpO2: ___",
      "- Weight: ___",
      "",
      "(No structured vitals found. Update as needed.)",
    ].join("\n");

    if (!latest) {
      return {
        text: defaultTemplate,
        meta: "No vitals detected in past notes.",
      };
    }

    const dateLabel = latest.recordedAt ? format(latest.recordedAt, "d MMM yyyy") : "most recent note";

    const lines = [
      `Vital signs (${dateLabel}):`,
      `- BP: ${latest.bp ?? "___"}`,
      `- HR: ${latest.hr ?? "___"}`,
      `- RR: ${latest.rr ?? "___"}`,
      `- Temp: ${latest.temp ?? "___"}`,
      `- SpO2: ${latest.spo2 ?? "___"}`,
      `- Weight: ${latest.weight ?? "___"}`,
    ];

    return {
      text: lines.join("\n"),
      meta: "Latest vitals pulled from consultation history.",
    };
  },
};

export const defaultSmartTextCommands: Record<string, SmartTextCommand> = {
  [summaryCommand.key]: summaryCommand,
  [vitalsCommand.key]: vitalsCommand,
};

export async function executeSmartTextCommand(
  key: string,
  context: SmartTextContext
): Promise<SmartTextResult | null> {
  // Check built-in commands first
  const command = defaultSmartTextCommands[key];
  if (command) {
    return command.run(context);
  }

  // Custom Smart Text is disabled until its storage path is finalized.
  return null;
}

export function resetSmartTextCache(patientId?: string) {
  if (patientId) {
    consultationCache.delete(patientId);
    return;
  }
  consultationCache.clear();
}

type AiSummaryResponse = {
  text: string;
  meta?: string;
};

async function requestAiSummary(patientId: string, limit = 5): Promise<AiSummaryResponse | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch("/api/smart-text/summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ patientId, limit }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Summary request failed (${response.status})`);
    }

    const data = (await response.json().catch(() => null)) as
      | { summary?: string; meta?: string | null }
      | null;

    const summary = typeof data?.summary === "string" ? data.summary.trim() : "";
    if (!summary) {
      throw new Error("Summary response empty");
    }

    return {
      text: summary,
      meta: typeof data?.meta === "string" ? data.meta : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function buildFallbackSummary(context: SmartTextContext, limit = 3): Promise<SmartTextResult> {
  if (!context.patientId) {
    return {
      text: "Previous consultations: patient context not available.",
      meta: "No patient selected.",
    };
  }

  const consultations = await getConsultationsCached(context.patientId);

  if (!consultations || consultations.length === 0) {
    return {
      text: "Previous consultations: none recorded in the system.",
      meta: "No past consultations found.",
    };
  }

  const recent = consultations.slice(0, limit);
  const lines = recent.map(formatConsultationLine);
  const history = buildHistorySummary(context.patient);

  const parts = [`Previous consultations (${lines.length}):`, ...lines.map((line) => `- ${line}`)];

  if (history) {
    parts.push("", history);
  }

  const lastVisit = toDate(context.patient?.lastVisit ?? consultations[0]?.date);
  const metaDate = lastVisit ? format(lastVisit, "d MMM yyyy") : "recent visits";

  return {
    text: parts.join("\n"),
    meta: `Fallback summary from ${lines.length} recent visit${lines.length === 1 ? "" : "s"} (${metaDate}).`,
  };
}
