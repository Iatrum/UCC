"use client";

import type { ReactNode } from "react";
import { useState, useTransition, useMemo, useEffect, useRef } from "react";
import {
  Bell,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  MessageCircle,
  Phone,
  Plus,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import type { FollowUp, FollowUpType } from "@/lib/fhir/communication-service";

type Tab = "pending" | "scheduled" | "sent";

const STATUS_BY_TAB = {
  pending: "preparation",
  scheduled: "in-progress",
  sent: "completed",
} as const;

const MAX_MESSAGE_LENGTH = 500;

const WA_TEMPLATES: Record<string, (name: string, date?: string, time?: string) => string> = {
  "review-request": (name) =>
    `Hi ${name} 👋, thank you for choosing Iatrum Clinic for your healthcare needs. We truly appreciate your visit! Could you take a moment to leave us a review? It helps other patients find the right care. Thank you so much 🙏`,
  "appointment-reminder": (name, date, time) =>
    `Hi ${name} 👋, this is a friendly reminder that you have an upcoming appointment at Iatrum Clinic on ${date ?? "your scheduled date"} at ${time ?? "your scheduled time"}. Please arrive on time. Do not hesitate to contact us if you need to reschedule. Thank you 🙏`,
};

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("60")) return digits;
  if (digits.startsWith("0")) return "60" + digits.slice(1);
  return "60" + digits;
}

