"use client";

import type { ClinicalData } from "@/lib/analytics/queries";
import { Delta, EmptyState, HBarList, KpiCard, Legend, PALETTE, Panel, Sparkline, fmtInt } from "./primitives";
import { Donut, Stacked } from "./charts";

export default function ClinicalTab({ data }: { data: ClinicalData }) {
  const o = data.orders;
  const orderTotal = o.totals.poct + o.totals.xray + o.totals.lab;
  const fu = data.followUps;
  const fuKnown = [fu.completed, fu.open, fu.stopped].every((n) => n != null);
  const fuTotal = (fu.completed ?? 0) + (fu.open ?? 0) + (fu.stopped ?? 0);
  const mixTotal = data.patientMix.unique;
  const ag = data.ageGender;
  const agMax = ag ? Math.max(1, ...ag.flatMap((r) => [r.male, r.female])) : 1;
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard label="Konsultasi" value={fmtInt(data.consultations.value)} delta={<Delta pct={data.consultations.pct} />} />
        <KpiCard label="MC dikeluarkan" value={fmtInt(data.mc.value)} hint={data.mc.pctOfConsultations != null ? `${data.mc.pctOfConsultations}% konsultasi · ${fmtInt(data.timeChit)} time chit` : `${fmtInt(data.timeChit)} time chit`} />
        <KpiCard
          label="Antibiotik" value={data.antibiotic.pct == null ? "—" : `${data.antibiotic.pct}%`}
          hint={data.antibiotic.prescribing ? `${data.antibiotic.withAntibiotic} / ${data.antibiotic.prescribing} konsultasi berpreskripsi (ikut nama ubat)` : "Tiada preskripsi dalam tempoh ini"}
          delta={data.antibiotic.deltaPoints == null ? undefined : <Delta pct={data.antibiotic.deltaPoints} unit=" mata" upIsGood={false} />}
        />
        <KpiCard label="Pesakit baru vs ulang" value={mixTotal ? `${Math.round((data.patientMix.returning / mixTotal) * 100)}% ulang` : "—"} hint={mixTotal ? `${data.patientMix.newPatients} baru · ${data.patientMix.returning} ulang` : "Tiada pesakit dalam tempoh ini"} />
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
        <Panel className="lg:col-span-3" title="Diagnosis teratas & trend 12 minggu" subtitle="bilangan kes · sparkline = kes seminggu · anak panah vs tempoh sebelum">
          {data.diagnoses.length ? (
            <ul className="divide-y divide-slate-100">
              {data.diagnoses.map((d) => (
                <li key={d.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto_96px_96px]">
                  <span className="truncate text-sm text-slate-800" title={d.name}>{d.name}</span>
                  <span className="text-right text-sm font-semibold tabular-nums text-slate-950">{fmtInt(d.value)}</span>
                  <span className="hidden sm:block"><Sparkline data={d.weekly} /></span>
                  <span className="min-w-[72px] text-right"><Delta pct={d.pct} suffix="" upIsGood={false} /></span>
                </li>
              ))}
            </ul>
          ) : <EmptyState>Tiada diagnosis direkod dalam tempoh ini.</EmptyState>}
        </Panel>
        <Panel className="lg:col-span-2" title="Umur & jantina" subtitle="semua pesakit berdaftar (yang ada tarikh lahir)">
          {ag && ag.some((r) => r.male + r.female > 0) ? (
            <div>
              <Legend items={[{ label: "Lelaki", color: PALETTE.blue }, { label: "Perempuan", color: PALETTE.orange }]} />
              <div className="space-y-2">
                {ag.map((r) => (
                  <div key={r.bucket} className="grid grid-cols-[minmax(0,1fr)_44px_minmax(0,1fr)] items-center gap-2 text-xs">
                    <div className="flex items-center justify-end gap-2"><span className="font-semibold tabular-nums">{r.male}</span><span className="h-3 rounded-l-sm" style={{ width: `${(r.male / agMax) * 70}%`, minWidth: r.male ? 3 : 0, background: PALETTE.blue }} /></div>
                    <span className="text-center font-medium text-slate-500">{r.bucket}</span>
                    <div className="flex items-center gap-2"><span className="h-3 rounded-r-sm" style={{ width: `${(r.female / agMax) * 70}%`, minWidth: r.female ? 3 : 0, background: PALETTE.orange }} /><span className="font-semibold tabular-nums">{r.female}</span></div>
                  </div>
                ))}
              </div>
            </div>
          ) : <EmptyState>Belum ada pesakit dengan tarikh lahir & jantina.</EmptyState>}
        </Panel>
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <Panel title="Ubat paling banyak dispens" subtitle="unit ditolak stok semasa checkout">
          {data.mostDispensed.length ? <HBarList items={data.mostDispensed} /> : <EmptyState>Belum ada dispens direkod dalam tempoh ini.</EmptyState>}
        </Panel>
        <Panel title="Order ikut jenis siasatan" subtitle={`bilangan order sahaja · keputusan di tab Lab · ikut ${o.bucketLabel}`}>
          {orderTotal ? (
            <>
              <Legend items={[{ label: `POCT ${o.totals.poct}`, color: PALETTE.blue }, { label: `X-ray ${o.totals.xray}`, color: PALETTE.orange }, { label: `Lab ${o.totals.lab}`, color: PALETTE.green }]} />
              <Stacked data={o.buckets} height={190} series={[{ key: "poct", label: "POCT", color: PALETTE.blue }, { key: "xray", label: "X-ray", color: PALETTE.orange }, { key: "lab", label: "Lab", color: PALETTE.green }]} />
            </>
          ) : <EmptyState>Tiada order POCT / X-ray / Lab dalam tempoh ini.</EmptyState>}
        </Panel>
        <Panel title="Follow-up" subtitle="peringatan temujanji & ulasan, ikut tempoh">
          {fuKnown && fuTotal > 0 ? (
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <Donut centre={`${Math.round(((fu.completed ?? 0) / fuTotal) * 100)}%`} centreLabel="siap" data={[
                { name: "Siap", value: fu.completed ?? 0, color: PALETTE.green },
                { name: "Belum selesai", value: fu.open ?? 0, color: PALETTE.amber },
                { name: "Dihentikan", value: fu.stopped ?? 0, color: PALETTE.slate },
              ]} />
              <ul className="w-full space-y-1.5 text-sm">
                {[["Siap", fu.completed, PALETTE.green], ["Belum selesai", fu.open, PALETTE.amber], ["Dihentikan", fu.stopped, PALETTE.slate]].map(([l, v, c]) => (
                  <li key={String(l)} className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: String(c) }} />{String(l)}</span><span className="font-semibold tabular-nums">{fmtInt(Number(v))}</span></li>
                ))}
                {fu.staleOpen ? <li className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">{fu.staleOpen} belum selesai lebih 14 hari</li> : null}
              </ul>
            </div>
          ) : <EmptyState>Tiada follow-up dalam tempoh ini.</EmptyState>}
        </Panel>
      </div>
      {data.truncated ? <p className="text-xs text-muted-foreground">Sebahagian data dipotong pada had paparan; pilih tempoh lebih pendek untuk angka penuh.</p> : null}
    </div>
  );
}
