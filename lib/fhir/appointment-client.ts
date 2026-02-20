/**
 * Client-side wrapper for Appointment API (Medplum FHIR)
 */

import type { AppointmentStatus } from '@/lib/models';

export interface AppointmentInput {
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

export interface Appointment extends AppointmentInput {
  id: string;
  createdAt: Date;
  updatedAt?: Date;
  checkInTime?: Date | string | null;
  completedAt?: Date | string | null;
  cancelledAt?: Date | string | null;
}

/**
 * Save an appointment to Medplum
 */
export async function saveAppointment(appointment: AppointmentInput): Promise<string> {
  const response = await fetch('/api/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(appointment),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to save appointment');
  }

  return data.appointmentId;
}

/**
 * Get an appointment by ID
 */
export async function getAppointment(appointmentId: string): Promise<Appointment | null> {
  const response = await fetch(`/api/appointments?id=${appointmentId}`);
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(data.error || 'Failed to get appointment');
  }

  const appointment = data.appointment;
  return {
    ...appointment,
    scheduledAt: appointment.scheduledAt ? new Date(appointment.scheduledAt) : appointment.scheduledAt,
    createdAt: appointment.createdAt ? new Date(appointment.createdAt) : appointment.createdAt,
    updatedAt: appointment.updatedAt ? new Date(appointment.updatedAt) : appointment.updatedAt,
    checkInTime: appointment.checkInTime ? new Date(appointment.checkInTime) : appointment.checkInTime,
    completedAt: appointment.completedAt ? new Date(appointment.completedAt) : appointment.completedAt,
    cancelledAt: appointment.cancelledAt ? new Date(appointment.cancelledAt) : appointment.cancelledAt,
  };
}

/**
 * Get appointments for a patient
 */
export async function getPatientAppointments(patientId: string): Promise<Appointment[]> {
  const response = await fetch(`/api/appointments?patientId=${patientId}`);
  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to get appointments');
  }

  return data.appointments.map((a: any) => ({
    ...a,
    scheduledAt: new Date(a.scheduledAt),
    createdAt: new Date(a.createdAt),
  }));
}

/**
 * Get all appointments (optionally filtered by status)
 */
export async function getAppointments(statuses?: AppointmentStatus[]): Promise<Appointment[]> {
  const params = new URLSearchParams();
  if (statuses && statuses.length > 0) {
    params.set('status', statuses.join(','));
  }
  const query = params.toString();
  const response = await fetch(`/api/appointments${query ? `?${query}` : ''}`);
  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to get appointments');
  }

  return data.appointments.map((a: any) => ({
    ...a,
    scheduledAt: a.scheduledAt ? new Date(a.scheduledAt) : a.scheduledAt,
    createdAt: a.createdAt ? new Date(a.createdAt) : a.createdAt,
    updatedAt: a.updatedAt ? new Date(a.updatedAt) : a.updatedAt,
    checkInTime: a.checkInTime ? new Date(a.checkInTime) : a.checkInTime,
    completedAt: a.completedAt ? new Date(a.completedAt) : a.completedAt,
    cancelledAt: a.cancelledAt ? new Date(a.cancelledAt) : a.cancelledAt,
  }));
}

/**
 * Update appointment status
 */
export async function updateAppointmentStatus(
  appointmentId: string,
  status: AppointmentStatus,
  updates?: { checkInTime?: Date | string | null; completedAt?: Date | string | null; cancelledAt?: Date | string | null }
): Promise<void> {
  const response = await fetch('/api/appointments', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appointmentId, status, ...updates }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to update appointment');
  }
}




