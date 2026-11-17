/**
 * Bounded, clinic-scoped Medplum queries behind the Analytics tabs (Task 551).
 *
 * Rules: every search carries `identifier=clinic|<id>` and is re-filtered with resourceMatchesClinicTenant;
 * every search is date-bounded, paged with a hard cap and trimmed with _elements; counts use _summary=count.
 * No result values (Observation/DiagnosticReport) are ever read: investigations are ORDER COUNTS only.
 */
import type { MedplumClient } from "@medplum/core";
import type { Appointment, Communication, Condition, Invoice, MedicationDispense, MedicationRequest, Procedure, ServiceRequest, Encounter } from "@medplum/fhirtypes";
import { CLINIC_IDENTIFIER_SYSTEM, resourceMatchesClinicTenant } from "@/lib/fhir/clinic-tenancy";
import { REGISTERED_TAG_SYSTEM } from "@/lib/fhir/patient-registration";
import { POCT_TAG_SYSTEM } from "@/lib/fhir/poct-device";
import { getInventoryMedicationsFromMedplum } from "@/lib/fhir/inventory-service";
import {
  AGE_BUCKETS, REVENUE_SOURCES, WAIT_TARGET_MIN, classifyLine, computeVisitStats, documentKind, isAntibiotic,
  pctChange, series, sumSeries, toEncounterLite, topCounts,
  type EncounterLite, type NameValue, type RevenueSource,
} from "./aggregate";
import { addDays, dayKeys, dayLabel, monthLabel, mytDayStart, mytMonthStart, mytYmd, resolveRange, type RangeKey, type ResolvedRange } from "./range";

const PAGE = 1000;

type Params = Record<string, string | string[]>;
function toQuery(p: Params): URLSearchParams {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) for (const x of Array.isArray(v) ? v : [v]) q.append(k, x);
  return q;
}
const clinicIdent = (clinicId: string) => `${CLINIC_IDENTIFIER_SYSTEM}|${clinicId}`;
const between = (from: Date, to: Date) => [`ge${from.toISOString()}`, `lt${to.toISOString()}`];

export type Bounded<T> = { rows: T[]; truncated: boolean };

async function searchBounded<T extends { resourceType: string }>(
  medplum: MedplumClient, type: string, clinicId: string, params: Params, maxPages = 3,
): Promise<Bounded<T>> {
  const rows: T[] = [];
  let truncated = false;
  for (let page = 0; page < maxPages; page++) {
    const batch = (await medplum.searchResources(type as never, toQuery({
      ...params, identifier: clinicIdent(clinicId), _count: String(PAGE), _offset: String(page * PAGE), _sort: "_lastUpdated",
    }) as never)) as unknown as T[];
    rows.push(...batch.filter((r) => resourceMatchesClinicTenant(r as never, clinicId)));
    if (batch.length < PAGE) return { rows, truncated };
    if (page === maxPages - 1) truncated = true;
  }
  return { rows, truncated };
}

async function count(medplum: MedplumClient, type: string, params: Params): Promise<number> {
  const bundle = await medplum.search(type as never, toQuery({ ...params, _summary: "count", _total: "accurate" }) as never);
  return typeof bundle.total === "number" ? bundle.total : 0;
}

/** Optional sources must not blank a whole tab: log, flag and continue with an empty list. */
async function optional<T>(label: string, load: Promise<Bounded<T>>): Promise<Bounded<T> & { failed?: boolean }> {
  try {
    return await load;
  } catch (error) {
    console.warn(`[analytics] ${label} unavailable:`, error instanceof Error ? error.message : error);
    return { rows: [], truncated: false, failed: true };
  }
}

/* -------- tiny TTL cache with in-flight de-dup (per clinic) -------- */
const cache = new Map<string, { exp: number; value: Promise<unknown> }>();
export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return hit.value as Promise<T>;
  const value = load().catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { exp: now + ttlMs, value });
  if (cache.size > 300) for (const [k, v] of cache) if (v.exp <= now) cache.delete(k);
  return value;
}
export const CACHE_MS = 60_000;
export const SLOW_CACHE_MS = 5 * 60_000;
export function clearAnalyticsCache() { cache.clear(); }

