import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { CLINIC_IDENTIFIER_SYSTEM } from "../../lib/fhir/clinic-tenancy";
import { INVENTORY_EXTENSION_URL } from "../../lib/fhir/structure-definitions";
import { clearAnalyticsCache, getMoneyOps, getSummary } from "../../lib/analytics/queries";
import { parseRange, resolveRange } from "../../lib/analytics/range";

// Task 688: /api/analytics/summary (getSummary + route) and the stock section of getMoneyOps.
// Revenue is asserted exactly as it is today (sum of invoice totalGross ?? totalNet over non-draft/cancelled invoices);
// what "Revenue" means is an owner decision and is NOT changed here. Fake data only.
const A = "clinic-a";
const ident = (c = A) => [{ system: CLINIC_IDENTIFIER_SYSTEM, value: c }];
// 2026-11-17 13:00 in Kuala Lumpur (UTC+8).
const now = new Date("2026-11-17T05:00:00Z");

type Inv = Record<string, any>;
const inv = (id: string, date: string | undefined, gross: number | undefined, over: Inv = {}): Inv => ({
  resourceType: "Invoice", id, status: "balanced", date, identifier: ident(),
  ...(gross === undefined ? {} : { totalGross: { value: gross } }), ...over,
});

function fakeMedplum(data: { invoices?: Inv[]; encounters?: any[]; meds?: any[]; patients?: number | "fail"; conditions?: any[] } = {}) {
  const calls: { type: string; params: Record<string, string[]> }[] = [];
  const fake: any = {
    calls,
    async searchResources(type: string, q: URLSearchParams | Record<string, string>) {
      const params: Record<string, string[]> = {};
      for (const [k, v] of q instanceof URLSearchParams ? q.entries() : Object.entries(q)) (params[k] ??= []).push(v);
      calls.push({ type, params });
      const offset = Number(params._offset?.[0] ?? 0);
      const pick = (rows: any[] = []) => rows.slice(offset, offset + 1000);
      if (type === "Invoice") return pick(data.invoices);
      if (type === "Encounter") return pick(data.encounters);
      if (type === "Condition") return pick(data.conditions);
      if (type === "Medication") return data.meds ?? [];
      return [];
    },
    async search(type: string) {
      if (data.patients === "fail") throw new Error("count unavailable");
      return { total: type === "Patient" ? (data.patients ?? 0) : 0 };
    },
  };
  return fake;
}

beforeEach(() => clearAnalyticsCache());

describe("getSummary: empty data", () => {
  test("zeros, null percentages, no truncation, full-length series", async () => {
    const s = await getSummary(fakeMedplum(), A, "7d", now);
    expect(s.truncated).toBe(false);
    expect(s.kpis.revenue).toMatchObject({ value: 0, prev: 0, pct: null, sixMonths: 0 });
    expect(s.kpis.consultations).toMatchObject({ value: 0, prev: 0, pct: null });
    expect(s.kpis.patientsToday).toMatchObject({ value: 0, deltaVsYesterday: 0 });
    expect(s.kpis.wait).toMatchObject({ avg: null, samples: 0 });
    expect(s.kpis.totalPatients).toBe(0);
    expect(s.kpis.revenue.series).toHaveLength(7);
    expect(s.revenueMonthly).toHaveLength(6);
    expect(s.revenueMonthly.every((m) => m.value === 0)).toBe(true);
    expect(s.revenueMonthly.at(-1)!.name).toBe("Nov");
    expect(s.topDiagnoses).toEqual([]);
    expect(s.heatmap).toMatchObject({ days: 28, total: 0 });
  });

  test("when counts fail, totals are null (unknown) rather than 0", async () => {
    const s = await getSummary(fakeMedplum({ patients: "fail" }), A, "7d", now);
    expect(s.kpis.totalPatients).toBeNull();
    expect(s.kpis.followUpsOpen).toBeNull();
  });
});

