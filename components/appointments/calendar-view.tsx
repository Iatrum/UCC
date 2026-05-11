"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AppointmentStatus = "scheduled" | "checked_in" | "completed" | "cancelled" | "no_show";

export interface CalendarAppointment {
  id: string;
  patientId: string;
  patientName: string;
  clinician: string;
  reason: string;
  status: AppointmentStatus;
  scheduledAt: Date | string;
}

const PILL_CLASSES: Record<AppointmentStatus, string> = {
  scheduled: "bg-indigo-50 text-indigo-900 border border-indigo-200",
  checked_in: "bg-blue-100 text-blue-800 border border-blue-400",
  completed: "bg-green-100 text-green-800 border border-green-400",
  cancelled: "bg-red-50 text-red-700 border border-dashed border-red-400 line-through opacity-75",
  no_show: "bg-red-100 text-red-900 border border-dashed border-red-600",
};

const DOT_CLASSES: Record<AppointmentStatus, string> = {
  scheduled: "bg-indigo-400",
  checked_in: "bg-blue-500",
  completed: "bg-green-500",
  cancelled: "bg-red-400",
  no_show: "bg-red-600",
};

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: "Scheduled",
  checked_in: "Checked in",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No show",
};

const TODAY_BADGE_CLASSES: Record<AppointmentStatus, string> = {
  scheduled: "bg-indigo-50 text-indigo-900 border border-indigo-200 hover:bg-indigo-50",
  checked_in: "bg-blue-100 text-blue-800 border border-blue-400 hover:bg-blue-100",
  completed: "bg-green-100 text-green-800 border border-green-400 hover:bg-green-100",
  cancelled: "bg-red-50 text-red-700 border border-dashed border-red-400 opacity-75 hover:bg-red-50",
  no_show: "bg-red-100 text-red-900 border border-dashed border-red-600 hover:bg-red-100",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const LEGEND = [
  { status: "scheduled" as const, label: "Scheduled" },
  { status: "checked_in" as const, label: "Checked in" },
  { status: "completed" as const, label: "Completed" },
  { status: "cancelled" as const, label: "Cancelled" },
  { status: "no_show" as const, label: "No show" },
];

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildMonthGrid(year: number, month: number): { date: Date; isCurrentMonth: boolean }[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const leadingDays = firstDay.getDay(); // 0 = Sunday
  const cells: { date: Date; isCurrentMonth: boolean }[] = [];

  for (let i = leadingDays; i > 0; i--) {
    cells.push({ date: new Date(year, month, 1 - i), isCurrentMonth: false });
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    cells.push({ date: new Date(year, month, d), isCurrentMonth: true });
  }
  const trailing = 42 - cells.length;
  for (let d = 1; d <= trailing; d++) {
    cells.push({ date: new Date(year, month + 1, d), isCurrentMonth: false });
  }

  return cells;
}

function formatTime(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

interface Props {
  appointments: CalendarAppointment[];
}

export default function AppointmentsCalendarView({ appointments }: Props) {
  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => toDateKey(today), [today]);

  const [currentDate, setCurrentDate] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);

  const appointmentsByDate = useMemo(() => {
    const map = new Map<string, CalendarAppointment[]>();
    for (const appt of appointments) {
      const d = appt.scheduledAt instanceof Date ? appt.scheduledAt : new Date(appt.scheduledAt);
      const key = toDateKey(d);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(appt);
    }
    return map;
  }, [appointments]);

  const todayAppointments = useMemo(
    () =>
      (appointmentsByDate.get(todayKey) ?? []).slice().sort(
        (a, b) =>
          new Date(a.scheduledAt as string).getTime() -
          new Date(b.scheduledAt as string).getTime()
      ),
    [appointmentsByDate, todayKey]
  );

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentDate(new Date(year, month - 1, 1))}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1))}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentDate(new Date(year, month + 1, 1))}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h2 className="ml-1 text-lg font-semibold">
            {MONTH_NAMES[month]} {year}
          </h2>
        </div>

        {/* View mode toggle — Week and Day are placeholders */}
        <div className="flex overflow-hidden rounded-md border border-input">
          {(["Month", "Week", "Day"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={mode !== "Month"}
              className={[
                "px-3 py-1.5 text-sm font-medium transition-colors",
                mode === "Month"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40",
              ].join(" ")}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* ── Calendar grid ── */}
      <div className="overflow-hidden rounded-lg border border-border">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-border bg-muted/40">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="py-2 text-center text-xs font-medium text-muted-foreground"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Day cells — 6 rows × 7 cols = 42 cells */}
        <div className="grid grid-cols-7">
          {grid.map(({ date, isCurrentMonth }, idx) => {
            const key = toDateKey(date);
            const dayAppts = appointmentsByDate.get(key) ?? [];
            const isToday = key === todayKey;
            const visible = dayAppts.slice(0, 2);
            const overflow = dayAppts.length - visible.length;
            const isLastCol = idx % 7 === 6;
            const isLastRow = idx >= 35;

            return (
              <div
                key={idx}
                className={[
                  "min-h-[96px] p-1.5",
                  !isLastCol && "border-r border-border",
                  !isLastRow && "border-b border-border",
                  isCurrentMonth ? "bg-background" : "bg-muted/20",
                ].filter(Boolean).join(" ")}
              >
                {/* Date number */}
                <div className="mb-1 flex justify-end">
                  <span
                    className={[
                      "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                      isToday
                        ? "bg-primary text-primary-foreground"
                        : isCurrentMonth
                          ? "text-foreground"
                          : "text-muted-foreground/50",
                    ].join(" ")}
                  >
                    {date.getDate()}
                  </span>
                </div>

                {/* Pills */}
                <div className="space-y-0.5">
                  {visible.map((appt) => (
                    <div
                      key={appt.id}
                      title={`${appt.patientName} · ${formatTime(appt.scheduledAt)}`}
                      className={[
                        "flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium leading-tight",
                        PILL_CLASSES[appt.status] ?? "bg-muted text-muted-foreground",
                      ].join(" ")}
                    >
                      <span className={["h-1.5 w-1.5 shrink-0 rounded-full", DOT_CLASSES[appt.status] ?? "bg-muted-foreground"].join(" ")} />
                      <span className="truncate">{formatTime(appt.scheduledAt)} {appt.patientName}</span>
                    </div>
                  ))}
                  {overflow > 0 && (
                    <div className="px-1 text-[11px] text-muted-foreground">
                      +{overflow} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Today's appointments panel ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Today&apos;s appointments
          </CardTitle>
        </CardHeader>
        <CardContent>
          {todayAppointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No appointments today.</p>
          ) : (
            <div className="divide-y divide-border">
              {todayAppointments.map((appt) => (
                <div
                  key={appt.id}
                  className="flex items-center justify-between gap-4 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-14 shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
                      {formatTime(appt.scheduledAt)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{appt.patientName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {appt.reason || "Clinic visit"} · {appt.clinician || "N/A"}
                      </p>
                    </div>
                  </div>
                  <Badge className={TODAY_BADGE_CLASSES[appt.status]}>
                    {STATUS_LABELS[appt.status] ?? appt.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Color legend ── */}
      <div className="flex flex-wrap gap-4">
        {LEGEND.map(({ status, label }) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${PILL_CLASSES[status]}`} />
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
