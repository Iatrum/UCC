import { safeToISOString } from "./utils";
import { QueueStatus, BillableConsultation, TriageData } from "./types";
import { getAllPatientsFromMedplum, getPatientFromMedplum } from "./fhir/patient-service";
import { getAdminMedplum } from "@/lib/server/medplum-admin";
import {
  getTriageQueueForToday,
  getTriageForPatient,
  saveTriageEncounter,
  updateQueueStatusForPatient,
  updateTriageEncounter,
  checkInPatientInTriage,
} from "./fhir/triage-service";
import { getPatientConsultationsFromMedplum, getConsultationFromMedplum, saveConsultationToMedplum } from "./fhir/consultation-service";

export interface Patient {
  id: string;
  fullName: string;
  nric: string;
  dateOfBirth: Date | string;
  gender: "male" | "female" | "other";
  email: string;
  phone: string;
  address: string;
  postalCode: string;
  lastVisit?: Date | string;
  upcomingAppointment?: Date | string;
  emergencyContact: {
    name: string;
    relationship: string;
    phone: string;
  };
  medicalHistory: {
    allergies: string[];
    conditions: string[];
    medications: string[];
  };
  createdAt: Date | string;
  updatedAt?: Date | string;
  queueStatus?: QueueStatus;
  queueAddedAt?: Date | string | null;
  visitIntent?: string;
  payerType?: string;
  paymentMethod?: string;
  billingPerson?: string;
  dependentName?: string;
  dependentRelationship?: string;
  dependentPhone?: string;
  assignedClinician?: string;
  registrationSource?: string;
  registrationAt?: string;
  performedBy?: string;
  triage?: TriageData;
}

