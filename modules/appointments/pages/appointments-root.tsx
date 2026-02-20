"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Calendar, Clock, MapPin, Plus, UserRound, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAppointments, type Appointment, type AppointmentStatus } from "@/lib/models";
import { formatDisplayDate } from "@/lib/utils";

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: "Scheduled",
  checked_in: "Checked in",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No show",
};

const STATUS_VARIANTS: Record<AppointmentStatus, "default" | "secondary" | "destructive" | "outline"> = {
  scheduled: "secondary",
  checked_in: "default",
  in_progress: "default",
  completed: "outline",
  cancelled: "destructive",
  no_show: "destructive",
};

const ACTIVE_STATUSES: AppointmentStatus[] = ["scheduled", "checked_in", "in_progress"];

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function formatTime(date: Date | string): string {
  return toDate(date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatShortDate(date: Date | string): string {
  return toDate(date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function isToday(date: Date | string): boolean {
  const d = toDate(date);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function AppointmentCard({ appointment }: { appointment: Appointment }) {
  return (
    <Card className="transition-colors hover:border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="truncate text-base">{appointment.patientName}</CardTitle>
          <Badge variant={STATUS_VARIANTS[appointment.status]}>{STATUS_LABELS[appointment.status]}</Badge>
        </div>
        <CardDescription className="truncate">{appointment.reason || "Clinic visit"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 font-medium">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" /> {formatShortDate(appointment.scheduledAt)}
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> {formatTime(appointment.scheduledAt)}
          </span>
        </div>
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="flex items-center gap-2">
            <UserRound className="h-3.5 w-3.5" /> {appointment.clinician}
          </span>
          {appointment.location ? (
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> {appointment.location}
            </span>
          ) : null}
        </div>
        {appointment.notes ? (
          <p className="line-clamp-2 rounded-md bg-muted px-3 py-2 text-muted-foreground">{appointment.notes}</p>
        ) : null}
        <Button className="mt-1 w-full" variant="secondary" size="sm" asChild>
          <Link href={`/appointments/${appointment.id}`}>View details</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <Calendar className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button size="sm" asChild>
          <Link href="/appointments/new">
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Schedule appointment
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function AppointmentsRootPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError(null);
      setLoading(true);
      try {
        const data = await getAppointments();
        if (!cancelled) setAppointments(data);
      } catch (err) {
        console.error("Failed to load appointments", err);
        if (!cancelled) setError("Unable to load appointments right now. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const activeAppointments = useMemo(() => {
    return appointments
      .filter((a) => ACTIVE_STATUSES.includes(a.status))
      .sort((a, b) => toDate(a.scheduledAt).getTime() - toDate(b.scheduledAt).getTime());
  }, [appointments]);

  const todaysAppointments = useMemo(() => {
    return activeAppointments.filter((a) => isToday(a.scheduledAt));
  }, [activeAppointments]);

  const pastAppointments = useMemo(() => {
    return appointments
      .filter((a) => a.status === "completed" || a.status === "cancelled" || a.status === "no_show")
      .sort((a, b) => toDate(b.scheduledAt).getTime() - toDate(a.scheduledAt).getTime())
      .slice(0, 12);
  }, [appointments]);

  const counts = useMemo(() => {
    const c = { total: 0, active: 0, today: todaysAppointments.length, completed: 0 };
    for (const a of appointments) {
      c.total++;
      if (ACTIVE_STATUSES.includes(a.status)) c.active++;
      if (a.status === "completed") c.completed++;
    }
    return c;
  }, [appointments, todaysAppointments.length]);

  return (
    <div className="space-y-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Appointments</h1>
          <p className="text-sm text-muted-foreground">Manage patient bookings and track visits.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/appointments/new"><Plus className="mr-1.5 h-4 w-4" /> New appointment</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/patients"><Users className="mr-1.5 h-4 w-4" /> View patients</Link>
          </Button>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total", desc: "All appointments", value: counts.total },
          { label: "Today", desc: "Scheduled for today", value: counts.today },
          { label: "Active", desc: "Awaiting or in-progress", value: counts.active },
          { label: "Completed", desc: "Visits completed", value: counts.completed },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
              <CardDescription>{stat.desc}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{loading ? "-" : stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
      ) : null}

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active ({activeAppointments.length})</TabsTrigger>
          <TabsTrigger value="today">Today ({todaysAppointments.length})</TabsTrigger>
          <TabsTrigger value="past">Past ({pastAppointments.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4">
          {loading ? (
            <Card>
              <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4 animate-pulse" /> Loading appointments...
              </CardContent>
            </Card>
          ) : activeAppointments.length === 0 ? (
            <EmptyState message="No active appointments. Schedule one to get started." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {activeAppointments.map((a) => <AppointmentCard key={a.id} appointment={a} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="today" className="mt-4">
          {loading ? (
            <Card>
              <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4 animate-pulse" /> Loading...
              </CardContent>
            </Card>
          ) : todaysAppointments.length === 0 ? (
            <EmptyState message="No appointments scheduled for today." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {todaysAppointments.map((a) => <AppointmentCard key={a.id} appointment={a} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="past" className="mt-4">
          {loading ? (
            <Card>
              <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4 animate-pulse" /> Loading...
              </CardContent>
            </Card>
          ) : pastAppointments.length === 0 ? (
            <EmptyState message="No past appointments to show." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {pastAppointments.map((a) => <AppointmentCard key={a.id} appointment={a} />)}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
