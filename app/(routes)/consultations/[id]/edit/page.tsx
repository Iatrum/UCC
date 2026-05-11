export const dynamic = 'force-dynamic';

import { notFound, redirect } from 'next/navigation';
import { getMedplumForRequest } from '@/lib/server/medplum-auth';
import { getConsultationFromMedplum } from '@/lib/fhir/consultation-service';
import { getPatientFromMedplum } from '@/lib/fhir/patient-service';
import { getTriageForPatient } from '@/lib/fhir/triage-service';
import { resolveClinicIdFromServerScope } from '@/lib/server/clinic';
import EditConsultationForm from './edit-form';
import { safeToISOString } from '@/lib/utils';
import type { SerializedPatient } from '@/components/patients/patient-card';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function EditConsultationPage({ params }: Props) {
  const { id } = await params;

  let medplum;
  try {
    medplum = await getMedplumForRequest();
  } catch {
    redirect('/login');
  }

  const clinicId = await resolveClinicIdFromServerScope();

  const consultation = await getConsultationFromMedplum(id, clinicId, medplum);
  if (!consultation) {
    notFound();
  }

  const [patient, triageData] = await Promise.all([
    getPatientFromMedplum(consultation.patientId, clinicId, medplum),
    getTriageForPatient(consultation.patientId, medplum, clinicId)
      .catch(() => ({ triage: null, queueAddedAt: null })),
  ]);

  if (!patient) {
    notFound();
  }

  const serializedPatient: SerializedPatient = {
    ...(patient as any),
    triage: triageData.triage,
    dateOfBirth: safeToISOString((patient as any).dateOfBirth),
    lastVisit: safeToISOString((patient as any).lastVisit),
    upcomingAppointment: safeToISOString((patient as any).upcomingAppointment),
    createdAt: safeToISOString((patient as any).createdAt),
    updatedAt: safeToISOString((patient as any).updatedAt),
    queueAddedAt: safeToISOString(triageData.queueAddedAt ?? null),
  };

  return (
    <main className="min-h-screen bg-background">
      <EditConsultationForm
        consultationId={id}
        patientId={consultation.patientId}
        initialNotes={consultation.chiefComplaint || ''}
        initialDiagnosis={consultation.diagnosis || ''}
        patient={serializedPatient}
      />
    </main>
  );
}
