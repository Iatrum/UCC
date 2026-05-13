"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { getAllPatients, type Patient } from "@/lib/fhir/patient-client";
import { getAllPractitioners, type PractitionerOption } from "@/lib/fhir/practitioner-client";
import { bookSlot, generateSlots, getFreeSlots, type SchedulingSlot } from "@/lib/fhir/scheduling-client";

function defaultStartDate(): string {
  const now = new Date();
  now.setHours(9, 0, 0, 0);
  return now.toISOString().slice(0, 16);
}

function defaultEndDate(): string {
  const end = new Date();
  end.setDate(end.getDate() + 7);
  end.setHours(17, 0, 0, 0);
  return end.toISOString().slice(0, 16);
}

export default function AppointmentsSlotsPilotPage() {
  const { toast } = useToast();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [practitioners, setPractitioners] = useState<PractitionerOption[]>([]);
  const [patientId, setPatientId] = useState("");
  const [practitionerId, setPractitionerId] = useState("");
  const [reason, setReason] = useState("");
  const [start, setStart] = useState(defaultStartDate());
  const [end, setEnd] = useState(defaultEndDate());
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [slots, setSlots] = useState<SchedulingSlot[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const practitionerMap = useMemo(() => {
    const map = new Map<string, string>();
    practitioners.forEach((p) => map.set(p.id, p.name));
    return map;
  }, [practitioners]);

  async function loadLookupData() {
    const [nextPatients, nextPractitioners] = await Promise.all([
      getAllPatients(200),
      getAllPractitioners(),
    ]);
    setPatients(nextPatients);
    setPractitioners(nextPractitioners);
  }

  async function handlePrepareSlots() {
    if (!practitionerId) {
      toast({ title: "Select clinician", description: "Choose a clinician first.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      await generateSlots({
        practitionerId,
        practitionerName: practitionerMap.get(practitionerId),
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        durationMinutes: Number(durationMinutes),
      });

      const nextSlots = await getFreeSlots(
        practitionerId,
        new Date(start).toISOString(),
        new Date(end).toISOString()
      );
      setSlots(nextSlots);
      toast({ title: "Slots ready", description: `Loaded ${nextSlots.length} free slots.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to prepare slots";
      toast({ title: "Unable to load slots", description: message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleBook(slotId: string) {
    if (!patientId) {
      toast({ title: "Select patient", description: "Choose a patient before booking.", variant: "destructive" });
      return;
    }
    if (!reason.trim()) {
      toast({ title: "Visit reason required", description: "Enter the reason before booking.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const result = await bookSlot({
        slotId,
        patientId,
        reason: reason.trim(),
        clinicianDisplayOverride: practitionerMap.get(practitionerId),
      });

      setSlots((prev) => prev.filter((slot) => slot.id !== slotId));
      toast({
        title: "Appointment booked",
        description: `Created Appointment ${result.appointmentId} from slot ${result.slotId}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Booking failed";
      toast({ title: "Unable to book slot", description: message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="container max-w-5xl py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Slots Pilot (Internal)</h1>
          <p className="text-muted-foreground">
            Parallel Schedule/Slot booking pilot. This route does not replace current appointments workflow.
          </p>
        </div>
        <Link href="/appointments" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to appointments
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pilot Inputs</CardTitle>
          <CardDescription>Select clinician, date window, patient, and reason to book from generated slots.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button type="button" variant="outline" onClick={loadLookupData} disabled={isLoading}>
            Load patients and clinicians
          </Button>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Clinician</Label>
              <Select value={practitionerId} onValueChange={setPractitionerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select clinician" />
                </SelectTrigger>
                <SelectContent>
                  {practitioners.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Patient</Label>
              <Select value={patientId} onValueChange={setPatientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select patient" />
                </SelectTrigger>
                <SelectContent>
                  {patients.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Window start</Label>
              <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Window end</Label>
              <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Slot duration (minutes)</Label>
              <Input value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Visit reason</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for appointment"
            />
          </div>

          <Button type="button" onClick={handlePrepareSlots} disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Generate and load free slots
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Available Slots</CardTitle>
          <CardDescription>Book from free slots only. Booked slots are removed from this list.</CardDescription>
        </CardHeader>
        <CardContent>
          {slots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No slots loaded yet.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{slots.length} slots loaded</p>
              <div className="max-h-[28rem] overflow-y-auto rounded-md border p-2">
                <div className="space-y-2">
              {slots.map((slot) => (
                <div key={slot.id} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="font-medium">{slot.practitionerName}</p>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(slot.start), "PPP p")} - {format(new Date(slot.end), "p")}
                    </p>
                  </div>
                  <Button type="button" onClick={() => handleBook(slot.id)} disabled={isLoading}>
                    Book Slot
                  </Button>
                </div>
              ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