describe("getSummary: date ranges", () => {
  const cases = [
    ["today", 1, "2026-11-16T16:00:00.000Z"],
    ["7d", 7, "2026-11-10T16:00:00.000Z"],
    ["30d", 30, "2026-10-18T16:00:00.000Z"],
    ["month", 17, "2026-10-31T16:00:00.000Z"],
  ] as const;
  for (const [key, days, from] of cases) {
    test(`${key}: ${days} day(s) from the MYT start of the window, ending at tomorrow 00:00 MYT`, async () => {
      const s = await getSummary(fakeMedplum(), A, key, now);
      expect(s.range).toEqual({ key, from, to: "2026-11-17T16:00:00.000Z", days });
      expect(s.kpis.revenue.series.length).toBe(Math.max(days, 7)); // chart never shorter than a week
    });
  }

  test("unknown or missing range falls back to 7d", () => {
    for (const v of [undefined, null, "", "90d", "TODAY", 7]) expect(parseRange(v)).toBe("7d");
    for (const v of ["today", "7d", "30d", "month"]) expect(parseRange(v)).toBe(v);
  });

  test("the 'month' range on the 1st is a single day with an equal-length previous window", () => {
    const r = resolveRange("month", new Date("2026-11-01T01:00:00Z")); // 09:00 MYT on the 1st
    expect(r.days).toBe(1);
    expect(r.prevTo.getTime()).toBe(r.from.getTime());
    expect(r.prevFrom.getTime()).toBe(r.from.getTime() - 86_400_000);
  });

  test("the requested window is sent to the search as ge/lt bounds; Encounter covers the previous window too", async () => {
    const f = fakeMedplum();
    await getSummary(f, A, "7d", now);
    const enc = f.calls.find((c: any) => c.type === "Encounter");
    expect(enc.params.date).toEqual(["ge2026-10-20T16:00:00.000Z", "lt2026-11-17T16:00:00.000Z"]); // 28-day heatmap window
    const invoice = f.calls.find((c: any) => c.type === "Invoice");
    expect(invoice.params.date).toEqual(["ge2026-05-31T16:00:00.000Z", "lt2026-11-17T16:00:00.000Z"]); // six MYT months
  });
});

