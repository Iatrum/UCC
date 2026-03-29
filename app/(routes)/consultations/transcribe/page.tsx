export const dynamic = 'force-dynamic';

import { notFound } from "next/navigation";

import TranscriptionWorkspace from "../[id]/transcribe/transcription-workspace";
import { getConsultationById, getPatientById } from "@/lib/models";
import { safeToISOString } from "@/lib/utils";
import type { SerializedConsultation } from "@/lib/types";
import type { SerializedPatient } from "@/components/patients/patient-card";
import { TRANSCRIBE_ENABLED } from "@/lib/features";

type Props = {
  searchParams: Promise<{
    patientId?: string;
    consultationId?: string;
  }>;
};

export default async function ConsultationTranscribeEntry({ searchParams }: Props) {
  if (!TRANSCRIBE_ENABLED) {
    notFound();
  }

  const resolvedSearch = await searchParams;
  const consultationId = resolvedSearch.consultationId;
  const providedPatientId = resolvedSearch.patientId;

  const consultation = consultationId ? await getConsultationById(consultationId) : null;
  const targetPatientId = consultation?.patientId ?? providedPatientId ?? null;

  const patient = targetPatientId ? await getPatientById(targetPatientId) : null;

  if (!consultation && !targetPatientId) {
    notFound();
  }

  const serializedConsultation: SerializedConsultation | null = consultation
    ? {
        ...consultation,
        date: safeToISOString(consultation.date),
        createdAt: safeToISOString(consultation.createdAt),
        updatedAt: safeToISOString(consultation.updatedAt),
      }
    : null;

  const serializedPatient: SerializedPatient | null = patient
    ? {
        ...patient,
        dateOfBirth: safeToISOString(patient.dateOfBirth),
        lastVisit: safeToISOString(patient.lastVisit),
        upcomingAppointment: safeToISOString(patient.upcomingAppointment),
        createdAt: safeToISOString(patient.createdAt),
        updatedAt: safeToISOString(patient.updatedAt),
        queueAddedAt: safeToISOString(patient.queueAddedAt),
      }
    : null;

  return (
    <main className="min-h-screen bg-muted/10">
      <TranscriptionWorkspace
        consultation={serializedConsultation}
        patient={serializedPatient}
        fallbackPatientId={targetPatientId}
        backHref={consultationId ? `/consultations/${consultationId}` : null}
      />
    </main>
  );
}
