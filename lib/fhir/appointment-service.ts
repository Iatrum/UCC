/**
 * Appointment Service - Medplum FHIR as Source of Truth
 */

import { MedplumClient } from '@medplum/core';
import type { Appointment as FHIRAppointment, Extension } from '@medplum/fhirtypes';
import type { AppointmentStatus } from '@/lib/models';
import { applyMyCoreProfile } from './mycore';

export interface AppointmentData {
  patientId: string;
  patientName: string;
  patientContact?: string;
  clinician: string;
  reason: string;
  type?: string;
  location?: string;
  notes?: string;
  status: AppointmentStatus;
  scheduledAt: Date | string;
  durationMinutes?: number;
}

export interface SavedAppointment extends AppointmentData {
  id: string;
  createdAt: Date;
  updatedAt?: Date;
  checkInTime?: Date | string | null;
  completedAt?: Date | string | null;
  cancelledAt?: Date | string | null;
}

const APPOINTMENT_EXTENSION_URL = 'https://ucc.emr/appointment';

type AppointmentExtensionUpdate = {
  patientContact?: string | null;
  location?: string | null;
  checkInTime?: Date | string | null;
  completedAt?: Date | string | null;
  cancelledAt?: Date | string | null;
};

const APPOINTMENT_EXTENSION_FIELDS: Record<
  keyof AppointmentExtensionUpdate,
  { type: 'string' | 'dateTime' }
> = {
  patientContact: { type: 'string' },
  location: { type: 'string' },
  checkInTime: { type: 'dateTime' },
  completedAt: { type: 'dateTime' },
  cancelledAt: { type: 'dateTime' },
};

const LOCAL_TO_FHIR_STATUS: Record<AppointmentStatus, FHIRAppointment['status']> = {
  scheduled: 'booked',
  checked_in: 'arrived',
  in_progress: 'arrived',
  completed: 'fulfilled',
  cancelled: 'cancelled',
  no_show: 'noshow',
};

const FHIR_TO_LOCAL_STATUS: Record<string, AppointmentStatus> = {
  proposed: 'scheduled',
  pending: 'scheduled',
  booked: 'scheduled',
  arrived: 'checked_in',
  fulfilled: 'completed',
  cancelled: 'cancelled',
  noshow: 'no_show',
};

function toFhirStatus(status: AppointmentStatus): FHIRAppointment['status'] {
  return LOCAL_TO_FHIR_STATUS[status] ?? 'booked';
}

function fromFhirStatus(status: FHIRAppointment['status'] | undefined): AppointmentStatus {
  if (!status) {
    return 'scheduled';
  }
  return FHIR_TO_LOCAL_STATUS[status] ?? 'scheduled';
}

function toIsoString(value: Date | string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return undefined;
}

function getAppointmentRootExtension(extensions?: Extension[]): Extension | undefined {
  return extensions?.find((ext) => ext.url === APPOINTMENT_EXTENSION_URL);
}

function getSubExtensionValue(
  root: Extension | undefined,
  key: keyof AppointmentExtensionUpdate
): string | undefined {
  const sub = root?.extension?.find((ext) => ext.url === key);
  if (!sub) return undefined;
  return sub.valueDateTime ?? sub.valueString ?? undefined;
}

function upsertAppointmentExtensions(
  existing: Extension[] | undefined,
  updates: AppointmentExtensionUpdate
): Extension[] | undefined {
  const updateKeys = Object.keys(updates) as (keyof AppointmentExtensionUpdate)[];
  const root = getAppointmentRootExtension(existing);
  const otherExtensions = (existing ?? []).filter((ext) => ext.url !== APPOINTMENT_EXTENSION_URL);
  const existingSub = root?.extension ?? [];

  const nextSub = existingSub.filter((ext) => !updateKeys.includes(ext.url as keyof AppointmentExtensionUpdate));
  for (const key of updateKeys) {
    const value = updates[key];
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      continue;
    }

    const config = APPOINTMENT_EXTENSION_FIELDS[key];
    if (config.type === 'dateTime') {
      const isoValue = toIsoString(value);
      if (!isoValue) continue;
      nextSub.push({ url: key, valueDateTime: isoValue });
    } else {
      nextSub.push({ url: key, valueString: String(value) });
    }
  }

  if (nextSub.length === 0) {
    return otherExtensions.length ? otherExtensions : undefined;
  }

  return [...otherExtensions, { url: APPOINTMENT_EXTENSION_URL, extension: nextSub }];
}

function mapFhirAppointmentToSaved(fhirAppt: FHIRAppointment): SavedAppointment {
  const patientParticipant = fhirAppt.participant?.find((p) => p.actor?.reference?.startsWith('Patient/'));
  const clinicianParticipant = fhirAppt.participant?.find((p) => !p.actor?.reference?.startsWith('Patient/'));
  const rootExtension = getAppointmentRootExtension(fhirAppt.extension);

  const createdAt = fhirAppt.meta?.lastUpdated ? new Date(fhirAppt.meta.lastUpdated) : new Date();
  const updatedAt = fhirAppt.meta?.lastUpdated ? new Date(fhirAppt.meta.lastUpdated) : undefined;

  return {
    id: fhirAppt.id ?? '',
    patientId: patientParticipant?.actor?.reference?.replace('Patient/', '') || '',
    patientName: patientParticipant?.actor?.display || '',
    patientContact: getSubExtensionValue(rootExtension, 'patientContact'),
    clinician: clinicianParticipant?.actor?.display || '',
    reason: fhirAppt.reasonCode?.[0]?.text || '',
    type: fhirAppt.appointmentType?.text,
    location: getSubExtensionValue(rootExtension, 'location'),
    notes: fhirAppt.comment,
    status: fromFhirStatus(fhirAppt.status),
    scheduledAt: fhirAppt.start ? new Date(fhirAppt.start) : new Date(),
    durationMinutes: fhirAppt.minutesDuration ?? undefined,
    createdAt,
    updatedAt,
    checkInTime: getSubExtensionValue(rootExtension, 'checkInTime') ?? null,
    completedAt: getSubExtensionValue(rootExtension, 'completedAt') ?? null,
    cancelledAt: getSubExtensionValue(rootExtension, 'cancelledAt') ?? null,
  };
}