describe("getSummary: revenue as it is today", () => {
  const sum = async (invoices: Inv[], key: "today" | "7d" | "30d" | "month" = "7d") => {
    clearAnalyticsCache();
    return (await getSummary(fakeMedplum({ invoices }), A, key, now)).kpis.revenue;
  };

  test("adds totalGross of valid invoices; falls back to totalNet, then 0", async () => {
    const r = await sum([
      inv("i1", "2026-11-17T03:00:00Z", 100),
      inv("i2", "2026-11-16T03:00:00Z", undefined, { totalNet: { value: 40 } }),
      inv("i3", "2026-11-15T03:00:00Z", 10, { totalNet: { value: 999 } }),
      inv("i4", "2026-11-14T03:00:00Z", undefined),
    ]);
    expect(r.value).toBe(150);
  });

  test("draft, cancelled, entered-in-error and undated invoices are not revenue; issued/balanced/paid-like are", async () => {
    const r = await sum([
      inv("ok1", "2026-11-17T03:00:00Z", 10, { status: "issued" }),
      inv("ok2", "2026-11-17T03:00:00Z", 20, { status: "balanced" }),
      inv("d", "2026-11-17T03:00:00Z", 1000, { status: "draft" }),
      inv("c", "2026-11-17T03:00:00Z", 1000, { status: "cancelled" }),
      inv("e", "2026-11-17T03:00:00Z", 1000, { status: "entered-in-error" }),
      inv("nodate", undefined, 1000),
    ]);
    expect(r.value).toBe(30);
  });

  test("a foreign clinic's invoice returned by the store is dropped", async () => {
    const r = await sum([inv("mine", "2026-11-17T03:00:00Z", 10), inv("theirs", "2026-11-17T03:00:00Z", 5000, { identifier: ident("clinic-b") })]);
    expect(r.value).toBe(10);
  });

  test("all searches carry this clinic's identifier", async () => {
    const f = fakeMedplum({ invoices: [inv("i", "2026-11-17T03:00:00Z", 1)] });
    await getSummary(f, A, "7d", now);
    for (const c of f.calls) expect(c.params.identifier).toEqual([`${CLINIC_IDENTIFIER_SYSTEM}|${A}`]);
  });

  test("day boundaries use Malaysia time: 00:00 MYT belongs to the new day, 23:59 MYT to the old one", async () => {
    const today = await sum([
      inv("startToday", "2026-11-16T16:00:00Z", 10), // Nov 17 00:00 MYT
      inv("endYesterday", "2026-11-16T15:59:59Z", 7), // Nov 16 23:59:59 MYT
    ], "today");
    expect(today).toMatchObject({ value: 10, prev: 7, pct: 42.9 });
  });

  test("an invoice at tomorrow 00:00 MYT is outside the range", async () => {
    expect((await sum([inv("tomorrow", "2026-11-17T16:00:00Z", 10)])).value).toBe(0);
  });

  test("previous period compares like for like; pct is null when the previous period is empty", async () => {
    const withPrev = await sum([inv("c", "2026-11-12T03:00:00Z", 150), inv("p", "2026-11-05T03:00:00Z", 100)]);
    expect(withPrev).toMatchObject({ value: 150, prev: 100, pct: 50 });
    const noPrev = await sum([inv("c", "2026-11-12T03:00:00Z", 150)]);
    expect(noPrev).toMatchObject({ prev: 0, pct: null });
    const drop = await sum([inv("c", "2026-11-12T03:00:00Z", 50), inv("p", "2026-11-05T03:00:00Z", 100)]);
    expect(drop.pct).toBe(-50);
  });

  test("amounts are rounded to 2 decimals (0.1 + 0.2)", async () => {
    const r = await sum([inv("a", "2026-11-17T03:00:00Z", 0.1), inv("b", "2026-11-17T03:00:00Z", 0.2)]);
    expect(r.value).toBe(0.3);
  });

  test("six-month total and monthly buckets", async () => {
    const s = await getSummary(fakeMedplum({ invoices: [
      inv("nov", "2026-11-03T03:00:00Z", 30),
      inv("oct", "2026-10-20T03:00:00Z", 20),
      inv("jun", "2026-05-31T16:00:00Z", 10), // 1 Jun 00:00 MYT: first month of the window
    ] }), A, "7d", now);
    expect(s.kpis.revenue.sixMonths).toBe(60);
    expect(s.revenueMonthly.map((m) => m.value)).toEqual([10, 0, 0, 0, 20, 30]);
    expect(s.revenueMonthly.map((m) => m.name)).toEqual(["Jun", "Jul", "Ogo", "Sep", "Okt", "Nov"]);
    expect(s.revenueMonthly).toHaveLength(6);
  });

  test("month range sums from the 1st (MYT) only", async () => {
    const r = await sum([inv("in", "2026-10-31T16:00:00Z", 5), inv("out", "2026-10-31T15:59:00Z", 50)], "month");
    expect(r.value).toBe(5);
  });
});

describe("getSummary: consultations and truncation", () => {
  const enc = (id: string, patient: string, start: string, triage = false) => ({
    resourceType: "Encounter", id, identifier: ident(), subject: { reference: `Patient/${patient}` }, period: { start },
    ...(triage ? { extension: [{ url: "https://ucc.emr/triage-encounter", extension: [] }] } : {}),
  });

  test("consultations exclude triage-only encounters; unique patients per day count once; foreign clinic ignored", async () => {
    const s = await getSummary(fakeMedplum({ encounters: [
      enc("e1", "p1", "2026-11-17T01:00:00Z"),
      enc("e2", "p1", "2026-11-17T02:00:00Z"),
      enc("e3", "p2", "2026-11-17T02:00:00Z", true),
      { ...enc("e4", "p3", "2026-11-17T02:00:00Z"), identifier: ident("clinic-b") },
    ] }), A, "today", now);
    expect(s.kpis.consultations.value).toBe(2);
    expect(s.kpis.patientsToday.value).toBe(2); // p1 + p2 (triage patients still visited)
    expect(s.kpis.patientsToday.deltaVsYesterday).toBe(2);
  });

  test("a full page set flags truncated instead of silently under-reporting", async () => {
    const many = Array.from({ length: 6000 }, (_, i) => inv(`i${i}`, "2026-11-17T03:00:00Z", 1));
    const s = await getSummary(fakeMedplum({ invoices: many }), A, "7d", now);
    expect(s.truncated).toBe(true);
    expect(s.kpis.revenue.value).toBe(6000);
  });

  test("top diagnoses come from this clinic's conditions only", async () => {
    const cond = (id: string, text: string, c = A) => ({ resourceType: "Condition", id, identifier: ident(c), code: { text }, recordedDate: "2026-11-17T01:00:00Z" });
    const s = await getSummary(fakeMedplum({ conditions: [cond("1", "Fake Fever"), cond("2", "Fake Fever"), cond("3", "Fake Cough"), cond("4", "Foreign", "clinic-b")] }), A, "7d", now);
    expect(s.topDiagnoses[0]).toMatchObject({ name: "Fake Fever", value: 2 });
    expect(s.topDiagnoses.map((d) => d.name)).not.toContain("Foreign");
  });
});