/* -------- shared bounded loaders (cached per clinic + window) -------- */
const winKey = (from: Date, to: Date) => `${mytYmd(from)}_${mytYmd(to)}`;

function loadEncounters(medplum: MedplumClient, clinicId: string, from: Date, to: Date) {
  return cached(`${clinicId}|enc|${winKey(from, to)}`, CACHE_MS, async () => {
    const r = await searchBounded<Encounter>(medplum, "Encounter", clinicId, {
      date: between(from, to), _elements: "period,subject,identifier,extension,meta",
    }, 5);
    return { rows: r.rows.map(toEncounterLite).filter((e): e is EncounterLite => !!e), truncated: r.truncated };
  });
}

function invoiceTotal(inv: Invoice): number {
  return Number(inv.totalGross?.value ?? inv.totalNet?.value ?? 0) || 0;
}
const validInvoice = (inv: Invoice) => !!inv.date && !["cancelled", "entered-in-error", "draft"].includes(inv.status);

function loadInvoices(medplum: MedplumClient, clinicId: string, from: Date, to: Date, withLines: boolean) {
  return cached(`${clinicId}|inv${withLines ? "L" : ""}|${winKey(from, to)}`, CACHE_MS, async () => {
    const r = await searchBounded<Invoice>(medplum, "Invoice", clinicId, {
      date: between(from, to),
      _elements: `date,status,totalGross,totalNet,identifier,meta${withLines ? ",lineItem" : ""}`,
    }, 6);
    return { rows: r.rows.filter(validInvoice), truncated: r.truncated };
  });
}

const dayOfInvoice = (inv: Invoice) => mytYmd(new Date(inv.date!));
const sixMonthStart = (now: Date) => mytMonthStart(now, 5);

export type KpiSeries = { day: string; label: string; value: number }[];
const toSeries = (keys: string[], map: Record<string, number>): KpiSeries =>
  series(keys, map).map((p) => ({ ...p, label: dayLabel(p.day) }));

/* ============================== Ringkasan ============================== */
export async function getSummary(medplum: MedplumClient, clinicId: string, key: RangeKey, now = new Date()) {
  const r = resolveRange(key, now);
  const today = mytDayStart(now);
  const encFrom = new Date(Math.min(r.prevFrom.getTime(), addDays(today, -27).getTime()));
  const [enc, inv, totalPatients, followUpsOpen] = await Promise.all([
    loadEncounters(medplum, clinicId, encFrom, r.to),
    loadInvoices(medplum, clinicId, sixMonthStart(now), r.to, false),
    count(medplum, "Patient", { active: "true", identifier: clinicIdent(clinicId) }).catch(() => null),
    count(medplum, "Communication", {
      identifier: clinicIdent(clinicId),
      status: "preparation,in-progress",
      category: "https://ucc.emr/communication-category|review-request,https://ucc.emr/communication-category|appointment-reminder",
    }).catch(() => null),
  ]);

  const stats = computeVisitStats(enc.rows);
  const rangeKeys = dayKeys(r.from, r.to);
  const prevKeys = dayKeys(r.prevFrom, r.prevTo);
  const chartDays = Math.max(r.days, 7);
  const chartKeys = dayKeys(addDays(r.to, -chartDays), r.to);

  const rev: Record<string, number> = {};
  const monthly: Record<string, number> = {};
  for (const i of inv.rows) {
    const d = dayOfInvoice(i);
    rev[d] = (rev[d] ?? 0) + invoiceTotal(i);
    monthly[d.slice(0, 7)] = (monthly[d.slice(0, 7)] ?? 0) + invoiceTotal(i);
  }
  const revSeries = series(rangeKeys, rev);
  const revenue = round2(sumSeries(revSeries));
  const revenuePrev = round2(sumSeries(series(prevKeys, rev)));
  const consSeries = series(rangeKeys, stats.consultationsByDay);
  const consultations = sumSeries(consSeries);
  const consultationsPrev = sumSeries(series(prevKeys, stats.consultationsByDay));
  const todayKey = mytYmd(now);
  const yesterdayKey = mytYmd(addDays(today, -1));

  const months = Array.from({ length: 6 }, (_, i) => mytMonthStart(now, 5 - i));
  const revenueMonthly = months.map((m) => ({ name: monthLabel(m), value: round2(monthly[mytYmd(m).slice(0, 7)] ?? 0) }));

  // Top diagnoses in range (Condition has its own clinic identifier + recordedDate).
  const conds = await loadConditions(medplum, clinicId, r.from, r.to);
  const topDiagnoses = topCounts(conds.rows.map(conditionName), 6);

  const waitKeys = dayKeys(addDays(r.to, -Math.max(r.days, 14)), r.to);
  return {
    range: rangeMeta(r),
    truncated: enc.truncated || inv.truncated || conds.truncated,
    kpis: {
      patientsToday: { value: stats.patientsByDay[todayKey] ?? 0, deltaVsYesterday: (stats.patientsByDay[todayKey] ?? 0) - (stats.patientsByDay[yesterdayKey] ?? 0), series: toSeries(rangeKeys.length > 1 ? rangeKeys : chartKeys, stats.patientsByDay) },
      consultations: { value: consultations, prev: consultationsPrev, pct: pctChange(consultations, consultationsPrev), series: toSeries(chartKeys, stats.consultationsByDay) },
      revenue: { value: revenue, prev: revenuePrev, pct: pctChange(revenue, revenuePrev), series: toSeries(chartKeys, rev), sixMonths: round2(Object.values(monthly).reduce((a, b) => a + b, 0)) },
      wait: { avg: stats.avgWait, samples: stats.waitSamples, target: WAIT_TARGET_MIN, series: waitKeys.map((d) => ({ day: d, label: dayLabel(d), value: stats.waitByDay[d] ?? null })) },
      totalPatients, followUpsOpen,
    },
    revenueMonthly,
    visitsByDay: toSeries(chartKeys, stats.patientsByDay),
    heatmap: { matrix: stats.heatmap, days: 28, total: stats.heatmap.flat().reduce((a, b) => a + b, 0) },
    topDiagnoses,
  };
}