function formatDate(value?: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function TypeBadge({ type }: { type: FollowUpType }) {
  if (type === "review-request") {
    return (
      <Badge variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200">
        <Calendar className="mr-1 h-3 w-3" />
        Review Request
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-blue-200">
      <Bell className="mr-1 h-3 w-3" />
      Appointment Reminder
    </Badge>
  );
}

function StatusBadge({ status }: { status: FollowUp["status"] }) {
  switch (status) {
    case "preparation":
      return <Badge variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200">Pending</Badge>;
    case "in-progress":
      return <Badge variant="secondary" className="bg-sky-100 text-sky-700 hover:bg-sky-100 border-sky-200">Scheduled</Badge>;
    case "completed":
      return <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200">Sent</Badge>;
    case "stopped":
      return <Badge variant="secondary" className="bg-rose-100 text-rose-700 hover:bg-rose-100 border-rose-200">Failed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function EmptyState({ tab }: { tab: Tab }) {
  const content: Record<Tab, { title: string; description: string }> = {
    pending: {
      title: "No pending follow ups",
      description: "Create a new follow up using the button above.",
    },
    scheduled: {
      title: "No scheduled follow ups",
      description: "Pending follow ups that have been scheduled will appear here.",
    },
    sent: {
      title: "No follow ups sent yet",
      description: "Follow ups marked as sent will appear here.",
    },
  };
  const { title, description } = content[tab];
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={5}>
        <div className="flex flex-col items-center gap-3 py-14">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
            <MessageCircle className="h-6 w-6 text-slate-400" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-slate-600">{title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

function StatCard({
  icon,
  label,
  count,
  hint,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-sm text-slate-600">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{count}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

type AppointmentOption = { id: string; date: string; isoDate: string; time: string; clinician: string };

interface NewFollowUpForm {
  patientId: string;
  patientName: string;
  patientPhone: string;
  type: FollowUpType;
  dueDate: string;
  appointmentId: string;
  appointmentDate: string;
  appointmentTime: string;
}

const EMPTY_FORM: NewFollowUpForm = {
  patientId: "",
  patientName: "",
  patientPhone: "",
  type: "review-request",
  dueDate: "",
  appointmentId: "",
  appointmentDate: "",
  appointmentTime: "",
};

type PatientResult = { id: string; name: string; phone: string };

interface Props {
  initialFollowUps: FollowUp[];
}

export default function FollowUpClient({ initialFollowUps }: Props) {
  const [followUps, setFollowUps] = useState<FollowUp[]>(initialFollowUps);
  const [activeTab, setActiveTab] = useState<Tab>("pending");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<NewFollowUpForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // WhatsApp dialog state
  const [waDialogOpen, setWaDialogOpen] = useState(false);
  const [waFollowUp, setWaFollowUp] = useState<FollowUp | null>(null);
  const [waMessage, setWaMessage] = useState("");

  // Patient search state
  const [patientResults, setPatientResults] = useState<PatientResult[]>([]);
  const [patientSearching, setPatientSearching] = useState(false);
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);
  const patientInputRef = useRef<HTMLInputElement>(null);

  // Appointment state (for appointment-reminder type)
  const [appointments, setAppointments] = useState<AppointmentOption[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);

  // Debounced patient search
  useEffect(() => {
    const q = form.patientName.trim();
    if (form.patientId || q.length < 2) {
      setPatientResults([]);
      setShowPatientDropdown(false);
      return;
    }
    const timer = setTimeout(async () => {
      setPatientSearching(true);
      try {
        const res = await fetch(`/api/patients?search=${encodeURIComponent(q)}`);
        const payload = await res.json().catch(() => ({}));
        if (res.ok && payload.success) {
          const results: PatientResult[] = (payload.patients ?? []).map(
            (p: { id: string; fullName: string; phone: string }) => ({ id: p.id, name: p.fullName, phone: p.phone ?? "" })
          );
          setPatientResults(results);
          setShowPatientDropdown(results.length > 0);
        }
      } catch {
        // silent
      } finally {
        setPatientSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [form.patientName, form.patientId]);

  // Load patient appointments when type is appointment-reminder and patient is selected
  useEffect(() => {
    if (form.type !== "appointment-reminder" || !form.patientId) {
      setAppointments([]);
      return;
    }
    let cancelled = false;
    setAppointmentsLoading(true);
    fetch(`/api/appointments?patientId=${encodeURIComponent(form.patientId)}`)
      .then((r) => r.json())
      .catch(() => ({}))
      .then((payload) => {
        if (cancelled) return;
        if (payload.success) {
          const startOfToday = new Date();
          startOfToday.setHours(0, 0, 0, 0);
          const opts: AppointmentOption[] = (payload.appointments ?? [])
            .filter((a: { scheduledAt: string }) => new Date(a.scheduledAt) >= startOfToday)
            .map((a: { id: string; scheduledAt: string; clinician: string }) => {
              const dt = new Date(a.scheduledAt);
              return {
                id: a.id,
                date: dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
                isoDate: dt.toISOString().split("T")[0],
                time: dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
                clinician: a.clinician,
              };
            });
          setAppointments(opts);
        }
      })
      .finally(() => { if (!cancelled) setAppointmentsLoading(false); });
    return () => { cancelled = true; };
  }, [form.patientId, form.type]);

  const filtered = useMemo(() => {
    const targetStatus = STATUS_BY_TAB[activeTab];
    return followUps.filter((f) => {
      if (f.status !== targetStatus) return false;
      if (!search.trim()) return true;
      return f.patientName.toLowerCase().includes(search.toLowerCase());
    });
  }, [followUps, activeTab, search]);

  async function reload() {
    try {
      const res = await fetch("/api/follow-up");
      const payload = await res.json().catch(() => ({}));
      if (res.ok && payload.success) {
        setFollowUps(payload.followUps ?? []);
      }
    } catch {
      // silent
    }
  }

  async function handleCreate() {
    setFormError(null);
    if (!form.patientName.trim()) { setFormError("Patient name is required."); return; }
    if (form.type === "appointment-reminder" && form.patientId && appointments.length > 0 && !form.appointmentId) {
      setFormError("Please select an appointment."); return;
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/follow-up", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patientName: form.patientName.trim(),
            patientId: form.patientId || undefined,
            patientPhone: form.patientPhone || undefined,
            type: form.type,
            dueDate: form.dueDate || undefined,
            appointmentId: form.appointmentId || undefined,
            appointmentDate: form.appointmentDate || undefined,
            appointmentTime: form.appointmentTime || undefined,
          }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.success) throw new Error(payload.error || "Failed to create");
        toast({ title: "Follow up created", description: `Added for ${form.patientName}.` });
        setDialogOpen(false);
        setForm(EMPTY_FORM);
        await reload();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Failed to create follow up.");
      }
    });
  }

  async function handleDismiss(id: string, patientName: string) {
    setActionId(id);
    try {
      const res = await fetch(`/api/follow-up/${id}`, { method: "DELETE" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.success) throw new Error(payload.error || "Failed to dismiss");
      toast({ title: "Dismissed", description: `Follow up for ${patientName} removed.` });
      setFollowUps((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to dismiss follow up.",
        variant: "destructive",
      });
    } finally {
      setActionId(null);
    }
  }

  const totals = useMemo(
    () => ({
      pending: followUps.filter((f) => f.status === "preparation").length,
      scheduled: followUps.filter((f) => f.status === "in-progress").length,
      sent: followUps.filter((f) => f.status === "completed").length,
    }),
    [followUps]
  );

  const tabCounts = useMemo(() => {
    const q = search.toLowerCase().trim();
    const countFor = (status: string) =>
      followUps.filter(
        (f) => f.status === status && (!q || f.patientName.toLowerCase().includes(q))
      ).length;
    return {
      pending: countFor("preparation"),
      scheduled: countFor("in-progress"),
      sent: countFor("completed"),
    };
  }, [followUps, search]);

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Follow Up</h1>
        <p className="text-sm text-muted-foreground">
          Manage patient follow ups and reminders
        </p>
      </div>

      {/* Stats row */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Clock className="h-4 w-4 text-amber-600" />}
          label="Pending"
          count={totals.pending}
          hint="Awaiting action"
        />
        <StatCard
          icon={<CalendarClock className="h-4 w-4 text-sky-600" />}
          label="Scheduled"
          count={totals.scheduled}
          hint="Queued to send"
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          label="Sent"
          count={totals.sent}
          hint="Successfully delivered"
        />
      </div>

      {/* Search + New Follow Up */}
      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by patient name..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              setForm(EMPTY_FORM);
              setFormError(null);
              setPatientResults([]);
              setShowPatientDropdown(false);
              setAppointments([]);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Follow Up
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New Follow Up</DialogTitle>
              <DialogDescription>Create a follow up reminder for a patient.</DialogDescription>
            </DialogHeader>

            <div className="space-y-5 py-2">
              {/* Patient name — live search */}
              <div className="space-y-1.5">
                <div>
                  <label className="text-sm font-medium">Patient name</label>
                  <p className="text-xs text-muted-foreground">
                    Full name of the patient requiring follow up
                  </p>
                </div>
                <div className="relative">
                  {patientSearching ? (
                    <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  ) : (
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  )}
                  <Input
                    ref={patientInputRef}
                    className="pl-9"
                    placeholder="Type to search patients…"
                    autoComplete="off"
                    value={form.patientName}
                    onChange={(e) => {
                      const value = e.target.value;
                      setForm((f) => ({
                        ...f,
                        patientName: value,
                        patientId: "",
                        patientPhone: "",
                        appointmentId: "",
                        appointmentDate: "",
                        appointmentTime: "",
                      }));
                      if (!value.trim()) {
                        setPatientResults([]);
                        setShowPatientDropdown(false);
                      }
                    }}
                    onFocus={() => {
                      if (patientResults.length > 0) setShowPatientDropdown(true);
                    }}
                    onBlur={() => {
                      setTimeout(() => setShowPatientDropdown(false), 150);
                    }}
                  />
                  {showPatientDropdown && patientResults.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-auto rounded-md border border-slate-200 bg-white shadow-md">
                      {patientResults.map((patient) => (
                        <button
                          key={patient.id}
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setForm((f) => ({
                              ...f,
                              patientName: patient.name,
                              patientId: patient.id,
                              patientPhone: patient.phone,
                              appointmentId: "",
                              appointmentDate: "",
                              appointmentTime: "",
                            }));
                            setShowPatientDropdown(false);
                            setPatientResults([]);
                          }}
                        >
                          <UserRound className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                          {patient.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {form.patientId ? (
                  <p className="flex items-center gap-1 text-xs text-emerald-600">
                    <Check className="h-3 w-3" />
                    Patient matched
                  </p>
                ) : null}
              </div>

              {/* Type */}
              <div className="space-y-1.5">
                <div>
                  <label className="text-sm font-medium">Type</label>
                  <p className="text-xs text-muted-foreground">
                    Choose the kind of follow up to send
                  </p>
                </div>
                <Select
                  value={form.type}
                  onValueChange={(v) => {
                    const newType = v as FollowUpType;
                    setForm((f) => ({
                      ...f,
                      type: newType,
                      ...(newType !== "appointment-reminder"
                        ? { appointmentId: "", appointmentDate: "", appointmentTime: "" }
                        : {}),
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="review-request">Review Request</SelectItem>
                    <SelectItem value="appointment-reminder">Appointment Reminder</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Appointment selector — only for appointment-reminder */}
              {form.type === "appointment-reminder" && (
                <div className="space-y-1.5">
                  <div>
                    <label className="text-sm font-medium">Appointment</label>
                    <p className="text-xs text-muted-foreground">
                      Select the appointment to remind the patient about
                    </p>
                  </div>
                  {!form.patientId ? (
                    <p className="text-xs text-slate-400">Select a patient first to see their appointments.</p>
                  ) : appointmentsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading appointments…
                    </div>
                  ) : appointments.length === 0 ? (
                    <p className="text-xs text-slate-400">No appointments found for this patient.</p>
                  ) : (
                    <Select
                      value={form.appointmentId}
                      onValueChange={(v) => {
                        const appt = appointments.find((a) => a.id === v);
                        setForm((f) => ({
                          ...f,
                          appointmentId: v,
                          appointmentDate: appt?.date ?? "",
                          appointmentTime: appt?.time ?? "",
                          dueDate: appt?.isoDate ?? f.dueDate,
                        }));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select appointment…" />
                      </SelectTrigger>
                      <SelectContent>
                        {appointments.map((appt) => (
                          <SelectItem key={appt.id} value={appt.id}>
                            {appt.date} at {appt.time}
                            {appt.clinician ? ` — ${appt.clinician}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {/* Schedule for (due date) — hidden for appointment-reminder once an appointment is selected */}
              {(form.type !== "appointment-reminder" || !form.appointmentId) && <div className="space-y-1.5">
                <div>
                  <label className="text-sm font-medium">
                    Schedule for{" "}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </label>
                  <p className="text-xs text-muted-foreground">
                    When this follow up should be actioned or sent
                  </p>
                </div>
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </div>}

              {formError ? (
                <p className="text-sm text-destructive">{formError}</p>
              ) : null}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={isPending}>
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as Tab)}
        className="space-y-4"
      >
        <TabsList className="h-auto flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2">
          <TabsTrigger value="pending" className="rounded-xl">
            Pending
            {tabCounts.pending > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                {tabCounts.pending}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="scheduled" className="rounded-xl">
            Scheduled
            {tabCounts.scheduled > 0 && (
              <span className="ml-1.5 rounded-full bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-700">
                {tabCounts.scheduled}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="sent" className="rounded-xl">
            Sent
            {tabCounts.sent > 0 && (
              <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                {tabCounts.sent}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {(["pending", "scheduled", "sent"] as Tab[]).map((tab) => (
          <TabsContent key={tab} value={tab}>
            <Card className="border-slate-200/80 shadow-sm">
              <CardContent className="p-0">
                <div className="overflow-hidden rounded-[inherit] px-6">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50 hover:bg-slate-50">
                        <TableHead className="w-48 px-4 py-4 text-xs font-medium uppercase tracking-wide text-slate-500">
                          Patient
                        </TableHead>
                        <TableHead className="w-48 px-4 py-4 text-xs font-medium uppercase tracking-wide text-slate-500">
                          Type
                        </TableHead>
                        <TableHead className="w-36 px-4 py-4 text-xs font-medium uppercase tracking-wide text-slate-500">
                          Schedule
                        </TableHead>
                        <TableHead className="w-28 px-4 py-4 text-xs font-medium uppercase tracking-wide text-slate-500">
                          Status
                        </TableHead>
                        <TableHead className="w-52 px-4 py-4 text-right text-xs font-medium uppercase tracking-wide text-slate-500">
                          Actions
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.length === 0 ? (
                        <EmptyState tab={tab} />
                      ) : (
                        filtered.map((followUp) => (
                          <TableRow
                            key={followUp.id}
                            className="border-slate-100 hover:bg-slate-50/60"
                          >
                            <TableCell className="w-48 px-4 py-4 font-medium text-slate-900">
                              {followUp.patientName}
                            </TableCell>
                            <TableCell className="w-48 px-4 py-4">
                              <TypeBadge type={followUp.type} />
                            </TableCell>
                            <TableCell className="w-36 px-4 py-4 text-sm text-slate-500">
                              {formatDate(followUp.dueDate)}
                            </TableCell>
                            <TableCell className="w-28 px-4 py-4">
                              <StatusBadge status={followUp.status} />
                            </TableCell>
                            <TableCell className="w-52 px-4 py-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                {followUp.patientPhone && (
                                  <Button
                                    size="sm"
                                    className="h-8 bg-green-500 text-xs text-white hover:bg-green-600"
                                    disabled={actionId === followUp.id}
                                    title="Send via WhatsApp"
                                    onClick={() => {
                                      setWaFollowUp(followUp);
                                      setWaMessage(
                                        WA_TEMPLATES[followUp.type]?.(
                                          followUp.patientName,
                                          followUp.appointmentDate,
                                          followUp.appointmentTime
                                        ) ?? ""
                                      );
                                      setWaDialogOpen(true);
                                    }}
                                  >
                                    <Phone className="mr-1.5 h-3.5 w-3.5" />
                                    WhatsApp
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                  disabled={actionId === followUp.id}
                                  title="Remove this follow up"
                                  onClick={() => handleDismiss(followUp.id, followUp.patientName)}
                                >
                                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                  Dismiss
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {/* WhatsApp Dialog */}
      <Dialog
        open={waDialogOpen}
        onOpenChange={(open) => {
          setWaDialogOpen(open);
          if (!open) setWaFollowUp(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send via WhatsApp</DialogTitle>
            <DialogDescription>
              Send a WhatsApp message to {waFollowUp?.patientName ?? "patient"}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
              <p className="font-medium text-slate-900">{waFollowUp?.patientName}</p>
              {waFollowUp?.patientPhone && (
                <p className="text-slate-500">{waFollowUp.patientPhone}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-end justify-between">
                <label className="text-sm font-medium">Message</label>
                <span
                  className={`text-xs tabular-nums ${
                    waMessage.length > MAX_MESSAGE_LENGTH * 0.9
                      ? "text-amber-600"
                      : "text-muted-foreground"
                  }`}
                >
                  {waMessage.length}/{MAX_MESSAGE_LENGTH}
                </span>
              </div>
              <Textarea
                rows={5}
                value={waMessage}
                onChange={(e) => setWaMessage(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWaDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-green-500 text-white hover:bg-green-600"
              disabled={!waFollowUp?.patientPhone || !waMessage.trim()}
              onClick={async () => {
                if (!waFollowUp?.patientPhone) return;
                const followUpId = waFollowUp.id;
                const followUpName = waFollowUp.patientName;
                const phone = normalizePhone(waFollowUp.patientPhone);
                const url = `https://wa.me/${phone}?text=${encodeURIComponent(waMessage)}`;
                window.open(url, "_blank");
                setWaDialogOpen(false);
                setWaFollowUp(null);
                try {
                  const res = await fetch(`/api/follow-up/${followUpId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "completed" }),
                  });
                  const payload = await res.json().catch(() => ({}));
                  if (res.ok && payload.success) {
                    toast({ title: "Sent", description: `Follow up for ${followUpName} marked as sent.` });
                    await reload();
                  }
                } catch {
                  // silent — WhatsApp link was already opened
                }
              }}
            >
              <Phone className="mr-2 h-4 w-4" />
              Open WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
