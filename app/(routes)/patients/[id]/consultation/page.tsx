export const dynamic = 'force-dynamic';

import { getPatientFromMedplum } from "@/lib/fhir/patient-service";
import ConsultationForm from "./consultation-form";
import { notFound } from "next/navigation";
import { safeToISOString } from "@/lib/utils";
import { SerializedPatient } from "@/components/patients/patient-card";
import { getTriageForPatient } from "@/lib/fhir/triage-service";


// Update PageProps for async Server Component
type Props = {
  params: Promise<{ id: string }>
  // Assuming searchParams might be used, include it as a Promise too
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function ConsultationPage({ params, searchParams }: Props) {
  const resolvedParams = await params;

  const [patient, triageData] = await Promise.all([
    getPatientFromMedplum(resolvedParams.id),
    getTriageForPatient(resolvedParams.id),
  ]);

  if (!patient) {
    notFound();
  }

  const patientWithTriage = {
    ...patient,
    queueStatus: triageData.queueStatus ?? null,
    queueAddedAt: triageData.queueAddedAt ?? null,
    triage: triageData.triage,
  } as any;

  // Serialize patient for client component
  const initialPatient: SerializedPatient = {
    ...patientWithTriage,
    dateOfBirth: safeToISOString(patientWithTriage.dateOfBirth),
    lastVisit: safeToISOString(patientWithTriage.lastVisit),
    upcomingAppointment: safeToISOString((patientWithTriage as any).upcomingAppointment),
    createdAt: safeToISOString(patientWithTriage.createdAt),
    updatedAt: safeToISOString(patientWithTriage.updatedAt),
    queueAddedAt: safeToISOString(patientWithTriage.queueAddedAt),
  };

  return (
    <main className="min-h-screen bg-background">
      <ConsultationForm patientId={resolvedParams.id} initialPatient={initialPatient} />
    </main>
  );
}