function loadConditions(medplum: MedplumClient, clinicId: string, from: Date, to: Date) {
  return cached(`${clinicId}|cond|${winKey(from, to)}`, CACHE_MS, () =>
    searchBounded<Condition>(medplum, "Condition", clinicId, { "recorded-date": between(from, to), _elements: "code,recordedDate,identifier,meta" }, 3));
}
const conditionName = (c: Condition) => c.code?.text || c.code?.coding?.[0]?.display;

const round2 = (n: number) => Math.round(n * 100) / 100;
const rangeMeta = (r: ResolvedRange) => ({ key: r.key, from: r.from.toISOString(), to: r.to.toISOString(), days: r.days });

/* =============================== Klinikal =============================== */
function ageCutoffs(now: Date) {
  const iso = (years: number) => { const d = new Date(now); d.setUTCFullYear(d.getUTCFullYear() - years); return mytYmd(d); };
  return { y18: iso(18), y40: iso(40), y65: iso(65) };
}

export async function getClinical(medplum: MedplumClient, clinicId: string, key: RangeKey, now = new Date()) {
  const r = resolveRange(key, now);
  const today = mytDayStart(now);
  const trendWeeks = 12;
  const weekStart = addDays(today, -(trendWeeks * 7 - 1));
  const condFrom = new Date(Math.min(r.prevFrom.getTime(), weekStart.getTime()));
  const ci = clinicIdent(clinicId);
  const { y18, y40, y65 } = ageCutoffs(now);
  const base = { active: "true", identifier: ci };
  const ageQ: Record<string, Params> = {
    "0-17": { birthdate: `gt${y18}` },
    "18-39": { birthdate: [`gt${y40}`, `le${y18}`] },
    "40-64": { birthdate: [`gt${y65}`, `le${y40}`] },
    "65+": { birthdate: `le${y65}` },
  };

  const [enc, conds, rx, procs, orders, dispenses, fuDone, fuOpen, fuStopped, fuStale, ageGender] = await Promise.all([
    loadEncounters(medplum, clinicId, r.prevFrom, r.to),
    loadConditions(medplum, clinicId, condFrom, r.to),
    optional("medication requests", cached(`${clinicId}|rx|${winKey(r.prevFrom, r.to)}`, CACHE_MS, () =>
      searchBounded<MedicationRequest>(medplum, "MedicationRequest", clinicId, { authoredon: between(r.prevFrom, r.to), _elements: "medicationCodeableConcept,encounter,authoredOn,identifier,meta" }, 3))),
    optional("procedures", cached(`${clinicId}|proc|${winKey(r.from, r.to)}`, CACHE_MS, () =>
      searchBounded<Procedure>(medplum, "Procedure", clinicId, { date: between(r.from, r.to), _elements: "note,identifier,meta" }, 3))),
    optional("service requests", cached(`${clinicId}|sr|${winKey(r.from, r.to)}`, CACHE_MS, () =>
      searchBounded<ServiceRequest>(medplum, "ServiceRequest", clinicId, { authored: between(r.from, r.to), _elements: "category,authoredOn,identifier,meta" }, 3))),
    optional("dispenses", cached(`${clinicId}|disp|${winKey(r.from, r.to)}`, CACHE_MS, () =>
      searchBounded<MedicationDispense>(medplum, "MedicationDispense", clinicId, { status: "completed", _lastUpdated: between(r.from, r.to), _elements: "medicationReference,quantity,status,identifier,meta" }, 3))),
    followUpCount(medplum, clinicId, "completed", r),
    followUpCount(medplum, clinicId, "preparation,in-progress", r),
    followUpCount(medplum, clinicId, "stopped", r),
    count(medplum, "Communication", { identifier: ci, status: "preparation,in-progress", _lastUpdated: `lt${addDays(now, -14).toISOString()}`, category: FOLLOW_UP_CATEGORIES }).catch(() => null),
    cached(`${clinicId}|agegender`, SLOW_CACHE_MS, async () => {
      const queries = await Promise.all(
        AGE_BUCKETS.flatMap((b) => (["male", "female"] as const).map(async (g) => ({ b, g, n: await count(medplum, "Patient", { ...base, gender: g, ...ageQ[b] }) }))),
      );
      return AGE_BUCKETS.map((b) => ({ bucket: b, male: queries.find((q) => q.b === b && q.g === "male")!.n, female: queries.find((q) => q.b === b && q.g === "female")!.n }));
    }).catch(() => null),
  ]);

  const stats = computeVisitStats(enc.rows);
  const rangeKeys = dayKeys(r.from, r.to);
  const prevKeys = dayKeys(r.prevFrom, r.prevTo);
  const consultations = sumSeries(series(rangeKeys, stats.consultationsByDay));
  const consultationsPrev = sumSeries(series(prevKeys, stats.consultationsByDay));

  // Diagnoses: current vs previous period + 12 weekly buckets for the top ones.
  const inRange = (d?: string) => !!d && new Date(d) >= r.from && new Date(d) < r.to;
  const inPrev = (d?: string) => !!d && new Date(d) >= r.prevFrom && new Date(d) < r.prevTo;
  const diagNow = topCounts(conds.rows.filter((c) => inRange(c.recordedDate)).map(conditionName), 8);
  const prevCounts = new Map<string, number>();
  for (const c of conds.rows.filter((c) => inPrev(c.recordedDate))) {
    const n = conditionName(c)?.trim().toLowerCase();
    if (n) prevCounts.set(n, (prevCounts.get(n) ?? 0) + 1);
  }
  const weekIndex = (d: string) => Math.floor((new Date(d).getTime() - weekStart.getTime()) / (7 * 86_400_000));
  const diagnoses = diagNow.map((d) => {
    const weekly = Array<number>(trendWeeks).fill(0);
    for (const c of conds.rows) {
      if (!c.recordedDate || conditionName(c)?.trim().toLowerCase() !== d.name.toLowerCase()) continue;
      const i = weekIndex(c.recordedDate);
      if (i >= 0 && i < trendWeeks) weekly[i]++;
    }
    return { ...d, prev: prevCounts.get(d.name.toLowerCase()) ?? 0, pct: pctChange(d.value, prevCounts.get(d.name.toLowerCase()) ?? 0), weekly };
  });

  // Prescribing: antibiotic share = prescribing consultations with >=1 antibiotic.
  const rxIn = rx.rows.filter((m) => inRange(m.authoredOn));
  const rxPrev = rx.rows.filter((m) => inPrev(m.authoredOn));
  const share = (list: MedicationRequest[]) => {
    const withRx = new Set<string>(), withAb = new Set<string>();
    for (const m of list) {
      const e = m.encounter?.reference ?? m.id ?? "";
      withRx.add(e);
      if (isAntibiotic(m.medicationCodeableConcept?.text)) withAb.add(e);
    }
    return { rx: withRx.size, ab: withAb.size, pct: withRx.size ? Math.round((withAb.size / withRx.size) * 1000) / 10 : null };
  };
  const abNow = share(rxIn), abPrev = share(rxPrev);

  const dispensed = new Map<string, number>();
  for (const d of dispenses.rows) {
    const name = d.medicationReference?.display?.trim();
    if (name) dispensed.set(name, (dispensed.get(name) ?? 0) + (Number(d.quantity?.value) || 0));
  }
  const mostDispensed: NameValue[] = [...dispensed.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);

  const kinds = { mc: 0, chit: 0 };
  for (const p of procs.rows) {
    const k = documentKind(p.note?.[0]?.text);
    if (k === "mc") kinds.mc++;
    else if (k === "time-chit") kinds.chit++;
  }

  // Order COUNTS only (never results): bucket by day for <=7 days, else by week.
  const bucketDays = r.days <= 7 ? 1 : 7;
  const buckets = Math.ceil(r.days / bucketDays);
  const orderBuckets = Array.from({ length: buckets }, (_, i) => ({ name: bucketDays === 1 ? dayLabel(mytYmd(addDays(r.from, i))) : `M${i + 1}`, poct: 0, xray: 0, lab: 0 }));
  const totals = { poct: 0, xray: 0, lab: 0 };
  for (const o of orders.rows) {
    if (!o.authoredOn) continue;
    const hasCat = (code: string) => o.category?.some((c) => c.coding?.some((x) => x.code === code));
    // Only lab / POCT / imaging orders; referrals and procedure ServiceRequests carry no such category and are skipped.
    const kind = o.meta?.tag?.some((t) => t.system === POCT_TAG_SYSTEM) ? "poct"
      : hasCat("363679005") ? "xray" : hasCat("108252007") ? "lab" : null;
    if (!kind) continue;
    const i = Math.min(buckets - 1, Math.max(0, Math.floor((new Date(o.authoredOn).getTime() - r.from.getTime()) / (bucketDays * 86_400_000))));
    orderBuckets[i][kind]++;
    totals[kind]++;
  }

  const uniquePatients = new Set(enc.rows.filter((e) => e.start >= r.from && e.start < r.to).map((e) => e.patientKey)).size;
  const newPatients = await newPatientCount(medplum, clinicId, r);
  const newSeen = Math.min(newPatients ?? 0, uniquePatients);

  return {
    range: rangeMeta(r),
    truncated: enc.truncated || conds.truncated || rx.truncated || procs.truncated || orders.truncated || dispenses.truncated,
    consultations: { value: consultations, prev: consultationsPrev, pct: pctChange(consultations, consultationsPrev) },
    mc: { value: kinds.mc, pctOfConsultations: consultations ? Math.round((kinds.mc / consultations) * 100) : null },
    timeChit: kinds.chit,
    antibiotic: { pct: abNow.pct, prescribing: abNow.rx, withAntibiotic: abNow.ab, deltaPoints: abNow.pct != null && abPrev.pct != null ? Math.round((abNow.pct - abPrev.pct) * 10) / 10 : null },
    diagnoses,
    ageGender,
    mostDispensed,
    orders: { totals, buckets: orderBuckets, bucketLabel: bucketDays === 1 ? "hari" : "minggu" },
    followUps: { completed: fuDone, open: fuOpen, stopped: fuStopped, staleOpen: fuStale },
    patientMix: { unique: uniquePatients, newPatients: newSeen, returning: Math.max(0, uniquePatients - newSeen) },
  };
}