describe("getMoneyOps stock section (low-stock thresholds) and revenue fallbacks", () => {
  const med = (id: string, name: string, stock: number, min: number, clinic = A) => ({
    resourceType: "Medication", id, code: { text: name },
    identifier: [{ system: "https://ucc.emr/inventory/medication", value: "catalog-item" }, ...ident(clinic)],
    meta: { accounts: [{ reference: `HealthcareService/acct-${clinic}` }] },
    extension: [{ url: INVENTORY_EXTENSION_URL, extension: [{ url: "stock", valueInteger: stock }, { url: "minimumStock", valueInteger: min }] }],
  });

  test("levels: out / low (at threshold) / near (<=1.5x) / ok; items without a threshold are not tracked; sorted most urgent first", async () => {
    const m = await getMoneyOps(fakeMedplum({ meds: [
      med("1", "Ok Item", 100, 10), med("2", "Near Item", 14, 10), med("3", "Low Item", 10, 10), med("4", "Out Item", 0, 10),
      med("5", "No Threshold", 0, 0), med("6", "Foreign Item", 0, 10, "clinic-b"),
    ] }), A, "7d", now);
    expect(m.stock.available).toBe(true);
    expect(m.stock.tracked).toBe(4);
    expect(m.stock.lowCount).toBe(2);
    expect(m.stock.items.map((i) => [i.name, i.level])).toEqual([["Out Item", "out"], ["Low Item", "low"], ["Near Item", "near"], ["Ok Item", "ok"]]);
    expect(m.insights.find((i) => i.id === "stock")).toMatchObject({ tone: "warn", title: "2 ubat hampir habis stok." });
  });

  test("everything above threshold: good insight; none tracked: prompts to set thresholds", async () => {
    const good = await getMoneyOps(fakeMedplum({ meds: [med("1", "Ok Item", 100, 10)] }), A, "7d", now);
    expect(good.insights.find((i) => i.id === "stock")).toMatchObject({ tone: "good", body: "Tiada ubat perlu ditempah segera." });
    clearAnalyticsCache();
    const none = await getMoneyOps(fakeMedplum({ meds: [med("1", "No Threshold", 0, 0)] }), A, "7d", now);
    expect(none.stock).toMatchObject({ tracked: 0, lowCount: 0, available: true });
    expect(none.insights.find((i) => i.id === "stock")!.body).toContain("Tetapkan paras reorder");
  });

  test("more than 3 low items are summarised, items list capped at 8", async () => {
    const meds = Array.from({ length: 10 }, (_, i) => med(`${i}`, `Item ${i}`, 0, 5));
    const m = await getMoneyOps(fakeMedplum({ meds }), A, "7d", now);
    expect(m.stock.items).toHaveLength(8);
    expect(m.stock.lowCount).toBe(10);
    expect(m.insights.find((i) => i.id === "stock")!.body).toContain("dan lain-lain");
  });

  test("inventory read failure marks stock unavailable and omits the stock insight, rest of the tab still loads", async () => {
    const f = fakeMedplum();
    const orig = f.searchResources.bind(f);
    f.searchResources = async (type: string, q: any) => { if (type === "Medication") throw new Error("boom"); return orig(type, q); };
    const m = await getMoneyOps(f, A, "7d", now);
    expect(m.stock).toMatchObject({ available: false, tracked: 0, lowCount: 0, items: [] });
    expect(m.insights.map((i) => i.id)).toEqual(["revenue", "noshow"]);
  });

  test("invoice with no readable lines keeps its total under 'lain'; revenue insight and empty-revenue message", async () => {
    const m = await getMoneyOps(fakeMedplum({ invoices: [inv("i1", "2026-11-17T03:00:00Z", 80)] }), A, "7d", now);
    expect(m.revenue.value).toBe(80);
    expect(m.revenue.sources).toEqual([expect.objectContaining({ key: "lain", value: 80 })]);
    expect(m.insights[0]).toMatchObject({ id: "revenue", tone: "good" });
    clearAnalyticsCache();
    const empty = await getMoneyOps(fakeMedplum(), A, "7d", now);
    expect(empty.revenue).toMatchObject({ value: 0, pct: null, sources: [] });
    expect(empty.insights[0]).toMatchObject({ id: "revenue", tone: "info" });
    expect(empty.appointments).toMatchObject({ total: 0, noShowRate: null });
  });

  test("a fall versus the previous period is flagged 'warn'", async () => {
    const m = await getMoneyOps(fakeMedplum({ invoices: [inv("c", "2026-11-12T03:00:00Z", 50), inv("p", "2026-11-05T03:00:00Z", 100)] }), A, "7d", now);
    expect(m.insights[0]).toMatchObject({ tone: "warn" });
    expect(m.insights[0].title).toContain("turun 50%");
  });
});