async function getMedplumClient(): Promise<MedplumClient> {
  const baseUrl = process.env.MEDPLUM_BASE_URL || process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL || 'http://localhost:8103';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Medplum credentials not configured');
  }

  const medplum = new MedplumClient({ baseUrl, clientId, clientSecret });
  await medplum.startClientLogin(clientId, clientSecret);
  return medplum;
}

/**
 * Save appointment to Medplum
 */
export async function saveAppointmentToMedplum(appointmentData: AppointmentData): Promise<string> {
  const medplum = await getMedplumClient();
  
  const scheduledTime = typeof appointmentData.scheduledAt === 'string' 
    ? appointmentData.scheduledAt 
    : appointmentData.scheduledAt.toISOString();

  const endTime = new Date(scheduledTime);
  if (appointmentData.durationMinutes) {
    endTime.setMinutes(endTime.getMinutes() + appointmentData.durationMinutes);
  } else {
    endTime.setMinutes(endTime.getMinutes() + 30); // Default 30 min
  }

  const fhirAppointment: FHIRAppointment = applyMyCoreProfile({
    resourceType: 'Appointment',
    status: toFhirStatus(appointmentData.status),
    start: scheduledTime,
    end: endTime.toISOString(),
    minutesDuration: appointmentData.durationMinutes || 30,
    participant: [
      {
        actor: {
          reference: `Patient/${appointmentData.patientId}`,
          display: appointmentData.patientName,
        },
        status: 'accepted',
      },
      {
        actor: {
          display: appointmentData.clinician,
        },
        status: 'accepted',
      },
    ],
    reasonCode: appointmentData.reason ? [{ text: appointmentData.reason }] : undefined,
    appointmentType: appointmentData.type ? { text: appointmentData.type } : undefined,
    comment: appointmentData.notes,
    extension: upsertAppointmentExtensions(undefined, {
      patientContact: appointmentData.patientContact ?? null,
      location: appointmentData.location ?? null,
    }),
  });

  const saved = await medplum.createResource(fhirAppointment);
  console.log(`✅ Created FHIR Appointment: ${saved.id}`);
  
  return saved.id!;
}

/**
 * Get appointment from Medplum
 */
export async function getAppointmentFromMedplum(appointmentId: string): Promise<SavedAppointment | null> {
  try {
    const medplum = await getMedplumClient();
    const fhirAppt = await medplum.readResource('Appointment', appointmentId);
    return mapFhirAppointmentToSaved(fhirAppt);
  } catch (error) {
    console.error('Failed to get appointment from Medplum:', error);
    return null;
  }
}

/**
 * Get patient appointments from Medplum
 */
export async function getPatientAppointmentsFromMedplum(patientId: string): Promise<SavedAppointment[]> {
  try {
    const medplum = await getMedplumClient();
    
    const appointments = await medplum.searchResources('Appointment', {
      actor: `Patient/${patientId}`,
      _sort: '-date',
    });

    return appointments.map((appt) => mapFhirAppointmentToSaved(appt));
  } catch (error) {
    console.error('Failed to get patient appointments from Medplum:', error);
    return [];
  }
}

/**
 * Get all appointments from Medplum
 */
export async function getAppointmentsFromMedplum(statuses?: AppointmentStatus[]): Promise<SavedAppointment[]> {
  try {
    const medplum = await getMedplumClient();
    const searchParams: Record<string, string> = {
      _sort: '-date',
    };
    if (statuses && statuses.length > 0) {
      const mappedStatuses = statuses.map((status) => toFhirStatus(status));
      searchParams.status = mappedStatuses.join(',');
    }

    const appointments = await medplum.searchResources('Appointment', searchParams as any);
    return appointments.map((appt) => mapFhirAppointmentToSaved(appt));
  } catch (error) {
    console.error('Failed to get appointments from Medplum:', error);
    return [];
  }
}

/**
 * Update appointment status
 */
export async function updateAppointmentStatus(
  appointmentId: string,
  status: AppointmentStatus,
  updates?: AppointmentExtensionUpdate
): Promise<void> {
  const medplum = await getMedplumClient();
  
  const appointment = await medplum.readResource('Appointment', appointmentId);
  const mergedExtensions = updates ? upsertAppointmentExtensions(appointment.extension, updates) : appointment.extension;

  await medplum.updateResource(
    applyMyCoreProfile({
      ...appointment,
      status: toFhirStatus(status),
      extension: mergedExtensions,
    })
  );
  
  console.log(`✅ Updated Appointment ${appointmentId} status to ${status}`);
}




