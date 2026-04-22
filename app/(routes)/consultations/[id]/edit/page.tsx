export const dynamic = 'force-dynamic';

import { notFound, redirect } from 'next/navigation';
import { getMedplumForRequest } from '@/lib/server/medplum-auth';
import { getConsultationFromMedplum } from '@/lib/fhir/consultation-service';
import { getPatientFromMedplum } from '@/lib/fhir/patient-service';
import { resolveClinicIdFromServerScope } from '@/lib/server/clinic';
import ConsultationForm from '@/app/(routes)/patients/[id]/consultation/consultation-form';
import { safeToISOString } from '@/lib/utils';
import type { SerializedPatient } from '@/components/patients/patient-card';
import type { SerializedConsultation } from '@/lib/types';

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

  const patient = await getPatientFromMedplum(consultation.patientId, clinicId, medplum);
  if (!patient) {
    notFound();
  }

  const initialPatient: SerializedPatient = {
    ...(patient as any),
    dateOfBirth: safeToISOString((patient as any).dateOfBirth),
    lastVisit: safeToISOString((patient as any).lastVisit),
    upcomingAppointment: safeToISOString((patient as any).upcomingAppointment),
    createdAt: safeToISOString((patient as any).createdAt),
    updatedAt: safeToISOString((patient as any).updatedAt),
    queueAddedAt: safeToISOString((patient as any).queueAddedAt),
  };

  const initialConsultation: SerializedConsultation = {
    ...(consultation as any),
    date: safeToISOString(consultation.date),
    createdAt: safeToISOString(consultation.createdAt),
    updatedAt: safeToISOString((consultation as any).updatedAt),
  };

  return (
    <main className="min-h-screen bg-background">
      <ConsultationForm
        patientId={consultation.patientId}
        initialPatient={initialPatient}
        initialConsultation={initialConsultation}
      />
    </main>
  );
}
