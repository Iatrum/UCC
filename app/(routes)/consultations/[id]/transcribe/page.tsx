export const dynamic = 'force-dynamic';

import { notFound } from "next/navigation";

import TranscriptionWorkspace from "./transcription-workspace";
import { getConsultationById, getPatientById } from "@/lib/models";
import { safeToISOString } from "@/lib/utils";
import type { SerializedConsultation } from "@/lib/types";
import type { SerializedPatient } from "@/components/patients/patient-card";
import { TRANSCRIBE_ENABLED } from "@/lib/features";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ConsultationTranscribePage({ params }: Props) {
  if (!TRANSCRIBE_ENABLED) {
    notFound();
  }

  const { id } = await params;
  const consultation = await getConsultationById(id);

  if (!consultation || !consultation.id) {
    notFound();
  }

  const patient = await getPatientById(consultation.patientId);

  const serializedConsultation: SerializedConsultation = {
    ...consultation,
    date: safeToISOString(consultation.date),
    createdAt: safeToISOString(consultation.createdAt),
    updatedAt: safeToISOString(consultation.updatedAt),
  };

  let serializedPatient: SerializedPatient | null = null;
  if (patient) {
    serializedPatient = {
      ...patient,
      dateOfBirth: safeToISOString(patient.dateOfBirth),
      lastVisit: safeToISOString(patient.lastVisit),
      upcomingAppointment: safeToISOString(patient.upcomingAppointment),
      createdAt: safeToISOString(patient.createdAt),
      updatedAt: safeToISOString(patient.updatedAt),
      queueAddedAt: safeToISOString(patient.queueAddedAt),
    };
  }

  return (
    <main className="min-h-screen bg-muted/10">
      <TranscriptionWorkspace
        consultation={serializedConsultation}
        patient={serializedPatient}
        fallbackPatientId={consultation.patientId}
        backHref={`/consultations/${consultation.id}`}
      />
    </main>
  );
}
