"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { PatientCard, type SerializedPatient } from "@/components/patients/patient-card";

interface EditConsultationFormProps {
  consultationId: string;
  patientId: string;
  initialNotes: string;
  patient: SerializedPatient;
}

export default function EditConsultationForm({
  consultationId,
  patientId,
  initialNotes,
  patient,
}: EditConsultationFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [clinicalNotes, setClinicalNotes] = useState(initialNotes);
  const [submitting, setSubmitting] = useState(false);

  const vitals = (patient as any).triage?.vitalSigns;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;

    try {
      setSubmitting(true);
      const res = await fetch("/api/consultations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consultationId, chiefComplaint: clinicalNotes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to update consultation");
      }
      toast({ title: "Consultation Updated", description: "Clinical notes have been saved." });
      router.push(`/patients/${patientId}`);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update consultation.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container max-w-5xl py-6">
      <div className="mb-6">
        <Link
          href={`/patients/${patientId}`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Patient Profile
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Edit Consultation</h1>
        <p className="text-sm text-muted-foreground">Update the clinical notes below.</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
          {/* Left sidebar: patient card + vitals */}
          <div className="md:col-span-3 space-y-2 sticky top-2 self-start">
            <PatientCard patient={patient} compact />
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Latest Vitals</CardTitle>
                <CardDescription>From triage</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">BP</p>
                  <p className="font-medium">
                    {vitals?.bloodPressureSystolic && vitals?.bloodPressureDiastolic
                      ? `${vitals.bloodPressureSystolic}/${vitals.bloodPressureDiastolic} mmHg`
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">HR</p>
                  <p className="font-medium">{vitals?.heartRate ? `${vitals.heartRate} bpm` : "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">RR</p>
                  <p className="font-medium">{vitals?.respiratoryRate ? `${vitals.respiratoryRate} /min` : "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Temp</p>
                  <p className="font-medium">{vitals?.temperature ? `${vitals.temperature} °C` : "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">SpO₂</p>
                  <p className="font-medium">{vitals?.oxygenSaturation ? `${vitals.oxygenSaturation}%` : "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Pain</p>
                  <p className="font-medium">{typeof vitals?.painScore === "number" ? vitals.painScore : "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Weight</p>
                  <p className="font-medium">{vitals?.weight ? `${vitals.weight} kg` : "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Height</p>
                  <p className="font-medium">{vitals?.height ? `${vitals.height} cm` : "—"}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main: clinical notes + action */}
          <div className="md:col-span-9 space-y-4">
            <Textarea
              placeholder="Clinical notes"
              className="min-h-[360px]"
              value={clinicalNotes}
              onChange={(e) => setClinicalNotes(e.target.value)}
            />
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Update Consultation"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