export interface Consultation {
  id?: string;
  patientId: string;
  date: Date;
  type?: string;
  doctor?: string;
  chiefComplaint: string;
  diagnosis: string;
  procedures: ProcedureRecord[];
  notes?: string;
  prescriptions: Prescription[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ProcedureRecord {
  name: string;
  price?: number;
  quantity?: number;
  orderIndex?: number;
  category?: "items" | "services" | "packages" | "documents";
  notes?: string;
  procedureId?: string;
  codingSystem?: string;
  codingCode?: string;
  codingDisplay?: string;
}

export interface Prescription {
  medication: {
    id: string;
    name: string;
    strength?: string;
  };
  frequency: string;
  duration: string;
  quantity?: number;
  orderIndex?: number;
  category?: "items" | "services" | "packages" | "documents";
  expiryDate?: string;
  price?: number;
}

export async function getPatients(): Promise<Patient[]> {
  const medplum = await getAdminMedplum();
  const patients = await getAllPatientsFromMedplum(300, undefined, medplum);
  const enriched = await Promise.all(
    patients.map(async (p) => {
      const triage = await getTriageForPatient(p.id, medplum);
      return {
        ...(p as any),
        triage: triage.triage,
        queueStatus: triage.queueStatus ?? null,
        queueAddedAt: triage.queueAddedAt ?? null,
      } as Patient;
    })
  );
  return enriched;
}

export async function getPatientById(id: string): Promise<Patient | null> {
  const medplum = await getAdminMedplum();
  const [patient, triage] = await Promise.all([
    getPatientFromMedplum(id, undefined, medplum),
    getTriageForPatient(id, medplum),
  ]);
  if (!patient) return null;
  return {
    ...(patient as any),
    triage: triage.triage,
    queueStatus: triage.queueStatus ?? null,
    queueAddedAt: triage.queueAddedAt ?? null,
  } as Patient;
}

export async function createPatient(data: Omit<Patient, "id" | "createdAt" | "updatedAt">): Promise<string> {
  // Use Medplum as ONLY source of truth
  const { savePatientToMedplum } = await import('@/lib/fhir/patient-service');
  const medplum = await getAdminMedplum();

  const patientData = {
    fullName: data.fullName,
    nric: data.nric,
    dateOfBirth: data.dateOfBirth,
    gender: data.gender,
    email: data.email || '',
    phone: data.phone,
    address: data.address,
    postalCode: data.postalCode,
    emergencyContact: data.emergencyContact,
    medicalHistory: data.medicalHistory,
  };

  // Save directly to Medplum (source of truth)
  const medplumId = await savePatientToMedplum(patientData, undefined, medplum);
  
  console.log(`✅ Patient created in Medplum: ${medplumId}`);
  return medplumId;
}

export async function getConsultationsByPatientId(patientId: string): Promise<Consultation[]> {
  const medplum = await getAdminMedplum();
  const consultations = await getPatientConsultationsFromMedplum(patientId, undefined, medplum);
  return consultations as unknown as Consultation[];
}

export async function getConsultationById(id: string): Promise<Consultation | null> {
  const medplum = await getAdminMedplum();
  const consultation = await getConsultationFromMedplum(id, undefined, medplum);
  return (consultation as unknown as Consultation) ?? null;
}

export async function createConsultation(
  consultation: Omit<Consultation, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  const medplum = await getAdminMedplum();
  const patient = await getPatientFromMedplum(consultation.patientId, undefined, medplum);
  if (!patient) {
    throw new Error("Patient not found in Medplum");
  }

  const encounterId = await saveConsultationToMedplum(
    {
      patientId: consultation.patientId,
      chiefComplaint: consultation.chiefComplaint,
      diagnosis: consultation.diagnosis,
      procedures: consultation.procedures,
      notes: consultation.notes,
      progressNote: (consultation as any).progressNote,
      prescriptions: consultation.prescriptions as any,
      date: consultation.date,
    },
    {
      id: patient.id,
      name: (patient as any).fullName || (patient as any).name || "",
      ic: (patient as any).nric || "",
      dob:
        patient.dateOfBirth instanceof Date
          ? patient.dateOfBirth
          : new Date((patient as any).dateOfBirth),
      gender: (patient as any).gender,
      phone: (patient as any).phone,
      address: (patient as any).address,
    },
    undefined,
    medplum
  );

  return encounterId;
}

export async function updateConsultation(id: string, data: Partial<Consultation>): Promise<void> {
  const medplum = await getAdminMedplum();

  // For now, support updating notes/progress via an Observation amendment.
  if (data.notes) {
    await medplum.createResource({
      resourceType: 'Observation',
      status: 'final',
      encounter: { reference: `Encounter/${id}` },
      code: {
        coding: [{ system: 'http://loinc.org', code: '48767-8', display: 'Clinical note' }],
        text: 'Clinical Notes',
      },
      valueString: data.notes,
      effectiveDateTime: new Date().toISOString(),
    });
  }
}

export async function getTodaysQueue(): Promise<Patient[]> {
  return getTriagedPatientsQueue();
}

export async function addPatientToQueue(patientId: string): Promise<void> {
  const medplum = await getAdminMedplum();
  await updateQueueStatusForPatient(patientId, "waiting", medplum);
}

export async function removePatientFromQueue(patientId: string): Promise<void> {
  const medplum = await getAdminMedplum();
  await updateQueueStatusForPatient(patientId, null, medplum);
}

export async function updateQueueStatus(patientId: string, status: QueueStatus): Promise<void> {
  const medplum = await getAdminMedplum();
  await updateQueueStatusForPatient(patientId, status, medplum);
}

export async function getConsultationsWithDetails(statuses: QueueStatus[]): Promise<BillableConsultation[]> {
  try {
    const validStatuses = statuses.filter((status): status is Exclude<QueueStatus, null> => Boolean(status));
    if (validStatuses.length === 0) {
      return [];
    }

    const medplum = await getAdminMedplum();
    let encounters: any[] = [];
    let searchUrl: string | undefined;

    do {
      const page = await medplum.searchResources<any>('Encounter', {
        status: 'triaged,in-progress,finished',
        _count: '100',
        _sort: '-date',
        ...(searchUrl ? { _url: searchUrl } : {}),
      } as any);

      encounters = encounters.concat(page ?? []);

      // Medplum search pages include next link in page.links
      const nextLink = (page as any)?.[Symbol.iterator] ? undefined : (page as any)?.links?.find((l: any) => l.relation === 'next');
      searchUrl = nextLink?.url;
    } while (searchUrl);

    const parseQueueStatus = (enc: any): { queueStatus: QueueStatus; queueAddedAt?: string | null } => {
      const ext = (enc.extension || []).find((e: any) => e.url === 'https://ucc.emr/triage-encounter');
      const getSub = (key: string) => ext?.extension?.find((e: any) => e.url === key);
      const queueStatus = (getSub('queueStatus')?.valueString as QueueStatus) ?? null;
      const queueAddedAt = getSub('queueAddedAt')?.valueDateTime ?? enc.period?.start ?? null;
      return {
        queueStatus:
          queueStatus ??
          (enc.status === 'triaged'
            ? 'waiting'
            : enc.status === 'in-progress'
            ? 'in_consultation'
            : enc.status === 'finished'
            ? 'completed'
            : null),
        queueAddedAt,
      };
    };

    const consultations = (
      await Promise.all(
        encounters.map(async (enc: any) => {
          const { queueStatus } = parseQueueStatus(enc);
          if (!queueStatus || !validStatuses.includes(queueStatus)) {
            return null;
          }

          const queueEncounterConsultation = await getConsultationFromMedplum(enc.id, undefined, medplum);
          const patientId =
            queueEncounterConsultation?.patientId ||
            enc.subject?.reference?.replace('Patient/', '');
          if (!patientId) return null;

          const patient = await getPatientFromMedplum(patientId, undefined, medplum, { includeMedicalHistory: false });
          const patientConsultations = await getPatientConsultationsFromMedplum(patientId, undefined, medplum);
          const clinicalConsultation =
            patientConsultations
              .filter((consultation) =>
                Boolean(
                  consultation.id &&
                    (
                      consultation.diagnosis ||
                      consultation.notes ||
                      consultation.progressNote ||
                      consultation.procedures?.length ||
                      consultation.prescriptions?.length
                    )
                )
              )
              .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())[0] ||
            queueEncounterConsultation;

          if (!clinicalConsultation) return null;

          return {
            id: clinicalConsultation.id,
            patientId,
            patientFullName: patient?.fullName ?? clinicalConsultation.patientName ?? '',
            queueStatus,
            date: safeToISOString((clinicalConsultation as any).date) ?? null,
            createdAt: safeToISOString((clinicalConsultation as any).createdAt) ?? null,
            updatedAt: safeToISOString((clinicalConsultation as any).updatedAt) ?? null,
            type: (clinicalConsultation as any).type,
            doctor: (clinicalConsultation as any).doctor,
            chiefComplaint: (clinicalConsultation as any).chiefComplaint,
            diagnosis: (clinicalConsultation as any).diagnosis,
            procedures: (clinicalConsultation as any).procedures,
            notes: (clinicalConsultation as any).notes,
            prescriptions: (clinicalConsultation as any).prescriptions,
          } satisfies BillableConsultation;
        })
      )
    ).filter(Boolean) as BillableConsultation[];

    const uniqueConsultations = Array.from(
      new Map(consultations.map((consultation) => [consultation.id, consultation])).values()
    );

    return uniqueConsultations.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });
  } catch (error) {
    console.error("Error in getConsultationsWithDetails:", error);
    return [];
  }
}

// Triage Functions
export async function triagePatient(patientId: string, triageData: Omit<TriageData, 'triageAt' | 'isTriaged'>): Promise<void> {
  const medplum = await getAdminMedplum();
  await saveTriageEncounter(patientId, triageData, medplum);
}

export async function updateTriageData(patientId: string, triageData: Partial<TriageData>): Promise<void> {
  const medplum = await getAdminMedplum();
  await updateTriageEncounter(patientId, triageData, medplum);
}

export async function getTriagedPatientsQueue(): Promise<Patient[]> {
  const medplum = await getAdminMedplum();
  const patients = await getTriageQueueForToday(200, medplum);
  return patients as unknown as Patient[];
}

export async function checkInPatient(patientId: string, chiefComplaint?: string): Promise<string> {
  const medplum = await getAdminMedplum();
  return checkInPatientInTriage(patientId, chiefComplaint, undefined, medplum);
}
