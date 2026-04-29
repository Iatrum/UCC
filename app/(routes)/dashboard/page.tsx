"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Clock, RefreshCw, Users, CalendarDays, Activity } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Patient } from "@/lib/models";
import QueueTable from "@/components/queue-table";
import Link from "next/link";
import { toast } from "@/components/ui/use-toast";
import { addPatientToQueue, removePatientFromQueue } from "@/lib/actions";
import { RegisterPatientDialog } from "@/components/dashboard/register-patient-dialog";
import UpcomingAppointmentsTable, { normalizeAppointmentStatus } from "@/modules/appointments/components/upcoming-appointments-table";
import type { UpcomingAppointment } from "@/modules/appointments/components/upcoming-appointments-table";

interface RawAppointment {
  id: string;
  patientId?: string;
  patientName: string;
  clinician: string;
  reason?: string;
  status: string;
  scheduledAt?: string;
  date?: string;
}

export default function Dashboard() {
  const [queue, setQueue] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<UpcomingAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [apptLoading, setApptLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);

  const loadQueue = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/queue');
      if (!response.ok) throw new Error(`Failed to fetch queue: ${response.statusText}`);
      const result = await response.json();
      setQueue(result.patients || []);
    } catch (err) {
      console.error('Error loading queue:', err);
      setError('Failed to load queue data.');
    } finally {
      setLoading(false);
    }
  };

  const loadAppointments = async () => {
    setApptLoading(true);
    try {
      const response = await fetch('/api/appointments');
      if (!response.ok) throw new Error(`Failed to fetch appointments`);
      const result = await response.json();
      const raw: RawAppointment[] = result.appointments || [];
      const mapped: UpcomingAppointment[] = raw.map((a) => ({
        id: a.id,
        patientId: a.patientId,
        patientName: a.patientName,
        clinician: a.clinician,
        reason: a.reason,
        status: normalizeAppointmentStatus(a.status),
        scheduledAt: a.scheduledAt || a.date || new Date().toISOString(),
      }));
      setAppointments(mapped);
    } catch (err) {
      console.error('Error loading appointments:', err);
    } finally {
      setApptLoading(false);
    }
  };

  useEffect(() => {
    loadQueue();
    loadAppointments();
    const interval = setInterval(loadQueue, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    await Promise.all([loadQueue(), loadAppointments()]);
    toast({ title: "Dashboard Updated", description: "Queue and appointments refreshed." });
  };

  const waiting = queue.filter(p => p.queueStatus === 'waiting' || p.queueStatus === 'arrived');
  const inProgress = queue.filter(p => p.queueStatus === 'in_consultation');

  const upcomingAppointments = useMemo(() => {
    const now = new Date();
    return appointments
      .filter((a) => {
        const scheduled = new Date(a.scheduledAt);
        return scheduled.getTime() >= now.getTime() && ["scheduled", "checked_in"].includes(a.status);
      })
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }, [appointments]);

  const todayAppts = useMemo(() => {
    const now = new Date();
    return upcomingAppointments.filter((a) => {
      const d = new Date(a.scheduledAt);
      return d.toDateString() === now.toDateString();
    });
  }, [upcomingAppointments]);

  return (
    <div className="flex flex-col space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button onClick={() => setRegisterDialogOpen(true)}>Register</Button>
          <Button variant="outline" size="icon" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Today&apos;s Queue</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{queue.length}</div>
            <p className="text-xs text-muted-foreground">{waiting.length} waiting</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">In Consultation</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inProgress.length}</div>
            <p className="text-xs text-muted-foreground">active now</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Today&apos;s Appointments</CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{todayAppts.length}</div>
            <p className="text-xs text-muted-foreground">scheduled today</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Appointments</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{appointments.length}</div>
            <p className="text-xs text-muted-foreground">all upcoming</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="queue" className="space-y-4">
        <TabsList>
          <TabsTrigger value="queue">Today&apos;s Queue</TabsTrigger>
          <TabsTrigger value="appointments">Appointments</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Patient Queue</CardTitle>
              <CardDescription>Patients waiting for consultation today</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-4 text-muted-foreground">Loading queue…</div>
              ) : error ? (
                <div className="text-center py-4 text-red-500">{error}</div>
              ) : (
                <QueueTable patients={queue} onQueueUpdate={loadQueue} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appointments" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Appointments</CardTitle>
              <CardDescription>
                Upcoming scheduled appointments.{" "}
                <Link href="/appointments" className="underline text-primary">View all</Link>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UpcomingAppointmentsTable
                appointments={upcomingAppointments}
                loading={apptLoading}
                onRefresh={loadAppointments}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <RegisterPatientDialog open={registerDialogOpen} onOpenChange={setRegisterDialogOpen} />
    </div>
  );
}
