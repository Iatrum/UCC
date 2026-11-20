"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertCircle,
  RefreshCw,
  UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QueueTable from "@/components/queue-table";
import Link from "next/link";
import dynamic from "next/dynamic";
import UpcomingAppointmentsTable, { normalizeAppointmentStatus } from "@/modules/appointments/components/upcoming-appointments-table";
import type { UpcomingAppointment } from "@/modules/appointments/components/upcoming-appointments-table";
import BillingTable from "@/components/billing/billing-table";
import type { BillableConsultation } from "@/lib/types";
import { useMedplumAuth } from "@/lib/auth-medplum";
import { loadQueueOnce, type QueuePatient } from "@/lib/dashboard/queue-load";
import { DashboardHeader } from "./dashboard-header";
import QueueState from "@/components/dashboard/queue-state";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { describeFetchError } from "@/lib/load-state";

const RegisterPatientDialog = dynamic(
  () => import("@/components/dashboard/register-patient-dialog").then((module) => module.RegisterPatientDialog),
);

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

export default function DashboardClient({ initialQueue }: { initialQueue: QueuePatient[] | null }) {
  const [queue, setQueue] = useState<QueuePatient[]>(initialQueue ?? []);
  const [appointments, setAppointments] = useState<UpcomingAppointment[]>([]);
  const [consultations, setConsultations] = useState<BillableConsultation[]>([]);
  const { loading: authLoading } = useMedplumAuth();
  const authReady = !authLoading;
  const canLoadTabs = initialQueue !== null || authReady;
  const [loading, setLoading] = useState(initialQueue === null);
  const [apptLoading, setApptLoading] = useState(true);
  const [apptError, setApptError] = useState<string | null>(null);
  const [consultationsLoading, setConsultationsLoading] = useState(true);
  const [consultationsError, setConsultationsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registerDialogOpen, setRegisterDialogOpen] = useState<boolean>();
  const queueControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const unloadingRef = useRef(false);
  const [queueLoaded, setQueueLoaded] = useState(initialQueue !== null);
  const needsInitialQueue = useRef(initialQueue === null);

  const loadQueue = useCallback(async () => {
    if (!mountedRef.current) return;
    queueControllerRef.current?.abort();
    const controller = new AbortController();
    queueControllerRef.current = controller;
    const isCurrentRequest = () => mountedRef.current && queueControllerRef.current === controller;
    setLoading(true);
    setError(null);
    const result = await loadQueueOnce(fetch, controller);
    if (!isCurrentRequest()) return;
    queueControllerRef.current = null;
    if (result.ok) {
      setQueue(result.patients);
      setQueueLoaded(true);
      needsInitialQueue.current = false;
    } else if (result.kind !== 'aborted' && !unloadingRef.current) {
      // Navigation/reload interrupts the fetch (aborted); that is not a real failure.
      console.error('Error loading queue:', result.kind);
      setError(result.message);
    }
    setLoading(false);
  }, []);

  const loadAppointments = useCallback(async () => {
    setApptLoading(true);
    setApptError(null);
    try {
      const response = await fetchWithTimeout('/api/appointments');
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
      if (mountedRef.current && !unloadingRef.current) setApptError(describeFetchError(err, 'Failed to load appointments.'));
    } finally {
      if (mountedRef.current) setApptLoading(false);
    }
  }, []);

  const loadConsultations = useCallback(async () => {
    setConsultationsLoading(true);
    setConsultationsError(null);
    try {
      const response = await fetchWithTimeout('/api/orders/billable');
      if (!response.ok) throw new Error('Failed to fetch consultations');
      const result = await response.json();
      setConsultations(result.consultations || []);
    } catch (err) {
      console.error('Error loading consultations:', err);
      if (mountedRef.current && !unloadingRef.current) setConsultationsError(describeFetchError(err, 'Failed to load billable consultations.'));
    } finally {
      if (mountedRef.current) setConsultationsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    unloadingRef.current = false;
    const onPageHide = () => { unloadingRef.current = true; };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
      queueControllerRef.current?.abort();
      queueControllerRef.current = null;
    };
  }, []);

  // The queue's client fallback still waits for session readiness.
  useEffect(() => {
    if (!authReady) return;
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      if (needsInitialQueue.current) void loadQueue();
    });
    const interval = setInterval(loadQueue, 30000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [authReady, loadQueue]);

  // A server-provided queue has already passed clinic authentication. Both
  // tab APIs validate the session cookie and can start before browser auth finishes.
  useEffect(() => {
    if (!canLoadTabs) return;
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      void loadAppointments();
      void loadConsultations();
    });
    return () => { disposed = true; };
  }, [canLoadTabs, loadAppointments, loadConsultations]);

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
      <DashboardHeader />

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
            <CardContent className="px-3 sm:px-6">
              <QueueState loading={loading || !authReady} loaded={queueLoaded} error={error} onRetry={loadQueue}>
                <div className="overflow-hidden rounded-2xl border border-slate-200/80">
                  <QueueTable patients={queue} onQueueUpdate={loadQueue} />
                </div>
              </QueueState>
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
                error={apptError}
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
              <BillingTable
                consultations={consultations}
                loading={consultationsLoading}
                error={consultationsError}
                onRetry={loadConsultations}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {registerDialogOpen !== undefined && <RegisterPatientDialog open={registerDialogOpen} onOpenChange={setRegisterDialogOpen} />}
    </div>
  );
}
