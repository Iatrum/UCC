"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertCircle,
  RefreshCw,
  UserPlus,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Patient } from "@/lib/models";
import QueueTable from "@/components/queue-table";
import Link from "next/link";
import { RegisterPatientDialog } from "@/components/dashboard/register-patient-dialog";
import UpcomingAppointmentsTable, { normalizeAppointmentStatus } from "@/modules/appointments/components/upcoming-appointments-table";
import type { UpcomingAppointment } from "@/modules/appointments/components/upcoming-appointments-table";
import BillingTable from "@/components/billing/billing-table";
import { BillableConsultation } from "@/lib/types";

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
  const [consultations, setConsultations] = useState<BillableConsultation[]>([]);
  const [loading, setLoading] = useState(true);
  const [apptLoading, setApptLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);
  const queueControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);

  const loadQueue = async () => {
    if (!mountedRef.current) return;
    queueControllerRef.current?.abort();
    const controller = new AbortController();
    queueControllerRef.current = controller;
    const isCurrentRequest = () => mountedRef.current && queueControllerRef.current === controller;
    setLoading(true);
    setError(null);
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/queue', { signal: controller.signal });
      if (!response.ok) throw new Error(`Failed to fetch queue: ${response.statusText}`);
      const result = await response.json();
      if (isCurrentRequest() && !controller.signal.aborted) {
        setQueue(result.patients || []);
      }
    } catch (err) {
      if (!isCurrentRequest()) return;
      console.error('Error loading queue:', err);
      if (controller.signal.aborted) {
        setError('Queue is taking too long to load.');
      } else {
        setError('Failed to load queue data.');
      }
    } finally {
      clearTimeout(timeoutId);
      if (isCurrentRequest()) {
        queueControllerRef.current = null;
        setLoading(false);
      }
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

  const loadConsultations = async () => {
    try {
      const response = await fetch('/api/orders/billable');
      if (!response.ok) throw new Error('Failed to fetch consultations');
      const result = await response.json();
      setConsultations(result.consultations || []);
    } catch (err) {
      console.error('Error loading consultations:', err);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      void loadQueue();
      void loadAppointments();
      void loadConsultations();
    });
    const interval = setInterval(loadQueue, 30000);
    return () => {
      disposed = true;
      mountedRef.current = false;
      clearInterval(interval);
      queueControllerRef.current?.abort();
      queueControllerRef.current = null;
    };
  }, []);

  const upcomingAppointments = useMemo(() => {
    const now = new Date();
    return appointments
      .filter((a) => {
        const scheduled = new Date(a.scheduledAt);
        return scheduled.getTime() >= now.getTime() && ["scheduled", "checked_in"].includes(a.status);
      })
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }, [appointments]);

  return (
    <div className="space-y-6 pb-10">
      <div className="space-y-2">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Live clinic queue, upcoming appointments, and documents ready for billing.
          </p>
        </div>
      </div>

      {error ? (
        <div role="status" aria-live="polite" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-950">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <p className="font-medium">Queue could not be refreshed</p>
            <p className="mt-1 text-rose-800">{error}</p>
          </div>
        </div>
      ) : null}

      <Tabs defaultValue="queue" className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <TabsList className="h-auto flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2">
            <TabsTrigger value="queue" className="rounded-xl">Today&apos;s Queue</TabsTrigger>
            <TabsTrigger value="appointments" className="rounded-xl">Appointments</TabsTrigger>
            <TabsTrigger value="billing" className="rounded-xl">Billing</TabsTrigger>
          </TabsList>
          <Button onClick={() => setRegisterDialogOpen(true)} className="gap-2">
            <UserPlus className="h-4 w-4" />
            Register
          </Button>
        </div>

        <TabsContent value="queue" className="space-y-4">
          <Card className="border-slate-200/80 shadow-sm">
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Patient queue</CardTitle>
                <CardDescription>Patients waiting for consultation today.</CardDescription>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={loadQueue}
                aria-label="Refresh queue"
                title="Refresh queue"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div role="status" aria-live="polite" className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-10 text-center text-sm text-muted-foreground">
                  Loading queue...
                </div>
              ) : error ? (
                <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-800">
                  <p>{error}</p>
                  <Button variant="outline" size="sm" onClick={loadQueue} className="gap-2">
                    <RefreshCw className="h-4 w-4" />
                    Retry
                  </Button>
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-slate-200/80">
                  <QueueTable patients={queue} onQueueUpdate={loadQueue} />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appointments" className="space-y-4">
          <Card className="border-slate-200/80 shadow-sm">
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Appointments</CardTitle>
                <CardDescription>Upcoming scheduled appointments.</CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href="/appointments">View all</Link>
              </Button>
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

        <TabsContent value="billing" className="space-y-4">
          <Card className="border-slate-200/80 shadow-sm">
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Billing & Documents</CardTitle>
                <CardDescription>Open checkout for completed consultations.</CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href="/orders">View all</Link>
              </Button>
            </CardHeader>
            <CardContent>
              <BillingTable consultations={consultations} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <RegisterPatientDialog open={registerDialogOpen} onOpenChange={setRegisterDialogOpen} />
    </div>
  );
}
