import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  Clock,
  MapPin,
  Phone,
  UserRound,
  FileText,
  ClipboardList,
} from "lucide-react";

import { getAppointmentById } from "@/lib/models";
import { formatDisplayDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import AppointmentStatusForm from "../components/status-form";
import type { AppointmentStatus } from "@/lib/models";

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: "Scheduled",
  checked_in: "Checked in",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No show",
};

const STATUS_DESCRIPTIONS: Record<AppointmentStatus, string> = {
  scheduled: "Awaiting patient arrival",
  checked_in: "Patient has arrived and is waiting",
  in_progress: "Clinical team is currently seeing the patient",
  completed: "Visit completed and documented",
  cancelled: "Cancelled by clinic or patient",
  no_show: "Patient did not attend",
};

const BADGE_VARIANTS: Record<AppointmentStatus, "default" | "secondary" | "outline" | "destructive"> = {
  scheduled: "secondary",
  checked_in: "default",
  in_progress: "default",
  completed: "outline",
  cancelled: "destructive",
  no_show: "destructive",
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function formatTime(date: Date | null) {
  if (!date) return "-";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(date: Date | null) {
  if (!date) return "-";
  return date.toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DetailRow({ icon: Icon, label, value }: { icon: typeof Calendar; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{value}</p>
      </div>
    </div>
  );
}

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AppointmentDetailsPage({ params }: PageProps) {
  const { id } = await params;
  const appointment = await getAppointmentById(id);

  if (!appointment) {
    notFound();
  }

  const scheduledAt = toDate(appointment.scheduledAt) ?? new Date();
  const checkInTime = toDate(appointment.checkInTime);
  const completedAt = toDate(appointment.completedAt);
  const cancelledAt = toDate(appointment.cancelledAt);

  return (
    <div className="container max-w-4xl space-y-6 py-6">
      <div className="flex items-center justify-between">
        <Link href="/appointments" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to appointments
        </Link>
        <Badge variant={BADGE_VARIANTS[appointment.status]}>{STATUS_LABELS[appointment.status]}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{appointment.patientName}</CardTitle>
          <CardDescription>
            {appointment.reason || "Clinic visit"} &middot; {appointment.clinician} &middot; {formatDateTime(scheduledAt)}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <DetailRow icon={Calendar} label="Visit date" value={formatDisplayDate(scheduledAt)} />
            <DetailRow
              icon={Clock}
              label="Time & duration"
              value={`${formatTime(scheduledAt)} \u2022 ${appointment.durationMinutes ? `${appointment.durationMinutes} min` : "Not set"}`}
            />
            <DetailRow icon={UserRound} label="Clinician" value={appointment.clinician} />
            {appointment.location ? <DetailRow icon={MapPin} label="Location" value={appointment.location} /> : null}
            {appointment.patientContact ? <DetailRow icon={Phone} label="Contact" value={appointment.patientContact} /> : null}
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Status</p>
              <p className="mt-1 text-sm">{STATUS_DESCRIPTIONS[appointment.status]}</p>
            </div>

            <div className="rounded-md border p-4 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                Visit checkpoints
              </p>
              <dl className="mt-3 space-y-2 text-muted-foreground">
                {[
                  { label: "Scheduled", value: formatDateTime(scheduledAt) },
                  { label: "Checked in", value: formatDateTime(checkInTime) },
                  { label: "Completed", value: formatDateTime(completedAt) },
                  { label: "Cancelled", value: formatDateTime(cancelledAt) },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between">
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">Update status</p>
              <div className="mt-2">
                <AppointmentStatusForm
                  appointmentId={appointment.id}
                  currentStatus={appointment.status}
                  hasCheckIn={!!checkInTime}
                  hasCompleted={!!completedAt}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {appointment.notes ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="rounded-md bg-muted p-4 text-sm leading-relaxed text-muted-foreground">{appointment.notes}</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