// ---- the route: GET /api/analytics/[tab] (tab = "summary") ----
const realAuth = await import("@/lib/server/medplum-auth");
const realRegistry = await import("@/lib/module-registry");
let routeClinic = A;
let moduleOn = true;
let routeMedplum: any = fakeMedplum();
let authError: Error | null = null;
mock.module("@/lib/server/medplum-auth", () => ({
  ...realAuth,
  requireClinicAuth: async () => { if (authError) throw authError; return { medplum: routeMedplum, clinicId: routeClinic }; },
}));
mock.module("@/lib/module-registry", () => ({ ...realRegistry, isModuleEnabledForClinic: async () => moduleOn }));
const { GET } = await import("../../app/api/analytics/[tab]/route");
afterAll(() => {
  mock.module("@/lib/server/medplum-auth", () => realAuth);
  mock.module("@/lib/module-registry", () => realRegistry);
});

describe("GET /api/analytics/summary", () => {
  beforeEach(() => { routeClinic = A; moduleOn = true; authError = null; routeMedplum = fakeMedplum(); });
  const call = (tab: string, qs = "") => GET(new NextRequest(`http://localhost/api/analytics/${tab}${qs}`), { params: Promise.resolve({ tab }) });

  test("returns summary JSON with a short private cache header; default range is 7d", async () => {
    const res = await call("summary");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=30");
    const body = await res.json();
    expect(body.range.key).toBe("7d");
    expect(body.kpis.revenue.value).toBe(0);
  });

  test("honours ?range= and treats garbage as 7d", async () => {
    expect((await (await call("summary", "?range=today")).json()).range.days).toBe(1);
    expect((await (await call("summary", "?range=30d")).json()).range.days).toBe(30);
    expect((await (await call("summary", "?range=bogus")).json()).range.key).toBe("7d");
  });

  test("unknown tab is 404 before any auth or data access", async () => {
    authError = new Error("must not be reached");
    expect((await call("secrets")).status).toBe(404);
    expect((await call("")).status).toBe(404);
  });

  test("module disabled for the clinic is 404 and nothing is searched", async () => {
    moduleOn = false;
    expect((await call("summary")).status).toBe(404);
    expect(routeMedplum.calls).toHaveLength(0);
  });

  test("results are scoped to the signed-in clinic and cached per clinic", async () => {
    routeMedplum = fakeMedplum({ invoices: [inv("i", "2026-11-17T03:00:00Z", 10)] });
    const first = await call("summary", "?range=30d");
    expect(first.status).toBe(200);
    const searched = routeMedplum.calls.length;
    await call("summary", "?range=30d");
    expect(routeMedplum.calls.length).toBe(searched); // second call served from cache
    routeClinic = "clinic-b";
    await call("summary", "?range=30d");
    expect(routeMedplum.calls.length).toBeGreaterThan(searched); // other clinic never reuses A's cache
    const lastIdent = routeMedplum.calls.at(-1).params.identifier;
    expect(lastIdent).toEqual([`${CLINIC_IDENTIFIER_SYSTEM}|clinic-b`]);
  });

  test("an auth failure is not turned into data (4xx/5xx from handleRouteError)", async () => {
    authError = new Error("boom");
    const res = await call("summary");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(routeMedplum.calls).toHaveLength(0);
  });
});
