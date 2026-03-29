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
  // Await params
  const resolvedParams = await params;
  const [patientBase, triageData] = await Promise.all([
    getPatientFromMedplum(resolvedParams.id),
    getTriageForPatient(resolvedParams.id),
  ]);
  let patient = patientBase;

  if (!patient) {
    const medplumPatient = await getPatientFromMedplum(resolvedParams.id);
    if (!medplumPatient) {
      notFound();
    }
    patient = {
      id: medplumPatient.id,
      fullName: medplumPatient.fullName,
      nric: medplumPatient.nric,
      dateOfBirth: medplumPatient.dateOfBirth,
      gender: medplumPatient.gender,
      email: medplumPatient.email ?? "",
      phone: medplumPatient.phone,
      address: medplumPatient.address,
      postalCode: medplumPatient.postalCode ?? "",
      emergencyContact: medplumPatient.emergencyContact ?? { name: "", relationship: "", phone: "" },
      medicalHistory: medplumPatient.medicalHistory ?? { allergies: [], conditions: [], medications: [] },
      createdAt: medplumPatient.createdAt ?? new Date(),
      updatedAt: medplumPatient.updatedAt ?? new Date(),
      queueStatus: triageData.queueStatus ?? null,
      queueAddedAt: triageData.queueAddedAt ?? null,
      triage: triageData.triage,
      lastVisit: (medplumPatient as any).lastVisit,
      upcomingAppointment: (medplumPatient as any).upcomingAppointment,
    } as any;
  }
  patient = {
    ...patient,
    queueStatus: triageData.queueStatus ?? null,
    queueAddedAt: triageData.queueAddedAt ?? null,
    triage: triageData.triage,
  } as any;

  if (!patient) {
    notFound();
  }

  // Serialize patient for client component
  const initialPatient: SerializedPatient = {
    ...patient,
    dateOfBirth: safeToISOString(patient.dateOfBirth),
    lastVisit: safeToISOString(patient.lastVisit),
    upcomingAppointment: safeToISOString((patient as any).upcomingAppointment),
    createdAt: safeToISOString(patient.createdAt),
    updatedAt: safeToISOString(patient.updatedAt),
    queueAddedAt: safeToISOString(patient.queueAddedAt),
  };

  return (
    <main className="min-h-screen bg-background">
      <ConsultationForm patientId={resolvedParams.id} initialPatient={initialPatient} />
    </main>
  );
}
