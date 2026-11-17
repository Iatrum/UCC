"use client";

import { AlertTriangle, CheckCircle2, Info, PackageOpen, TrendingUp, UserX } from "lucide-react";
import type { MoneyOpsData } from "@/lib/analytics/queries";
import { REVENUE_SOURCES } from "@/lib/analytics/aggregate";
import { cn } from "@/lib/utils";
import { Delta, EmptyState, Legend, PALETTE, Panel, fmtInt, fmtRM } from "./primitives";
import { Donut, Stacked } from "./charts";

const SOURCE_COLOR: Record<string, string> = { konsultasi: PALETTE.blue, ubat: PALETTE.orange, prosedur: PALETTE.green, lab: PALETTE.amber, xray: PALETTE.pink, lain: PALETTE.slate };
const LEVEL: Record<string, { label: string; text: string; bar: string }> = {
  out: { label: "Habis", text: "text-red-700", bar: "#dc2626" },
  low: { label: "Rendah", text: "text-red-700", bar: "#dc2626" },
  near: { label: "Hampir", text: "text-amber-700", bar: "#f59e0b" },
  ok: { label: "OK", text: "text-emerald-700", bar: "#059669" },
};
const TONE = { good: "bg-emerald-50 text-emerald-700", warn: "bg-amber-50 text-amber-700", info: "bg-slate-100 text-slate-600" };
const INSIGHT_ICON = { revenue: TrendingUp, stock: PackageOpen, noshow: UserX } as Record<string, typeof Info>;

export default function MoneyTab({ data }: { data: MoneyOpsData }) {
  const a = data.appointments;
  const mix = data.patientMix;
  const stockMax = Math.max(1, ...data.stock.items.map((s) => Math.max(s.stock, s.reorder * 1.6)));
  const used = REVENUE_SOURCES.filter((s) => data.revenue.monthly.some((m) => (m as unknown as Record<string, number>)[s.key] > 0));
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
        {data.insights.map((i) => {
          const Icon = i.tone === "warn" ? AlertTriangle : INSIGHT_ICON[i.id] ?? (i.tone === "good" ? CheckCircle2 : Info);
          return (
            <div key={i.id} className="flex gap-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", TONE[i.tone])}><Icon className="h-4 w-4" aria-hidden /></span>
              <div className="min-w-0"><p className="text-sm font-semibold text-slate-950">{i.title}</p>{i.body ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{i.body}</p> : null}</div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
        <Panel className="lg:col-span-3" title="Hasil ikut sumber" subtitle="RM · 6 bulan · daripada invois yang sudah selesai">
          {used.length ? (
            <>
              <Legend items={used.map((s) => ({ label: s.label, color: SOURCE_COLOR[s.key] }))} />
              <Stacked data={data.revenue.monthly as unknown as Record<string, string | number>[]} format={fmtRM} series={used.map((s) => ({ key: s.key, label: s.label, color: SOURCE_COLOR[s.key] }))} />
            </>
          ) : <EmptyState>Belum ada invois selesai dalam 6 bulan.</EmptyState>}
        </Panel>
        <Panel className="lg:col-span-2" title="Tempoh dipilih" subtitle="hasil ikut sumber">
          <div className="mb-3 flex items-baseline gap-3"><span className="text-2xl font-semibold text-slate-950">{fmtRM(data.revenue.value)}</span><Delta pct={data.revenue.pct} /></div>
          {data.revenue.sources.length ? (
            <ul className="space-y-2">
              {data.revenue.sources.map((s) => (
                <li key={s.key} className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                  <span className="inline-flex items-center gap-1.5 text-slate-700"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SOURCE_COLOR[s.key] }} />{s.label}</span>
                  <span className="h-2 rounded-full bg-slate-100"><span className="block h-2 rounded-full" style={{ width: `${Math.max(3, (s.value / data.revenue.value) * 100)}%`, background: SOURCE_COLOR[s.key] }} /></span>
                  <span className="font-semibold tabular-nums">{fmtRM(s.value)}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState>Tiada hasil dalam tempoh ini.</EmptyState>}
        </Panel>
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
        <Panel className="lg:col-span-3" title="Stok vs paras reorder" subtitle="ubat paling hampir habis dahulu · garisan = paras reorder">
          {data.stock.items.length ? (
            <ul className="space-y-3">
              {data.stock.items.map((s) => (
                <li key={s.name}>
                  <div className="flex items-center justify-between gap-3 text-sm"><span className="truncate text-slate-800">{s.name}</span><span className={cn("shrink-0 text-xs font-semibold", LEVEL[s.level].text)}><span className="text-sm tabular-nums text-slate-950">{s.stock}</span> · {LEVEL[s.level].label}</span></div>
                  <div className="relative mt-1 h-2 rounded-full bg-slate-100">
                    <span className="block h-2 rounded-full" style={{ width: `${Math.max(0, Math.min(100, (s.stock / stockMax) * 100))}%`, background: LEVEL[s.level].bar }} />
                    <span className="absolute -top-0.5 h-3 w-0.5 bg-slate-900" style={{ left: `${(s.reorder / stockMax) * 100}%` }} title={`Paras reorder ${s.reorder}`} />
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState>{data.stock.available ? "Tiada ubat dengan paras reorder ditetapkan. Tetapkan di Inventori." : "Data stok tidak tersedia."}</EmptyState>}
        </Panel>
        <div className="space-y-4 sm:space-y-6 lg:col-span-2">
          <Panel title="Temujanji" subtitle={`${fmtInt(a.total)} dalam tempoh dipilih`}>
            {a.total ? (
              <div className="flex flex-col items-center gap-4 sm:flex-row">
                <Donut centre={fmtInt(a.attended)} centreLabel="hadir" data={[{ name: "Hadir", value: a.attended, color: PALETTE.blue }, { name: "Tak hadir", value: a.noshow, color: PALETTE.orange }, { name: "Batal", value: a.cancelled, color: PALETTE.amber }, { name: "Akan datang", value: a.upcoming, color: "#cbd5e1" }]} />
                <ul className="w-full space-y-1.5 text-sm">
                  {[["Hadir", a.attended, PALETTE.blue], ["Tak hadir", a.noshow, PALETTE.orange], ["Batal", a.cancelled, PALETTE.amber], ["Akan datang", a.upcoming, "#cbd5e1"]].map(([l, v, c]) => (
                    <li key={String(l)} className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: String(c) }} />{String(l)}</span><span className="font-semibold tabular-nums">{fmtInt(Number(v))}</span></li>
                  ))}
                </ul>
              </div>
            ) : <EmptyState>Tiada temujanji dalam tempoh ini.</EmptyState>}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-lg font-semibold text-slate-950">{a.noShowRate == null ? "—" : `${a.noShowRate}%`}</div><div className="text-xs text-muted-foreground">tak hadir</div></div>
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-lg font-semibold text-slate-950">{mix.unique ? `${Math.round((mix.newPatients / mix.unique) * 100)}%` : "—"}</div><div className="text-xs text-muted-foreground">{mix.unique ? `pesakit baru (${mix.newPatients}/${mix.unique})` : "pesakit baru"}</div></div>
            </div>
          </Panel>
        </div>
      </div>
      {data.truncated ? <p className="text-xs text-muted-foreground">Sebahagian data dipotong pada had paparan; pilih tempoh lebih pendek untuk angka penuh.</p> : null}
    </div>
  );
}
