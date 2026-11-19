/**
 * Client-side wrapper for Patient API (Medplum FHIR)
 * Use this in your React components
 */
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

/** Reads only (list/search/stats): a stalled request ends in the page error + Retry state. */
const PATIENT_READ_TIMEOUT_MS = 20_000;

export interface PatientInput {
  fullName: string;
  nric: string;
  active?: boolean;
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

export interface RegistrationPilotResult {
  patientId: string;
  questionnaireResponseId?: string;
  questionnaireVersion?: string;
  mismatchCount?: number;
  mismatchFields?: string[];
}

export class PatientApiError extends Error {
  code?: string;
  existingPatientId?: string;
  existingPatientName?: string;
  existingPatientNric?: string;

  constructor(message: string, options?: {
    code?: string;
    existingPatientId?: string;
    existingPatientName?: string;
    existingPatientNric?: string;
  }) {
    super(message);
    this.name = "PatientApiError";
    this.code = options?.code;
    this.existingPatientId = options?.existingPatientId;
    this.existingPatientName = options?.existingPatientName;
    this.existingPatientNric = options?.existingPatientNric;
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapPatientRows(patients: unknown[]): Patient[] {
  return patients.map((p: any) => ({
    ...p,
    dateOfBirth: new Date(p.dateOfBirth),
    createdAt: new Date(p.createdAt),
    updatedAt: new Date(p.updatedAt),
  }));
}

function toPatientApiError(data: Record<string, unknown>, fallback: string): PatientApiError {
  return new PatientApiError(typeof data.error === "string" ? data.error : fallback, {
    code: typeof data.code === "string" ? data.code : undefined,
    existingPatientId:
      typeof data.existingPatientId === "string" ? data.existingPatientId : undefined,
    existingPatientName:
      typeof data.existingPatientName === "string" ? data.existingPatientName : undefined,
    existingPatientNric:
      typeof data.existingPatientNric === "string" ? data.existingPatientNric : undefined,
  });
}

/**
 * Save a patient to Medplum (replaces createPatient from Firebase)
 */
export async function savePatient(patient: PatientInput, clinicId?: string): Promise<string> {
  const response = await fetch('/api/patients', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(clinicId ? { 'X-Clinic-Id': clinicId } : {}),
    },
    body: JSON.stringify(patient),
  });

  const data = await readJson(response);

  if (!response.ok || !data.success) {
    throw toPatientApiError(data, 'Failed to save patient');
  }

  return data.patientId as string;
}

/**
 * Save patient through the Questionnaire/QuestionnaireResponse pilot path.
 * This still creates the patient using the current patient creation service.
 */
export async function savePatientThroughIntakePilot(
  patient: PatientInput,
  clinicId?: string
): Promise<RegistrationPilotResult> {
  const response = await fetch("/api/patients/intake-pilot", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(clinicId ? { "X-Clinic-Id": clinicId } : {}),
    },
    body: JSON.stringify(patient),
  });

  const data = await readJson(response);

  if (!response.ok || !data.success) {
    throw toPatientApiError(data, "Failed to save patient through intake pilot");
  }

  return {
    patientId: String(data.patientId),
    questionnaireResponseId:
      typeof data.questionnaireResponseId === "string" ? data.questionnaireResponseId : undefined,
    questionnaireVersion: typeof data.questionnaireVersion === "string" ? data.questionnaireVersion : undefined,
    mismatchCount: typeof data.mismatchCount === "number" ? data.mismatchCount : undefined,
    mismatchFields: Array.isArray(data.mismatchFields)
      ? data.mismatchFields.filter((field): field is string => typeof field === "string")
      : undefined,
  };
}

/**
 * Get a patient by ID from Medplum
 */
export async function getPatient(patientId: string, clinicId?: string): Promise<Patient | null> {
  const response = await fetch(`/api/patients?id=${patientId}`, {
    credentials: 'include',
    headers: clinicId ? { 'X-Clinic-Id': clinicId } : undefined,
  });
  const data = await readJson(response);

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(typeof data.error === 'string' ? data.error : 'Failed to get patient');
  }

  const patient = data.patient as any;
  return {
    ...patient,
    dateOfBirth: new Date(patient.dateOfBirth),
    createdAt: new Date(patient.createdAt),
    updatedAt: new Date(patient.updatedAt),
  };
}

/**
 * Get all patients from Medplum
 */
