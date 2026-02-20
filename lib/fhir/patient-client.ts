/**
 * Client-side wrapper for Patient API (Medplum FHIR)
 * Use this in your React components
 */

export interface PatientInput {
  fullName: string;
  identifierType?: "nric" | "non_malaysian_ic" | "passport";
  identifierValue?: string;
  nric?: string;
  dateOfBirth: Date | string;
  gender: 'male' | 'female' | 'other';
  email?: string;
  phone: string;
  address: string;
  postalCode?: string;
  emergencyContact?: {
    name: string;
    relationship: string;
    phone: string;
  };
  medicalHistory?: {
    allergies: string[];
    conditions: string[];
    medications: string[];
  };
}

export interface Patient extends PatientInput {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Save a patient to Medplum (replaces createPatient from Firebase)
 */
export async function savePatient(patient: PatientInput, clinicId?: string): Promise<string> {
  const response = await fetch('/api/patients', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      ...(clinicId ? { 'X-Clinic-Id': clinicId } : {}),
    },
    body: JSON.stringify(patient),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to save patient');
  }

  return data.patientId;
}

/**
 * Get a patient by ID from Medplum
 */
export async function getPatient(patientId: string, clinicId?: string): Promise<Patient | null> {
  // Get clinicId from cookie if not provided
  const finalClinicId = clinicId || getClinicIdFromCookie();
  
  const response = await fetch(`/api/patients?id=${patientId}`, {
    headers: finalClinicId ? { 'X-Clinic-Id': finalClinicId } : undefined,
  });
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 404) return null;
    const errorMessage = data.error || 'Failed to get patient';
    console.error('Failed to get patient:', {
      status: response.status,
      error: errorMessage,
      patientId,
      clinicId: finalClinicId,
    });
    throw new Error(errorMessage);
  }

  const patient = data.patient;
  return {
    ...patient,
    dateOfBirth: new Date(patient.dateOfBirth),
    createdAt: new Date(patient.createdAt),
    updatedAt: new Date(patient.updatedAt),
  };
}

/**
 * Get clinic ID from cookie (set by proxy middleware)
 */
function getClinicIdFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';');
  const clinicCookie = cookies.find(c => c.trim().startsWith('medplum-clinic='));
  return clinicCookie ? clinicCookie.split('=')[1] : null;
}

/**
 * Get all patients from Medplum
 */
export async function getAllPatients(limit = 100, clinicId?: string): Promise<Patient[]> {
  // Get clinicId from cookie if not provided
  const finalClinicId = clinicId || getClinicIdFromCookie();
  
  const response = await fetch(`/api/patients?limit=${limit}`, {
    headers: finalClinicId ? { 'X-Clinic-Id': finalClinicId } : undefined,
  });
  const data = await response.json();

  if (!response.ok || !data.success) {
    const errorMessage = data.error || 'Failed to get patients';
    console.error('Failed to get patients:', {
      status: response.status,
      error: errorMessage,
      clinicId: finalClinicId,
    });
    throw new Error(errorMessage);
  }

  return data.patients.map((p: any) => ({
    ...p,
    dateOfBirth: new Date(p.dateOfBirth),
    createdAt: new Date(p.createdAt),
    updatedAt: new Date(p.updatedAt),
  }));
}

/**
 * Search patients by name or NRIC
 */
export async function searchPatients(query: string, clinicId?: string): Promise<Patient[]> {
  // Get clinicId from cookie if not provided
  const finalClinicId = clinicId || getClinicIdFromCookie();
  
  const response = await fetch(`/api/patients?search=${encodeURIComponent(query)}`, {
    headers: finalClinicId ? { 'X-Clinic-Id': finalClinicId } : undefined,
  });
  const data = await response.json();

  if (!response.ok || !data.success) {
    const errorMessage = data.error || 'Failed to search patients';
    console.error('Failed to search patients:', {
      status: response.status,
      error: errorMessage,
      query,
      clinicId: finalClinicId,
    });
    throw new Error(errorMessage);
  }

  return data.patients.map((p: any) => ({
    ...p,
    dateOfBirth: new Date(p.dateOfBirth),
    createdAt: new Date(p.createdAt),
    updatedAt: new Date(p.updatedAt),
  }));
}

/**
 * Update a patient
 */
export async function updatePatient(patientId: string, updates: Partial<PatientInput>, clinicId?: string): Promise<void> {
  const response = await fetch('/api/patients', {
    method: 'PATCH',
    headers: { 
      'Content-Type': 'application/json',
      ...(clinicId ? { 'X-Clinic-Id': clinicId } : {}),
    },
    body: JSON.stringify({ patientId, ...updates }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to update patient');
  }
}







