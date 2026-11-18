/** Pure aggregation helpers for Analytics (no I/O, unit-tested). */
import type { Encounter } from "@medplum/fhirtypes";
import { mytHour, mytWeekday, mytYmd } from "./range";

export const TRIAGE_ENCOUNTER_EXTENSION_URL = "https://ucc.emr/triage-encounter";
export const WAIT_TARGET_MIN = 15;
const MAX_WAIT_MIN = 8 * 60;

export type EncounterLite = {
  id: string;
  patientKey: string;
  start: Date;
  isTriage: boolean;
  queueAt?: Date;
};

export function toEncounterLite(enc: Encounter): EncounterLite | null {
  if (!enc.id || !enc.period?.start) return null;
  const start = new Date(enc.period.start);
  if (isNaN(start.getTime())) return null;
  const triageExt = enc.extension?.find((e) => e.url === TRIAGE_ENCOUNTER_EXTENSION_URL);
  const q = triageExt?.extension?.find((e) => e.url === "queueAddedAt")?.valueDateTime;
  const queueAt = q ? new Date(q) : undefined;
  const patientKey =
    enc.subject?.reference ||
    enc.identifier?.find((i) => i.system === "firebase-patient")?.value ||
    enc.id;
  return { id: enc.id, patientKey, start, isTriage: Boolean(triageExt), queueAt: queueAt && !isNaN(queueAt.getTime()) ? queueAt : undefined };
}

export type DayPoint = { day: string; value: number };

export type VisitStats = {
  /** Unique patients per MYT day. */
  patientsByDay: Record<string, number>;
  /** Saved consultations per MYT day. */
  consultationsByDay: Record<string, number>;
  /** Weekday (0=Mon) x hour (0-23) arrival counts, one per patient-day. */
  heatmap: number[][];
  /** Average wait (min) per day, only days that have samples. */
  waitByDay: Record<string, number>;
  waitSamples: number;
  avgWait: number | null;
};

export function computeVisitStats(encs: EncounterLite[]): VisitStats {
  const byPatientDay = new Map<string, EncounterLite[]>();
  const consultationsByDay: Record<string, number> = {};
  for (const e of encs) {
    const day = mytYmd(e.start);
    const key = `${e.patientKey}|${day}`;
    (byPatientDay.get(key) ?? byPatientDay.set(key, []).get(key)!).push(e);
    if (!e.isTriage) consultationsByDay[day] = (consultationsByDay[day] ?? 0) + 1;
  }
  const patientsByDay: Record<string, number> = {};
  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const waitSum: Record<string, number> = {};
  const waitN: Record<string, number> = {};
  let totalWait = 0;
  let samples = 0;
  for (const [key, list] of byPatientDay) {
    const day = key.slice(key.lastIndexOf("|") + 1);
    patientsByDay[day] = (patientsByDay[day] ?? 0) + 1;
    const queueAt = list.map((e) => e.queueAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
    const earliest = list.reduce((m, e) => (e.start < m ? e.start : m), list[0].start);
    const arrival = queueAt ?? earliest;
    heatmap[mytWeekday(arrival)][mytHour(arrival)]++;
    if (queueAt) {
      const consult = list.filter((e) => !e.isTriage).sort((a, b) => a.start.getTime() - b.start.getTime())[0];
      const wait = consult ? Math.round((consult.start.getTime() - queueAt.getTime()) / 60_000) : NaN;
      if (wait > 0 && wait <= MAX_WAIT_MIN) {
        waitSum[day] = (waitSum[day] ?? 0) + wait;
        waitN[day] = (waitN[day] ?? 0) + 1;
        totalWait += wait;
        samples++;
      }
    }
  }
  const waitByDay: Record<string, number> = {};
  for (const d of Object.keys(waitSum)) waitByDay[d] = Math.round(waitSum[d] / waitN[d]);
  return { patientsByDay, consultationsByDay, heatmap, waitByDay, waitSamples: samples, avgWait: samples ? Math.round(totalWait / samples) : null };
}

export function series(keys: string[], map: Record<string, number>): DayPoint[] {
  return keys.map((day) => ({ day, value: map[day] ?? 0 }));
}
export const sumSeries = (pts: DayPoint[]) => pts.reduce((s, p) => s + p.value, 0);

/** Percent change vs previous; null when previous is 0 (no meaningful baseline). */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export type NameValue = { name: string; value: number };

export function topCounts(names: Array<string | undefined>, limit: number): NameValue[] {
  const counts = new Map<string, { name: string; value: number }>();
  for (const raw of names) {
    const name = raw?.trim();
    if (!name) continue;
    const k = name.toLowerCase();
    const cur = counts.get(k);
    if (cur) cur.value++;
    else counts.set(k, { name, value: 1 });
  }
  return [...counts.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)).slice(0, limit);
}

const ANTIBIOTIC = /\b(amoxicillin|amoxycillin|amoxiclav|augmentin|co-?amoxiclav|ampicillin|penicillin|cloxacillin|flucloxacillin|cefalexin|cephalexin|cefuroxime|cefixime|cefadroxil|ceftriaxone|azithromycin|clarithromycin|erythromycin|doxycycline|tetracycline|ciprofloxacin|levofloxacin|norfloxacin|ofloxacin|metronidazole|clindamycin|cotrimoxazole|co-?trimoxazole|trimethoprim|nitrofurantoin|gentamicin|fusidic)\b/i;
/** Name-based heuristic: no ATC/RxNorm class is stored on the prescription. */
export const isAntibiotic = (name?: string) => !!name && ANTIBIOTIC.test(name);

export type AgeBucket = "0-17" | "18-39" | "40-64" | "65+";
export const AGE_BUCKETS: AgeBucket[] = ["0-17", "18-39", "40-64", "65+"];

/** Document kind stored as JSON in Procedure.note[0].text. */
export function documentKind(note?: string): string | null {
  if (!note || note[0] !== "{") return null;
  try {
    const k = JSON.parse(note)?.kind;
    return typeof k === "string" ? k : null;
  } catch {
    return null;
  }
}

export type RevenueSource = "konsultasi" | "ubat" | "prosedur" | "lab" | "xray" | "lain";
export const REVENUE_SOURCES: Array<{ key: RevenueSource; label: string }> = [
  { key: "konsultasi", label: "Konsultasi" },
  { key: "ubat", label: "Ubat" },
  { key: "prosedur", label: "Prosedur" },
  { key: "lab", label: "Lab/POCT" },
  { key: "xray", label: "X-ray" },
  { key: "lain", label: "Dokumen & lain" },
];

/** Classify an invoice line from its checkout item type and name (Lab:/Imaging: prefixes are written by the composer). */
export function classifyLine(type: string | undefined, name: string | undefined): RevenueSource {
  const n = (name ?? "").trim();
  if (type === "Item") return "ubat";
  if (/^imaging:|x-?ray|radiograph/i.test(n)) return "xray";
  if (/^lab:|poct|glucose|hba1c|\bcbc\b|full blood|\blft\b/i.test(n)) return "lab";
  if (type === "Document" || type === "Package") return "lain";
  if (/consult|konsultasi|doctor|review|visit/i.test(n)) return "konsultasi";
  return "prosedur";
}
