"use client";

import type { SummaryData } from "@/lib/analytics/queries";
import { Delta, EmptyState, HBarList, Heatmap, KpiCard, PALETTE, Panel, fmtInt, fmtRM } from "./primitives";
import { AreaTrend, Columns, WaitLine } from "./charts";

export default function SummaryTab({ data }: { data: SummaryData }) {
  const k = data.kpis;
  const rangeText = { today: "hari ini", "7d": "7 hari", "30d": "30 hari", month: "bulan ini" }[data.range.key];
  const waitDelta = k.wait.avg == null ? null : k.wait.avg - k.wait.target;
  const hasRevenueMonths = data.revenueMonthly.some((m) => m.value > 0);
  const hasWaitSeries = k.wait.series.some((p) => p.value != null);
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <KpiCard
          label="Pesakit hari ini" value={fmtInt(k.patientsToday.value)} hint={`${k.totalPatients != null ? fmtInt(k.totalPatients) : "—"} pesakit berdaftar`}
          delta={<Delta pct={k.patientsToday.deltaVsYesterday} unit="" suffix="vs semalam" />} spark={k.patientsToday.series.map((p) => p.value)} color={PALETTE.blue}
        />
        <KpiCard
          label="Konsultasi" value={fmtInt(k.consultations.value)} hint={rangeText}
          delta={<Delta pct={k.consultations.pct} />} spark={k.consultations.series.map((p) => p.value)} color={PALETTE.green}
        />
        <KpiCard
          label="Hasil" value={fmtRM(k.revenue.value)} hint={`${rangeText} · 6 bulan ${fmtRM(k.revenue.sixMonths)}`}
          delta={<Delta pct={k.revenue.pct} />} spark={k.revenue.series.map((p) => p.value)} color="#7c3aed"
        />
        <KpiCard
          label="Purata menunggu" value={k.wait.avg == null ? "—" : `${k.wait.avg} min`}
          hint={k.wait.avg == null ? "Belum ada sampel giliran" : `sasaran ≤ ${k.wait.target} min · ${k.wait.samples} sampel`}
          delta={waitDelta == null ? undefined : <Delta pct={waitDelta} unit=" min" suffix={waitDelta <= 0 ? "lebih laju" : "lebih lambat"} upIsGood={false} />}
          spark={k.wait.series.map((p) => p.value)} color={PALETTE.orange}
        />
        <KpiCard className="col-span-2 lg:col-span-1" label="Follow-up belum selesai" value={k.followUpsOpen == null ? "—" : fmtInt(k.followUpsOpen)} hint="peringatan & permintaan ulasan belum ditutup" />
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
        <Panel className="lg:col-span-3" title="Hasil, 6 bulan" subtitle="RM · bulan semasa belum tamat">
          {hasRevenueMonths ? <AreaTrend data={data.revenueMonthly} format={fmtRM} /> : <EmptyState>Belum ada invois selesai dalam 6 bulan.</EmptyState>}
        </Panel>
        <Panel className="lg:col-span-2" title="Kunjungan ikut hari" subtitle="pesakit unik sehari">
          {data.visitsByDay.some((d) => d.value > 0) ? <Columns data={data.visitsByDay.map((d) => ({ name: d.label, value: d.value }))} /> : <EmptyState />}
        </Panel>
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
        <Panel className="lg:col-span-3" title="Jam paling sibuk" subtitle={`ketibaan pesakit ikut hari & jam · ${data.heatmap.days} hari terakhir`}>
          <Heatmap matrix={data.heatmap.matrix} />
        </Panel>
        <Panel className="lg:col-span-2" title="Diagnosis teratas" subtitle={rangeText}>
          {data.topDiagnoses.length ? <HBarList items={data.topDiagnoses} /> : <EmptyState>Tiada diagnosis direkod dalam tempoh ini.</EmptyState>}
        </Panel>
      </div>

      <Panel title="Masa menunggu vs sasaran" subtitle={`purata harian, daftar giliran → mula konsultasi · garisan putus-putus = sasaran ${k.wait.target} min`}>
        {hasWaitSeries ? <WaitLine data={k.wait.series.map((p) => ({ name: p.label, value: p.value }))} target={k.wait.target} /> : <EmptyState>Belum ada sampel masa menunggu (perlu rekod giliran dan konsultasi).</EmptyState>}
      </Panel>
      {data.truncated ? <p className="text-xs text-muted-foreground">Sebahagian data dipotong pada had paparan; pilih tempoh lebih pendek untuk angka penuh.</p> : null}
    </div>
  );
}