export async function getAllPatients(limit = 100, clinicId?: string): Promise<Patient[]> {
  const response = await fetch(`/api/patients?limit=${limit}`, {
    credentials: 'include',
    headers: clinicId ? { 'X-Clinic-Id': clinicId } : undefined,
  });
  const data = await readJson(response);

  if (!response.ok || !data.success) {
    const msg =
      typeof data.error === 'string'
        ? data.error
        : `Failed to get patients (${response.status})`;
    throw new Error(msg);
  }

  const rows = Array.isArray(data.patients) ? data.patients : [];
  return mapPatientRows(rows);
}

export interface PatientsPage {
  patients: Patient[];
  total: number | null;
  page: number;
  pageSize: number;
}

/** One server-side page of the clinic's patients, with exact total when available. */
export async function getPatientsPage(page: number, pageSize = 25, clinicId?: string): Promise<PatientsPage> {
  const response = await fetchWithTimeout(`/api/patients?page=${page}&pageSize=${pageSize}`, {
    credentials: 'include',
    headers: clinicId ? { 'X-Clinic-Id': clinicId } : undefined,
  }, PATIENT_READ_TIMEOUT_MS);
  const data = await readJson(response);
  if (!response.ok || !data.success) {
    throw new Error(typeof data.error === 'string' ? data.error : `Failed to get patients (${response.status})`);
  }
  return {
    patients: mapPatientRows(Array.isArray(data.patients) ? data.patients : []),
    total: typeof data.total === 'number' ? data.total : null,
    page: typeof data.page === 'number' ? data.page : page,
    pageSize: typeof data.pageSize === 'number' ? data.pageSize : pageSize,
  };
}

/** Clinic-scoped real patient counts. `null` = server gave no exact total. */
export async function getPatientStats(clinicId?: string): Promise<{ total: number | null; newThisMonth: number | null }> {
  const response = await fetchWithTimeout('/api/patients?stats=1', {
    credentials: 'include',
    headers: clinicId ? { 'X-Clinic-Id': clinicId } : undefined,
  }, PATIENT_READ_TIMEOUT_MS);
  const data = await readJson(response);
  if (!response.ok || !data.success) {
    throw new Error(typeof data.error === 'string' ? data.error : `Failed to get patient stats (${response.status})`);
  }
  return {
    total: typeof data.total === 'number' ? data.total : null,
    newThisMonth: typeof data.newThisMonth === 'number' ? data.newThisMonth : null,
  };
}

/** One server-side page of search results (name/NRIC/phone) across the whole clinic. */
export async function searchPatientsPage(
  query: string,
  page: number,
  pageSize = 25,
  clinicId?: string
): Promise<PatientsPage & { capped: boolean }> {
  const response = await fetchWithTimeout(
    `/api/patients?search=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`,
    { credentials: 'include', headers: clinicId ? { 'X-Clinic-Id': clinicId } : undefined },
    PATIENT_READ_TIMEOUT_MS
  );
  const data = await readJson(response);
  if (!response.ok || !data.success) {
    throw new Error(typeof data.error === 'string' ? data.error : `Failed to search patients (${response.status})`);
  }
  return {
    patients: mapPatientRows(Array.isArray(data.patients) ? data.patients : []),
    total: typeof data.total === 'number' ? data.total : null,
    page: typeof data.page === 'number' ? data.page : page,
    pageSize: typeof data.pageSize === 'number' ? data.pageSize : pageSize,
    capped: data.capped === true,
  };
}

/**
 * Search patients by name, NRIC or phone
 */
export async function searchPatients(query: string, clinicId?: string): Promise<Patient[]> {
  const response = await fetch(`/api/patients?search=${encodeURIComponent(query)}`, {
    credentials: 'include',
    headers: clinicId ? { 'X-Clinic-Id': clinicId } : undefined,
  });
  const data = await readJson(response);

  if (!response.ok || !data.success) {
    const msg =
      typeof data.error === 'string'
        ? data.error
        : `Failed to search patients (${response.status})`;
    throw new Error(msg);
  }

  const rows = Array.isArray(data.patients) ? data.patients : [];
  return mapPatientRows(rows);
}

/**
 * Update a patient
 */
export async function updatePatient(
  patientId: string,
  updates: Partial<PatientInput>,
  clinicId?: string
): Promise<void> {
  const response = await fetch('/api/patients', {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(clinicId ? { 'X-Clinic-Id': clinicId } : {}),
    },
    body: JSON.stringify({ patientId, ...updates }),
  });

  const data = await readJson(response);

  if (!response.ok || !data.success) {
    throw toPatientApiError(data, 'Failed to update patient');
  }
}
