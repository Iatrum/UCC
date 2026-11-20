"use client";

import dynamic from "next/dynamic";
import { Suspense, use, useCallback, useEffect, useRef, useState } from "react";
import type { ClinicalData, MoneyOpsData, SummaryData, TabKey } from "@/lib/analytics/queries";
import { RANGE_KEYS, RANGE_LABELS, type RangeKey } from "@/lib/analytics/range";
import { Button } from "@/components/ui/button";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { cn } from "@/lib/utils";
import { AnalyticsBodySkeleton } from "./analytics-skeleton";
import { EmptyState } from "./primitives";
import SummaryTab from "./summary-tab";

// Klinikal / Duit & Operasi are only downloaded when their tab is first opened.
const ClinicalTab = dynamic(() => import("./clinical-tab"), { loading: () => <AnalyticsBodySkeleton /> });
const MoneyTab = dynamic(() => import("./money-tab"), { loading: () => <AnalyticsBodySkeleton /> });

export type InitialPayload = { range: RangeKey; data: SummaryData | null; error?: string };

const TABS: { key: TabKey; label: string }[] = [
  { key: "summary", label: "Ringkasan" },
  { key: "clinical", label: "Klinikal" },
  { key: "money", label: "Duit & Operasi" },
];

type Entry = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; data: SummaryData | ClinicalData | MoneyOpsData };

export default function AnalyticsDashboard({ initial }: { initial: Promise<InitialPayload> }) {
  const [tab, setTab] = useState<TabKey>("summary");
  const [range, setRange] = useState<RangeKey>("7d");
  const [fresh, setFresh] = useState(true); // true until the first interaction: use the server-streamed Ringkasan
  const [store, setStore] = useState<Record<string, Entry>>({});
  const requested = useRef(new Set<string>());

  const load = useCallback((t: TabKey, r: RangeKey, force = false) => {
    const key = `${t}:${r}`;
    if (!force && requested.current.has(key)) return;
    requested.current.add(key);
    const put = (e: Entry | null) => setStore((s) => { const n = { ...s }; if (e) n[key] = e; else delete n[key]; return n; });
    put({ status: "loading" });
    fetchWithTimeout(`/api/analytics/${t}?range=${r}`, { credentials: "same-origin" }, 20_000)
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 401 ? "Sesi tamat. Sila log masuk semula." : "Gagal memuatkan data.");
        return res.json();
      })
      .then((data) => put({ status: "ok", data }))
      .catch((e) => { requested.current.delete(key); put({ status: "error", message: e?.name === "AbortError" ? "Sambungan perlahan: permintaan tamat masa." : e instanceof TypeError ? "Tiada sambungan internet." : e?.message || "Gagal memuatkan data." }); });
  }, []);

  const showInitial = fresh && tab === "summary" && range === "7d";
  useEffect(() => { if (!showInitial) load(tab, range); }, [tab, range, showInitial, load]);

  const select = (t: TabKey, r: RangeKey) => { setFresh(false); setTab(t); setRange(r); };
  const entry = store[`${tab}:${range}`];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Bahagian analitik" className="grid max-w-full grid-cols-3 gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 sm:inline-flex">
          {TABS.map((t) => (
            <button key={t.key} role="tab" type="button" aria-selected={tab === t.key} onClick={() => select(t.key, range)}
              className={cn("min-h-10 shrink-0 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors whitespace-nowrap sm:min-h-0 sm:px-3", tab === t.key ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-950")}>
              {t.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Tempoh" className="grid max-w-full grid-cols-4 gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 sm:inline-flex">
          {RANGE_KEYS.map((k) => (
            <button key={k} type="button" aria-pressed={range === k} onClick={() => select(tab, k)}
              className={cn("min-h-10 shrink-0 rounded-lg px-1.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap sm:min-h-0 sm:px-3 sm:text-sm", range === k ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-950")}>
              {RANGE_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel">
        {showInitial ? (
          <Suspense fallback={<AnalyticsBodySkeleton />}><InitialSummary promise={initial} onRetry={() => select("summary", "7d")} /></Suspense>
        ) : !entry || entry.status === "loading" ? (
          <AnalyticsBodySkeleton />
        ) : entry.status === "error" ? (
          <ErrorState message={entry.message} onRetry={() => load(tab, range, true)} />
        ) : tab === "summary" ? (
          <SummaryTab data={entry.data as SummaryData} />
        ) : tab === "clinical" ? (
          <ClinicalTab data={entry.data as ClinicalData} />
        ) : (
          <MoneyTab data={entry.data as MoneyOpsData} />
        )}
      </div>
    </div>
  );
}

function InitialSummary({ promise, onRetry }: { promise: Promise<InitialPayload>; onRetry: () => void }) {
  const res = use(promise);
  if (!res.data) return <ErrorState message={res.error || "Tiada data."} onRetry={onRetry} />;
  return <SummaryTab data={res.data} />;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <EmptyState className="flex-col gap-3">
      <span>{message}</span>
      <Button size="sm" variant="outline" onClick={onRetry}>Cuba lagi</Button>
    </EmptyState>
  );
}
