import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { WEEKDAY_LABELS } from "@/lib/analytics/range";

export const PALETTE = {
  blue: "#2563eb",
  orange: "#ea580c",
  green: "#059669",
  amber: "#d97706",
  pink: "#db2777",
  slate: "#64748b",
} as const;

export const fmtInt = (n: number) => n.toLocaleString("en-MY");
export const fmtRM = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export function Panel({ title, subtitle, children, className, action }: { title: string; subtitle?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <Card className={cn("border-slate-200/80 shadow-sm", className)}>
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function EmptyState({ children = "Belum ada data untuk tempoh ini.", className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-[96px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-xs text-muted-foreground", className)}>
      {children}
    </div>
  );
}

/** Percent/point change. `good` decides colour: up-is-good (revenue) or down-is-good (wait, antibiotics). */
export function Delta({ pct, suffix = "vs sebelum", unit = "%", upIsGood = true }: { pct: number | null | undefined; suffix?: string; unit?: string; upIsGood?: boolean }) {
  if (pct == null) return <span className="text-xs text-muted-foreground">Tiada asas banding</span>;
  const flat = Math.abs(pct) < 0.1;
  const good = flat ? null : (pct > 0) === upIsGood;
  const Icon = flat ? Minus : pct > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold", flat ? "text-slate-500" : good ? "text-emerald-700" : "text-red-600")}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {pct > 0 ? "+" : ""}{pct}{unit}
      <span className="ml-1 font-normal text-muted-foreground">{suffix}</span>
    </span>
  );
}

/** Dependency-free SVG sparkline; null values break the line. */
export function Sparkline({ data, color = PALETTE.blue, className }: { data: (number | null)[]; color?: string; className?: string }) {
  const pts = data.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length < 2) return <div className={cn("h-9 w-24", className)} aria-hidden />;
  const w = 100, h = 36, pad = 3;
  const max = Math.max(...pts.map((p) => p.v)), min = Math.min(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => (i / (data.length - 1)) * (w - pad * 2) + pad;
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-9 w-24 shrink-0 overflow-visible", className)} aria-hidden>
      <polyline fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")} />
      <circle cx={x(last.i)} cy={y(last.v)} r={2.5} fill={color} />
    </svg>
  );
}

export function KpiCard({ label, value, hint, delta, spark, color, className }: { label: string; value: ReactNode; hint?: ReactNode; delta?: ReactNode; spark?: (number | null)[]; color?: string; className?: string }) {
  return (
    <Card className={cn("border-slate-200/80 shadow-sm", className)}>
      <CardContent className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <div className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-950">{value}</div>
        {hint ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
        <div className="mt-2 flex items-end justify-between gap-2">
          <div className="min-w-0">{delta}</div>
          {spark ? <Sparkline data={spark} color={color} /> : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** Horizontal bar list with the value printed in text (accessible without hover). */
export function HBarList({ items, color = PALETTE.blue, format = fmtInt, max }: { items: { name: string; value: number }[]; color?: string; format?: (n: number) => string; max?: number }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto] items-center gap-3 text-sm">
          <span className="truncate text-slate-700" title={i.name}>{i.name}</span>
          <span className="h-2 rounded-full bg-slate-100">
            <span className="block h-2 rounded-full" style={{ width: `${Math.max(3, (i.value / top) * 100)}%`, background: color }} />
          </span>
          <span className="w-12 text-right font-semibold tabular-nums text-slate-950">{format(i.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Day x hour heatmap (one blue hue, darker = busier). Scrolls horizontally on phones. */
export function Heatmap({ matrix }: { matrix: number[][] }) {
  const flat = matrix.flat();
  const max = Math.max(0, ...flat);
  let first = 24, last = -1;
  matrix.forEach((row) => row.forEach((v, h) => { if (v > 0) { first = Math.min(first, h); last = Math.max(last, h); } }));
  const from = Math.min(8, first === 24 ? 8 : first), to = Math.max(20, last);
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  if (max === 0) return <EmptyState>Belum cukup kunjungan untuk heatmap.</EmptyState>;
  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <table className="w-full min-w-[520px] border-separate border-spacing-[3px] text-[10px] text-slate-500" aria-label="Heatmap kunjungan ikut hari dan jam">
          <thead>
            <tr>
              <th className="w-8" />
              {hours.map((h) => <th key={h} className="font-normal tabular-nums">{h % 2 === 0 ? h : ""}</th>)}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, d) => (
              <tr key={d}>
                <th className="pr-1 text-left font-medium">{WEEKDAY_LABELS[d]}</th>
                {hours.map((h) => {
                  const v = row[h];
                  const level = v === 0 ? 0 : 0.15 + 0.85 * (v / max);
                  return (
                    <td key={h} title={`${WEEKDAY_LABELS[d]} ${String(h).padStart(2, "0")}:00 — ${v} kunjungan`} className="h-6 rounded-[4px] border border-slate-100" style={{ background: v === 0 ? "#f8fafc" : `rgba(37,99,235,${level})` }} />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        kurang
        {[0.1, 0.3, 0.5, 0.75, 1].map((l) => <span key={l} className="h-3 w-3 rounded-[3px]" style={{ background: `rgba(37,99,235,${l})` }} />)}
        banyak
      </div>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />{i.label}</span>
      ))}
    </div>
  );
}