const FOLLOW_UP_CATEGORIES = "https://ucc.emr/communication-category|review-request,https://ucc.emr/communication-category|appointment-reminder";
function followUpCount(medplum: MedplumClient, clinicId: string, status: string, r: ResolvedRange) {
  return count(medplum, "Communication", { identifier: clinicIdent(clinicId), status, category: FOLLOW_UP_CATEGORIES, _lastUpdated: between(r.from, r.to) }).catch(() => null);
}

/** Patients registered in the range, from the stored registration-day tag (legacy untagged patients are not "new"). */
async function newPatientCount(medplum: MedplumClient, clinicId: string, r: ResolvedRange): Promise<number | null> {
  const tags = dayKeys(r.from, r.to).map((d) => `${REGISTERED_TAG_SYSTEM}|${d}`).join(",");
  return count(medplum, "Patient", { active: "true", identifier: clinicIdent(clinicId), _tag: tags }).catch(() => null);
}

/* ============================= Duit & Operasi ============================ */
export async function getMoneyOps(medplum: MedplumClient, clinicId: string, key: RangeKey, now = new Date()) {
  const r = resolveRange(key, now);
  const sixFrom = sixMonthStart(now);
  const [inv, appts, meds, enc, newPatients] = await Promise.all([
    loadInvoices(medplum, clinicId, sixFrom, r.to, true),
    optional("appointments", cached(`${clinicId}|appt|${winKey(r.from, r.to)}`, CACHE_MS, () =>
      searchBounded<Appointment>(medplum, "Appointment", clinicId, { date: between(r.from, r.to), _elements: "status,start,identifier,meta" }, 3))),
    cached(`${clinicId}|stock`, CACHE_MS, () => getInventoryMedicationsFromMedplum(medplum, clinicId)).catch(() => null),
    loadEncounters(medplum, clinicId, r.from, r.to),
    newPatientCount(medplum, clinicId, r),
  ]);

  const emptySources = () => Object.fromEntries(REVENUE_SOURCES.map((s) => [s.key, 0])) as Record<RevenueSource, number>;
  const months = Array.from({ length: 6 }, (_, i) => mytMonthStart(now, 5 - i));
  const monthRows = months.map((m) => ({ name: monthLabel(m), key: mytYmd(m).slice(0, 7), total: 0, ...emptySources() }));
  const inRangeSources = emptySources();
  for (const i of inv.rows) {
    const d = new Date(i.date!);
    const row = monthRows.find((m) => m.key === mytYmd(d).slice(0, 7));
    const total = invoiceTotal(i);
    const lines = i.lineItem ?? [];
    let lineSum = 0;
    for (const li of lines) {
      const amount = Number(li.priceComponent?.[0]?.amount?.value) || 0;
      const type = li.extension?.find((e) => e.url === "https://ucc.emr/invoice/line-item-type")?.valueString;
      const src = classifyLine(type, li.chargeItemCodeableConcept?.text);
      lineSum += amount;
      if (row) { row[src] += amount; row.total += amount; }
      if (d >= r.from && d < r.to) inRangeSources[src] += amount;
    }
    // Invoice without readable lines: keep the total so revenue still reconciles.
    if (lines.length === 0 || lineSum === 0) {
      if (row) { row.lain += total; row.total += total; }
      if (d >= r.from && d < r.to) inRangeSources.lain += total;
    }
  }
  const sources = REVENUE_SOURCES.map((s) => ({ ...s, value: round2(inRangeSources[s.key]) })).filter((s) => s.value > 0);
  const revenueRange = round2(Object.values(inRangeSources).reduce((a, b) => a + b, 0));
  const prevRange = sumInvoices(inv.rows, r.prevFrom, r.prevTo);

  const counts = { attended: 0, noshow: 0, cancelled: 0, upcoming: 0 };
  for (const a of appts.rows) {
    if (a.status === "fulfilled" || a.status === "arrived") counts.attended++;
    else if (a.status === "noshow") counts.noshow++;
    else if (a.status === "cancelled") counts.cancelled++;
    else counts.upcoming++;
  }
  const decided = counts.attended + counts.noshow;
  const noShowRate = decided ? Math.round((counts.noshow / decided) * 1000) / 10 : null;

  const stock = (meds ?? [])
    .filter((m) => m.minimumStock > 0)
    .map((m) => ({ name: m.name, stock: m.stock, reorder: m.minimumStock, level: m.stock <= 0 ? "out" : m.stock <= m.minimumStock ? "low" : m.stock <= m.minimumStock * 1.5 ? "near" : "ok" }))
    .sort((a, b) => a.stock / a.reorder - b.stock / b.reorder);
  const lowItems = stock.filter((s) => s.level === "out" || s.level === "low");

  const uniquePatients = new Set(enc.rows.map((e) => e.patientKey)).size;
  const newSeen = Math.min(newPatients ?? 0, uniquePatients);

  const topSource = [...sources].sort((a, b) => b.value - a.value)[0];
  const insights: { id: string; tone: "good" | "warn" | "info"; title: string; body: string }[] = [];
  if (revenueRange > 0) {
    const pct = pctChange(revenueRange, prevRange);
    insights.push({
      id: "revenue", tone: pct != null && pct < 0 ? "warn" : "good",
      title: `Hasil ${rm(revenueRange)}${pct != null ? ` — ${pct >= 0 ? "naik" : "turun"} ${Math.abs(pct)}% berbanding tempoh sebelum` : ""}.`,
      body: topSource ? `${topSource.label} menyumbang ${Math.round((topSource.value / revenueRange) * 100)}% hasil.` : "",
    });
  } else insights.push({ id: "revenue", tone: "info", title: "Belum ada hasil dalam tempoh ini.", body: "Hasil dikira daripada invois yang sudah selesai di checkout." });
  if (meds) insights.push(lowItems.length
    ? { id: "stock", tone: "warn", title: `${lowItems.length} ubat hampir habis stok.`, body: `${lowItems.slice(0, 3).map((s) => s.name).join(", ")}${lowItems.length > 3 ? " dan lain-lain" : ""} di bawah paras reorder.` }
    : { id: "stock", tone: "good", title: "Semua stok di atas paras reorder.", body: stock.length ? "Tiada ubat perlu ditempah segera." : "Tetapkan paras reorder di Inventori untuk amaran stok." });
  insights.push(noShowRate != null
    ? { id: "noshow", tone: noShowRate >= 15 ? "warn" : "good", title: `${counts.noshow} temujanji tak hadir (${noShowRate}%).`, body: noShowRate >= 15 ? "Pertimbang peringatan WhatsApp sehari sebelum temujanji." : "Kadar tak hadir terkawal." }
    : { id: "noshow", tone: "info", title: "Belum ada temujanji selesai dalam tempoh ini.", body: "Kadar tak hadir dikira apabila ada temujanji hadir atau tak hadir." });

  return {
    range: rangeMeta(r),
    truncated: inv.truncated || appts.truncated,
    insights,
    revenue: { value: revenueRange, prev: prevRange, pct: pctChange(revenueRange, prevRange), monthly: monthRows.map(({ key: _k, ...m }) => ({ ...m, total: round2(m.total) })), sources },
    appointments: { ...counts, total: appts.rows.length, noShowRate },
    stock: { items: stock.slice(0, 8), lowCount: lowItems.length, tracked: stock.length, available: meds != null },
    patientMix: { unique: uniquePatients, newPatients: newSeen, returning: Math.max(0, uniquePatients - newSeen) },
  };
}

function sumInvoices(rows: Invoice[], from: Date, to: Date) {
  return round2(rows.filter((i) => { const d = new Date(i.date!); return d >= from && d < to; }).reduce((s, i) => s + invoiceTotal(i), 0));
}
const rm = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export type SummaryData = Awaited<ReturnType<typeof getSummary>>;
export type ClinicalData = Awaited<ReturnType<typeof getClinical>>;
export type MoneyOpsData = Awaited<ReturnType<typeof getMoneyOps>>;
export type TabKey = "summary" | "clinical" | "money";
export const TAB_KEYS: TabKey[] = ["summary", "clinical", "money"];

export function getTabData(tab: TabKey, medplum: MedplumClient, clinicId: string, range: RangeKey): Promise<SummaryData | ClinicalData | MoneyOpsData> {
  const run = () => (tab === "summary" ? getSummary : tab === "clinical" ? getClinical : getMoneyOps)(medplum, clinicId, range);
  return cached<SummaryData | ClinicalData | MoneyOpsData>(`${clinicId}|tab|${tab}|${range}|${mytYmd(new Date())}`, CACHE_MS, run);
}
