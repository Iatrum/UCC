export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { getPatientFromMedplum } from '@/lib/fhir/patient-service';
import { getMedplumForRequest } from '@/lib/server/medplum-auth';
import { resolveClinicIdFromServerScope } from '@/lib/server/clinic';
import { safeToISOString } from '@/lib/utils';
import EditPatientForm from './edit-patient-form';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditPatientPage({ params }: Props) {
  const { id } = await params;
  const medplum = await getMedplumForRequest();
  const clinicId = await resolveClinicIdFromServerScope();
  const patient = await getPatientFromMedplum(id, clinicId, medplum);

  if (!patient) {
    notFound();
  }

  const serialized = {
    ...patient,
    dateOfBirth: safeToISOString(patient.dateOfBirth)?.split('T')[0] ?? '',
    createdAt: safeToISOString((patient as any).createdAt),
    updatedAt: safeToISOString((patient as any).updatedAt),
  };

  return <EditPatientForm patient={serialized} />;
}
