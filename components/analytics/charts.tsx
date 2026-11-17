"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PALETTE, fmtInt } from "./primitives";

const axis = { fontSize: 11, fill: "#64748b" };
const grid = "#e5e7eb";

function Tip({ active, payload, label, format }: { active?: boolean; payload?: { name?: string; value?: number | null; color?: string }[]; label?: string; format?: (n: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      {payload.filter((p) => p.value != null).map((p) => (
        <div key={p.name} className="flex items-center gap-1.5 text-sm font-semibold text-slate-950">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          {payload.length > 1 ? `${p.name}: ` : ""}{(format ?? fmtInt)(p.value as number)}
        </div>
      ))}
    </div>
  );
}

type Pt = { name: string; value: number | null };

export function AreaTrend({ data, color = PALETTE.blue, format, height = 220 }: { data: Pt[]; color?: string; format?: (n: number) => string; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="name" tick={axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={axis} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))} />
          <Tooltip content={<Tip format={format} />} />
          <Area type="monotone" dataKey="value" name="Nilai" stroke={color} fill={color} fillOpacity={0.12} strokeWidth={2} dot={{ r: 2.5 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Columns({ data, color = PALETTE.blue, height = 220, highlightMax = true }: { data: Pt[]; color?: string; height?: number; highlightMax?: boolean }) {
  const max = Math.max(0, ...data.map((d) => d.value ?? 0));
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 16, bottom: 0 }}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="name" tick={axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={axis} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
          <Tooltip cursor={{ fill: "#f1f5f9" }} content={<Tip />} />
          <Bar dataKey="value" name="Kunjungan" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={color} fillOpacity={highlightMax && d.value === max && max > 0 ? 1 : 0.55} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WaitLine({ data, target }: { data: Pt[]; target: number }) {
  const max = Math.max(target + 5, ...data.map((d) => d.value ?? 0));
  return (
    <div className="h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="name" tick={axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={axis} axisLine={false} tickLine={false} width={32} domain={[0, Math.ceil(max / 5) * 5]} />
          <Tooltip content={<Tip format={(n) => `${n} min`} />} />
          <ReferenceLine y={target} stroke="#64748b" strokeDasharray="4 4" label={{ value: `sasaran ${target}`, position: "insideTopRight", fontSize: 11, fill: "#64748b" }} />
          <Line type="monotone" dataKey="value" name="Menunggu" stroke={PALETTE.orange} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Stacked({ data, series, format, height = 240 }: { data: Record<string, string | number>[]; series: { key: string; label: string; color: string }[]; format?: (n: number) => string; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="name" tick={axis} axisLine={false} tickLine={false} interval={0} />
          <YAxis tick={axis} axisLine={false} tickLine={false} width={44} allowDecimals={false} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))} />
          <Tooltip cursor={{ fill: "#f1f5f9" }} content={<Tip format={format} />} />
          {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Donut({ data, centre, centreLabel }: { data: { name: string; value: number; color: string }[]; centre: string; centreLabel?: string }) {
  return (
    <div className="relative h-[150px] w-[150px] shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={70} paddingAngle={data.filter((d) => d.value > 0).length > 1 ? 2 : 0} stroke="none">
            {data.map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
          <Tooltip content={<Tip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold text-slate-950">{centre}</span>
        {centreLabel ? <span className="text-[11px] text-muted-foreground">{centreLabel}</span> : null}
      </div>
    </div>
  );
}
