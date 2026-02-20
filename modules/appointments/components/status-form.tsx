"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { updateAppointment, type AppointmentStatus } from "@/lib/models";

const STATUS_OPTIONS: { value: AppointmentStatus; label: string }[] = [
  { value: "scheduled", label: "Scheduled" },
  { value: "checked_in", label: "Checked in" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No show" },
];

interface Props {
  appointmentId: string;
  currentStatus: AppointmentStatus;
  hasCheckIn?: boolean;
  hasCompleted?: boolean;
}

export default function AppointmentStatusForm({ appointmentId, currentStatus, hasCheckIn, hasCompleted }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [selectedStatus, setSelectedStatus] = useState<AppointmentStatus>(currentStatus);
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    startTransition(async () => {
      try {
        const payload: Record<string, unknown> = { status: selectedStatus };

        switch (selectedStatus) {
          case "checked_in":
            payload.checkInTime = new Date();
            break;
          case "in_progress":
            if (!hasCheckIn) payload.checkInTime = new Date();
            break;
          case "completed":
            payload.completedAt = new Date();
            break;
          case "cancelled":
          case "no_show":
            payload.cancelledAt = new Date();
            break;
          case "scheduled":
            payload.checkInTime = null;
            payload.completedAt = null;
            payload.cancelledAt = null;
            break;
        }

        await updateAppointment(appointmentId, payload as any);
        const label = STATUS_OPTIONS.find((o) => o.value === selectedStatus)?.label ?? selectedStatus;
        toast({ title: "Status updated", description: `Appointment set to ${label}.` });
        router.refresh();
      } catch (error) {
        console.error("Failed to update appointment", error);
        toast({ title: "Unable to update", description: "Something went wrong.", variant: "destructive" });
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Select value={selectedStatus} onValueChange={(v) => setSelectedStatus(v as AppointmentStatus)}>
        <SelectTrigger className="w-full sm:w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} disabled={opt.value === "completed" && hasCompleted}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" onClick={handleSubmit} disabled={isPending || selectedStatus === currentStatus}>
        {isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating</> : "Update status"}
      </Button>
    </div>
  );
}
