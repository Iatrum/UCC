/**
 * Patient Service - Medplum FHIR as Source of Truth
 * 
 * Replaces Firebase patients with FHIR Patient resources
 */

import { withRegistrationTag, registeredThisMonthTagParam } from './patient-registration';
import { MedplumClient } from '@medplum/core';
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import type {
  Patient as FHIRPatient,
  AllergyIntolerance,
  Condition,
  MedicationStatement,
} from '@medplum/fhirtypes';
import { QueueStatus, TriageData, VitalSigns } from '../types';
import { TRIAGE_EXTENSION_URL } from './structure-definitions';
import { createProvenanceForResource } from './provenance-service';
import { validateAndCreate } from './fhir-helpers';
import { ConflictError, NotFoundError } from '@/lib/server/route-helpers';
import {
  CLINIC_IDENTIFIER_SYSTEM,
  assignPatientToClinicTenant,
  resolveClinicTenant,
  resolveClinicTenantMemo,
  resourceMatchesClinicTenant,
  withClinicIdentifier,
} from './clinic-tenancy';

// Local Patient interface that matches your app
export interface PatientData {
  id?: string;
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

export interface SavedPatient extends PatientData {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  lastVisit?: Date;
  triage?: TriageData;
  queueStatus?: QueueStatus | null;
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
}

const DUPLICATE_NRIC_CODE = 'DUPLICATE_NRIC';
// Must match TRIAGE_ENCOUNTER_EXTENSION_URL in triage-service.ts (cannot import — circular dep)
const TRIAGE_ENCOUNTER_EXTENSION_URL = 'https://ucc.emr/triage-encounter';

type DuplicatePatientMatch = {
  id: string;
  fullName: string;
  nric: string;
};

type Extension = { url: string;[key: string]: any };

function matchesClinic(
  resource: { identifier?: { system?: string; value?: string }[]; managingOrganization?: { reference?: string } },
  clinicId?: string | null
): boolean {
  return resourceMatchesClinicTenant(resource, clinicId);
}

/**
 * Like matchesClinic, but throws instead of returning false.
 * Use this on write paths (update, delete) where a mismatch is a security violation.
 */
function assertMatchesClinic(
  resource: Parameters<typeof matchesClinic>[0],
  clinicId: string,
  resourceLabel = 'resource'
): void {
  if (!matchesClinic(resource, clinicId)) {
    // Id-addressed and foreign is indistinguishable from missing: 404 (Task 422 rule, Task 645).
    throw new NotFoundError(`${resourceLabel} not found.`);
  }
}

function addManagingOrganization<T extends { [key: string]: any }>(
  resource: T,
  organizationReference?: string
): T {
  if (!organizationReference) return resource;
  return {
    ...resource,
    managingOrganization: { reference: organizationReference },
  };
}

async function findPatientByNric(
  client: MedplumClient,
  nric: string,
  clinicScopeId?: string,
  options?: { excludePatientId?: string }
): Promise<DuplicatePatientMatch | null> {
  if (!nric) return null;

  // Clinic-scoped at the source (Task 702): the caller may hold a privileged/admin client, so foreign-clinic
  // patients must never be returned by the search at all. Ownership is the same as matchesClinic:
  // clinic identifier tag, or a managingOrganization / account / compartment reference (legacy patients
  // without the tag). The matchesClinic filter below stays as defence in depth.
  const scopes: string[][] = [[]];
  if (clinicScopeId) {
    const tenant = await resolveClinicTenantMemo(client, clinicScopeId);
    const orgRefs = Array.from(new Set([tenant?.organizationReference, `Organization/${clinicScopeId}`].filter(Boolean))) as string[];
    const compartmentRefs = Array.from(
      new Set([...orgRefs, tenant?.accountReference, `HealthcareService/${clinicScopeId}`].filter(Boolean))
    ) as string[];
    scopes.length = 0;
    scopes.push(
      [`identifier=${encodeURIComponent(`${CLINIC_IDENTIFIER_SYSTEM}|${clinicScopeId}`)}`],
      [`organization=${orgRefs.map(encodeURIComponent).join(',')}`],
      [`_compartment=${compartmentRefs.map(encodeURIComponent).join(',')}`]
    );
  }
  const searches = ['nric', 'ic'].flatMap((system) =>
    scopes.map((scope) =>
      client.searchResources(
        'Patient',
        [`identifier=${encodeURIComponent(`${system}|${nric}`)}`, ...scope, '_count=20'].join('&')
      )
    )
  );
  const matches = (await Promise.all(searches)).flat();

  const match = matches.find((patient) => {
    if (!matchesClinic(patient, clinicScopeId)) {
      return false;
    }
    if (options?.excludePatientId && patient.id === options.excludePatientId) {
      return false;
    }
    return true;
  });

  if (!match?.id) {
    return null;
  }

  const patientData = fhirPatientToPatientData(match);
  return {
    id: match.id,
    fullName: patientData.fullName,
    nric: patientData.nric,
  };
}

function throwDuplicatePatientConflict(match: DuplicatePatientMatch): never {
  throw new ConflictError(`Patient with NRIC ${match.nric} already exists.`, {
    code: DUPLICATE_NRIC_CODE,
    details: {
      existingPatientId: match.id,
      existingPatientName: match.fullName,
      existingPatientNric: match.nric,
    },
  });
}



/**
 * Convert FHIR Patient to app PatientData format
 */
export function fhirPatientToPatientData(fhirPatient: FHIRPatient): SavedPatient {
  const name = fhirPatient.name?.[0];
  const fullName = name?.text || [name?.given?.join(' '), name?.family].filter(Boolean).join(' ') || 'Unknown';

  const nricIdentifier = fhirPatient.identifier?.find(id => id.system === 'nric' || id.system === 'ic');
  const phoneContact = fhirPatient.telecom?.find(t => t.system === 'phone');
  const emailContact = fhirPatient.telecom?.find(t => t.system === 'email');
  const emergencyContact = fhirPatient.contact?.[0];
  const triageInfo = parseTriageExtension(fhirPatient.extension);

  return {
    id: fhirPatient.id!,
    fullName,
    nric: nricIdentifier?.value || '',
    dateOfBirth: fhirPatient.birthDate || '',
    gender: (fhirPatient.gender as 'male' | 'female' | 'other') || 'other',
    email: emailContact?.value,
    phone: phoneContact?.value || '',
    active: fhirPatient.active !== false,
    address: fhirPatient.address?.[0]?.text || '',
    postalCode: fhirPatient.address?.[0]?.postalCode,
    emergencyContact: emergencyContact ? {
      name: emergencyContact.name?.text || '',
      relationship: emergencyContact.relationship?.[0]?.text || '',
      phone: emergencyContact.telecom?.find(t => t.system === 'phone')?.value || '',
    } : undefined,
    medicalHistory: {
      allergies: [],
      conditions: [],
      medications: [],
    },
    createdAt: fhirPatient.meta?.lastUpdated ? new Date(fhirPatient.meta.lastUpdated) : new Date(),
    updatedAt: fhirPatient.meta?.lastUpdated ? new Date(fhirPatient.meta.lastUpdated) : new Date(),
    triage: triageInfo.triage,
    queueStatus: triageInfo.queueStatus ?? null,
    queueAddedAt: triageInfo.queueAddedAt ?? null,
  };
}

function parseTriageExtension(extensions?: Extension[]): {
  triage?: TriageData;
  queueStatus?: QueueStatus | null;
  queueAddedAt?: string | null;
} {
  if (!extensions?.length) return {};
  const triageExt = extensions.find((ext) => ext.url === TRIAGE_EXTENSION_URL);
  if (!triageExt?.extension) return {};

  const getSub = (key: string) => triageExt.extension?.find((e: any) => e.url === key);
  const vitalExt = getSub('vitalSigns');
  const vitals: VitalSigns = {
    bloodPressureSystolic: vitalExt?.extension?.find((e: any) => e.url === 'bloodPressureSystolic')?.valueInteger,
    bloodPressureDiastolic: vitalExt?.extension?.find((e: any) => e.url === 'bloodPressureDiastolic')?.valueInteger,
    heartRate: vitalExt?.extension?.find((e: any) => e.url === 'heartRate')?.valueInteger,
    respiratoryRate: vitalExt?.extension?.find((e: any) => e.url === 'respiratoryRate')?.valueInteger,
    temperature: vitalExt?.extension?.find((e: any) => e.url === 'temperature')?.valueDecimal,
    oxygenSaturation: vitalExt?.extension?.find((e: any) => e.url === 'oxygenSaturation')?.valueInteger,
    painScore: vitalExt?.extension?.find((e: any) => e.url === 'painScore')?.valueInteger,
    weight: vitalExt?.extension?.find((e: any) => e.url === 'weight')?.valueDecimal,
    height: vitalExt?.extension?.find((e: any) => e.url === 'height')?.valueDecimal,
  };

  const redFlagsExt = getSub('redFlags');
  const redFlags =
    redFlagsExt?.extension
      ?.map((e: any) => e.valueString)
      ?.filter((val: string | undefined): val is string => Boolean(val)) ?? [];

  const triageLevel = getSub('triageLevel')?.valueInteger;
  const chiefComplaint = getSub('chiefComplaint')?.valueString;

  const triage =
    typeof triageLevel === 'number' && chiefComplaint
      ? ({
        triageLevel,
        chiefComplaint,
        triageNotes: getSub('triageNotes')?.valueString,
        triageBy: getSub('triageBy')?.valueString,
        triageAt: getSub('triageAt')?.valueDateTime,
        isTriaged: Boolean(getSub('isTriaged')?.valueBoolean),
        vitalSigns: vitals,
        redFlags,
      } as TriageData)
      : undefined;

  return {
    triage,
    queueStatus: (getSub('queueStatus')?.valueString as QueueStatus) ?? null,
    queueAddedAt: getSub('queueAddedAt')?.valueDateTime ?? null,
  };
}

function buildTriageExtension(triageData: Omit<TriageData, 'triageAt' | 'isTriaged'> & { queueStatus?: QueueStatus; queueAddedAt?: string }) {
  const nowIso = new Date().toISOString();
  const redFlagExtensions =
    triageData.redFlags?.map((flag) => ({
      url: 'flag',
      valueString: flag,
    })) ?? [];

  const vitalExtensions: Extension[] = [];
  const pushVital = (url: string, value: number | undefined, key: 'valueInteger' | 'valueDecimal' = 'valueInteger') => {
    if (typeof value === 'number') {
      vitalExtensions.push({ url, [key]: value });
    }
  };

  pushVital('bloodPressureSystolic', triageData.vitalSigns?.bloodPressureSystolic);
  pushVital('bloodPressureDiastolic', triageData.vitalSigns?.bloodPressureDiastolic);
  pushVital('heartRate', triageData.vitalSigns?.heartRate);
  pushVital('respiratoryRate', triageData.vitalSigns?.respiratoryRate);
  pushVital('temperature', triageData.vitalSigns?.temperature, 'valueDecimal');
  pushVital('oxygenSaturation', triageData.vitalSigns?.oxygenSaturation);
  pushVital('painScore', triageData.vitalSigns?.painScore);
  pushVital('weight', triageData.vitalSigns?.weight, 'valueDecimal');
  pushVital('height', triageData.vitalSigns?.height, 'valueDecimal');

  return {
    url: TRIAGE_EXTENSION_URL,
    extension: [
      { url: 'triageLevel', valueInteger: triageData.triageLevel },
      { url: 'chiefComplaint', valueString: triageData.chiefComplaint },
      ...(triageData.triageNotes ? [{ url: 'triageNotes', valueString: triageData.triageNotes }] : []),
      ...(triageData.triageBy ? [{ url: 'triageBy', valueString: triageData.triageBy }] : []),
      { url: 'triageAt', valueDateTime: nowIso },
      { url: 'isTriaged', valueBoolean: true },
      { url: 'queueStatus', valueString: triageData.queueStatus ?? 'waiting' },
      { url: 'queueAddedAt', valueDateTime: triageData.queueAddedAt ?? nowIso },
      { url: 'vitalSigns', extension: vitalExtensions },
      ...(redFlagExtensions.length
        ? [
          {
            url: 'redFlags',
            extension: redFlagExtensions,
          },
        ]
        : []),
    ],
  };
}

/**
 * Save a patient to Medplum as FHIR Patient resource
 */
export async function savePatientToMedplum(
  patientData: PatientData,
  clinicId: string | undefined,
  medplum: MedplumClient
): Promise<string> {
  const client = medplum;

  console.log(`💾 Saving patient to Medplum FHIR...`);

  const clinicTenant = await resolveClinicTenant(client, clinicId);
  const duplicatePatient = await findPatientByNric(client, patientData.nric, clinicId);
  if (duplicatePatient) {
    throwDuplicatePatientConflict(duplicatePatient);
  }

  const nameParts = patientData.fullName.split(' ');
  const family = nameParts.pop() || '';
  const given = nameParts;

  // Normalize birthDate to FHIR-compliant YYYY-MM-DD
  let birthDate: string | undefined;
  if (patientData.dateOfBirth) {
    try {
      const dob =
        patientData.dateOfBirth instanceof Date
          ? patientData.dateOfBirth
          : new Date(patientData.dateOfBirth);
      if (!isNaN(dob.getTime())) {
        birthDate = dob.toISOString().split('T')[0]; // FHIR date (no time)
      }
    } catch {
      // leave birthDate undefined; Medplum will reject if required
    }
  }

  const basePatient: FHIRPatient = {
    resourceType: 'Patient',
    active: true,  // FHIR compliance: mark patient as active
    identifier: [
      { system: 'nric', value: patientData.nric },
    ],
    name: [
      {
        text: patientData.fullName,
        family,
        given,
      },
    ],
    birthDate,
    gender: patientData.gender,
    telecom: [
      ...(patientData.phone ? [{ system: 'phone' as const, value: patientData.phone }] : []),
      ...(patientData.email ? [{ system: 'email' as const, value: patientData.email }] : []),
    ],
    address: patientData.address ? [
      {
        text: patientData.address,
        postalCode: patientData.postalCode,
      },
    ] : undefined,
    contact: patientData.emergencyContact ? [
      {
        name: { text: patientData.emergencyContact.name },
        relationship: [{ text: patientData.emergencyContact.relationship }],
        telecom: [{ system: 'phone', value: patientData.emergencyContact.phone }],
      },
    ] : undefined,
  };

  const fhirPatient = withRegistrationTag(withClinicIdentifier(
    addManagingOrganization(basePatient, clinicTenant?.organizationReference),
    clinicId
  ));

  const savedPatient = await validateAndCreate<FHIRPatient>(client, fhirPatient);
  await assignPatientToClinicTenant(client, savedPatient, clinicTenant);
  console.log(`✅ Created FHIR Patient: ${savedPatient.id}`);

  // Create Provenance for audit trail (non-blocking)
  if (savedPatient.id) {
    try {
      await createProvenanceForResource(
        client,
        'Patient',
        savedPatient.id,
        undefined,
        clinicId,
        'CREATE',
        clinicTenant ? [{ reference: clinicTenant.accountReference }] : undefined
      );
      console.log(`✅ Created Provenance for Patient/${savedPatient.id}`);
    } catch (error) {
      console.warn(`⚠️  Failed to create Provenance for Patient (non-blocking):`, error);
    }
  }

  // Save allergies as AllergyIntolerance resources
  if (patientData.medicalHistory?.allergies?.length) {
    for (const allergy of patientData.medicalHistory.allergies) {
      if (!allergy.trim()) continue;

      const allergyResource = await validateAndCreate<AllergyIntolerance>(client, {
        resourceType: 'AllergyIntolerance',
        patient: { reference: `Patient/${savedPatient.id}` },
        code: { text: allergy },
        clinicalStatus: {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }],
        },
        verificationStatus: {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification', code: 'confirmed' }],
        },
      });
      
      // Create Provenance for audit trail (non-blocking)
      if (allergyResource.id) {
        try {
          await createProvenanceForResource(
            client,
            'AllergyIntolerance',
            allergyResource.id,
            undefined,
            clinicId,
            'CREATE',
            clinicTenant ? [{ reference: clinicTenant.accountReference }] : undefined
          );
        } catch (error) {
          console.warn(`⚠️  Failed to create Provenance for AllergyIntolerance (non-blocking):`, error);
        }
      }
    }
    console.log(`✅ Saved ${patientData.medicalHistory.allergies.length} allergies`);
  }

  // Save conditions as Condition resources
  if (patientData.medicalHistory?.conditions?.length) {
    for (const condition of patientData.medicalHistory.conditions) {
      if (!condition.trim()) continue;

      const conditionResource = await validateAndCreate<Condition>(client, {
        resourceType: 'Condition',
        subject: { reference: `Patient/${savedPatient.id}` },
        code: { text: condition },
        clinicalStatus: {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
        },
      });
      
      // Create Provenance for audit trail (non-blocking)
      if (conditionResource.id) {
        try {
          await createProvenanceForResource(
            client,
            'Condition',
            conditionResource.id,
            undefined,
            clinicId,
            'CREATE',
            clinicTenant ? [{ reference: clinicTenant.accountReference }] : undefined
          );
        } catch (error) {
          console.warn(`⚠️  Failed to create Provenance for Condition (non-blocking):`, error);
        }
      }
    }
    console.log(`✅ Saved ${patientData.medicalHistory.conditions.length} conditions`);
  }

  // Save medications as MedicationStatement resources
  if (patientData.medicalHistory?.medications?.length) {
    for (const medication of patientData.medicalHistory.medications) {
      if (!medication.trim()) continue;

      const medicationResource = await validateAndCreate<MedicationStatement>(client, {
        resourceType: 'MedicationStatement',
        status: 'active',
        subject: { reference: `Patient/${savedPatient.id}` },
        medicationCodeableConcept: { text: medication },
      });
      
      // Create Provenance for audit trail (non-blocking)
      if (medicationResource.id) {
        try {
          await createProvenanceForResource(
            client,
            'MedicationStatement',
            medicationResource.id,
            undefined,
            clinicId,
            'CREATE',
            clinicTenant ? [{ reference: clinicTenant.accountReference }] : undefined
          );
        } catch (error) {
          console.warn(`⚠️  Failed to create Provenance for MedicationStatement (non-blocking):`, error);
        }
      }
    }
    console.log(`✅ Saved ${patientData.medicalHistory.medications.length} medications`);
  }

  return savedPatient.id!;
}

export async function savePatientToMedplumWithAdmin(
  patientData: PatientData,
  clinicId: string | undefined
): Promise<string> {
  return savePatientToMedplum(patientData, clinicId, await getAdminMedplum());
}

/**
 * Get a patient from Medplum by ID
 */
export async function getPatientFromMedplum(
  patientId: string,
  clinicId?: string | null,
  medplum?: MedplumClient,
  { includeMedicalHistory = true }: { includeMedicalHistory?: boolean } = {}
): Promise<SavedPatient | null> {
  try {
    const client = medplum ?? (await getAdminMedplum());
    // Tenant lookup and Patient read are independent: run them concurrently (Task 537).
    const tenantPromise = resolveClinicTenantMemo(client, clinicId);
    // A rejection is surfaced by the await below; this only prevents an unhandled-rejection warning
    // if the Patient read throws first.
    tenantPromise.catch(() => undefined);
    const fhirPatient = await client.readResource('Patient', patientId);
    if (!matchesClinic(fhirPatient, clinicId)) {
      await tenantPromise;
      return null;
    }
    const patientData = fhirPatientToPatientData(fhirPatient);

    if (includeMedicalHistory) {
      // The history searches only need the (clinic-checked) patient id, so they run alongside the tenant
      // lookup instead of after it (Task 593). The tenant is still awaited before anything is returned.
      const [, allergies, conditions, medications, recentEncounters] = await Promise.all([
        tenantPromise,
        client.searchResources('AllergyIntolerance', { patient: `Patient/${patientId}` }),
        client.searchResources('Condition', { subject: `Patient/${patientId}` }),
        client.searchResources('MedicationStatement', { subject: `Patient/${patientId}` }),
        client.searchResources('Encounter', { subject: `Patient/${patientId}`, status: 'finished', _sort: '-date', _count: '1' }),
      ]);
      patientData.medicalHistory!.allergies = allergies.map((a: AllergyIntolerance) => (a as any).code?.text || 'Unknown allergy');
      patientData.medicalHistory!.conditions = conditions.filter((c: Condition) => !(c as any).encounter).map((c: Condition) => (c as any).code?.text || 'Unknown condition');
      patientData.medicalHistory!.medications = medications.map((m: MedicationStatement) => (m as any).medicationCodeableConcept?.text || 'Unknown medication');
      const visitDate = recentEncounters.length > 0 ? (recentEncounters[0] as any)?.period?.start : null;
      if (visitDate) patientData.lastVisit = new Date(visitDate);
    } else {
      await tenantPromise;
    }

    return patientData;
  } catch (error: any) {
    const status = error?.status ?? error?.statusCode;
    console.error(
      `Failed to get patient from Medplum (patientId=${patientId}, status=${status}):`,
      error?.message ?? error
    );
    return null;
  }
}

/**
 * Several patients in one search per 100 ids (Task 547) instead of one read each. Clinic check is
 * identical to getPatientFromMedplum: a patient belonging to another clinic is dropped.
 */
export async function getPatientsByIdsFromMedplum(
  patientIds: string[],
  clinicId?: string | null,
  medplum?: MedplumClient
): Promise<Map<string, SavedPatient>> {
  const result = new Map<string, SavedPatient>();
  const ids = Array.from(new Set(patientIds.filter(Boolean)));
  if (ids.length === 0) return result;
  try {
    const client = medplum ?? (await getAdminMedplum());
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
    const pages = await Promise.all(
      chunks.map((chunk) =>
        client.searchResources('Patient', { _id: chunk.join(','), _count: String(chunk.length) })
      )
    );
    for (const fhirPatient of pages.flat()) {
      if (!fhirPatient.id || !ids.includes(fhirPatient.id)) continue;
      if (!matchesClinic(fhirPatient, clinicId)) continue;
      result.set(fhirPatient.id, fhirPatientToPatientData(fhirPatient));
    }
  } catch (error: any) {
    console.error('Failed to get patients by id from Medplum:', error?.message ?? error);
  }
  return result;
}

/**
 * Save triage + queue data to Medplum (Patient extension)
 */
export async function saveTriageToMedplum(
  patientId: string,
  triageData: Omit<TriageData, 'triageAt' | 'isTriaged'> & { triageBy?: string },
  clinicId?: string
): Promise<void> {
  const { getAdminMedplum } = await import('@/lib/server/medplum-admin');
  const medplum = await getAdminMedplum();
  const existingPatient = await medplum.readResource('Patient', patientId);
  await resolveClinicTenant(medplum, clinicId);
  if (clinicId) assertMatchesClinic(existingPatient, clinicId, `Patient/${patientId}`);

  const newExtension = buildTriageExtension({
    ...triageData,
    queueStatus: 'waiting',
    queueAddedAt: new Date().toISOString(),
  });

  const existingExtensions = existingPatient.extension || [];
  const filteredExtensions = existingExtensions.filter((ext: any) => ext.url !== TRIAGE_EXTENSION_URL);

  await medplum.updateResource({
    ...withClinicIdentifier(existingPatient, clinicId),
    extension: [...filteredExtensions, newExtension],
  });
}

/**
 * Update only queue status on the triage extension
 */
export async function updateQueueStatusInMedplum(patientId: string, status: QueueStatus | null, clinicId?: string): Promise<void> {
  const { getAdminMedplum } = await import('@/lib/server/medplum-admin');
  const medplum = await getAdminMedplum();
  const existingPatient = await medplum.readResource('Patient', patientId);
  await resolveClinicTenant(medplum, clinicId);
  if (clinicId) assertMatchesClinic(existingPatient, clinicId, `Patient/${patientId}`);
  const extensions = existingPatient.extension || [];
  const nowIso = new Date().toISOString();

  const triageExtIndex = extensions.findIndex((ext: any) => ext.url === TRIAGE_EXTENSION_URL);
  const triageExt: any =
    triageExtIndex >= 0
      ? { ...extensions[triageExtIndex], extension: [...(extensions[triageExtIndex].extension || [])] }
      : { url: TRIAGE_EXTENSION_URL, extension: [] };
  const currentQueueAddedAt =
    triageExt.extension.find((e: any) => e.url === 'queueAddedAt')?.valueDateTime || null;

  const setSub = (url: string, entry: any | null) => {
    const idx = triageExt.extension.findIndex((e: any) => e.url === url);
    if (entry === null) {
      if (idx >= 0) triageExt.extension.splice(idx, 1);
      return;
    }
    if (idx >= 0) {
      triageExt.extension[idx] = entry;
    } else {
      triageExt.extension.push(entry);
    }
  };

  if (status) {
    setSub('queueStatus', { url: 'queueStatus', valueString: status });
    setSub('queueAddedAt', { url: 'queueAddedAt', valueDateTime: currentQueueAddedAt || nowIso });
  } else {
    setSub('queueStatus', null);
    setSub('queueAddedAt', null);
  }

  const newExtensions = [...extensions];
  if (triageExtIndex >= 0) {
    newExtensions[triageExtIndex] = triageExt;
  } else {
    newExtensions.push(triageExt);
  }

  await medplum.updateResource({
    ...withClinicIdentifier(existingPatient, clinicId),
    extension: newExtensions,
  });
}

export const PATIENT_SEARCH_WINDOW = 500; // max rows pulled per sub-query before paging the merged set

/**
 * Server-side patient search across the caller's whole clinic (name, NRIC/IC, phone),
 * paged over the merged result set. Every sub-query carries the clinic identifier
 * filter where FHIR allows (name/phone) and all rows are post-filtered with matchesClinic.
 * `total` is the exact merged count unless a sub-query hit PATIENT_SEARCH_WINDOW (`capped`).
 */
export async function searchPatientsPageInMedplum(
  query: string,
  page: number,
  pageSize: number,
  clinicId: string | null | undefined,
  medplum: MedplumClient
): Promise<{ patients: SavedPatient[]; total: number; page: number; pageSize: number; capped: boolean }> {
  const size = Math.min(Math.max(Math.floor(pageSize) || 25, 1), PATIENT_PAGE_MAX_SIZE);
  const pg = Math.max(Math.floor(page) || 1, 1);
  const trimmed = query.trim();
  if (!trimmed) return { patients: [], total: 0, page: pg, pageSize: size, capped: false };
  const clinicParams = clinicPatientParams(clinicId); // fails closed without a clinic
  await resolveClinicTenantMemo(medplum, clinicId);

  const base = { _count: String(PATIENT_SEARCH_WINDOW), _sort: '-_lastUpdated' };
  const queries: Record<string, string>[] = [
    { ...base, ...clinicParams, 'name:contains': trimmed },
    { ...base, identifier: `nric|${trimmed}` },
    { ...base, identifier: `ic|${trimmed}` },
  ];
  // Phone: match as typed and as digits only (stored values may or may not contain separators).
  const digits = trimmed.replace(/[^\d+]/g, '');
  const phoneTerms = new Set<string>();
  if (digits.replace(/\D/g, '').length >= 3) phoneTerms.add(digits);
  if (/^[\d\s()+-]+$/.test(trimmed)) phoneTerms.add(trimmed);
  for (const term of phoneTerms) queries.push({ ...base, ...clinicParams, 'phone:contains': term });

  const results = await Promise.all(queries.map((q) => medplum.searchResources('Patient', q as any)));
  const capped = results.some((r) => r.length >= PATIENT_SEARCH_WINDOW);

  const seen = new Set<string>();
  const merged: FHIRPatient[] = [];
  for (const patient of results.flat()) {
    if (patient.id && !seen.has(patient.id)) {
      seen.add(patient.id);
      merged.push(patient);
    }
  }
  const all = merged
    .filter((r) => matchesClinic(r as any, clinicId))
    .filter((r) => r.active !== false)
    .sort((x, y) => String(y.meta?.lastUpdated ?? '').localeCompare(String(x.meta?.lastUpdated ?? '')));
  const offset = (pg - 1) * size;
  return {
    patients: all.slice(offset, offset + size).map((r) => fhirPatientToPatientData(r)),
    total: all.length,
    page: pg,
    pageSize: size,
    capped,
  };
}

/**
 * Search patients by name, NRIC or phone (first page, up to 50).
 */
export async function searchPatientsInMedplum(
  query: string,
  clinicId: string | null | undefined,
  medplum: MedplumClient
): Promise<SavedPatient[]> {
  try {
    return (await searchPatientsPageInMedplum(query, 1, 50, clinicId, medplum)).patients;
  } catch (error) {
    console.error('Failed to search patients in Medplum:', error);
    return [];
  }
}

/**
 * Get all patients from Medplum
 */
export async function getAllPatientsFromMedplum(
  limit = 100,
  clinicId: string | null | undefined,
  medplum: MedplumClient
): Promise<SavedPatient[]> {
  try {
    const client = medplum;
    // Scope by Medplum tenant compartment/account. clinicId is only the UI slug
    // used to resolve the Organization tenant. The tenant check runs alongside the searches
    // (Task 547) instead of ahead of them; the memo shares it with the other lookups.
    const [, patients, encounters] = await Promise.all([
      resolveClinicTenantMemo(client, clinicId),
      client.searchResources('Patient', {
        _count: String(limit),
        _sort: '-_lastUpdated',
        active: 'true',
        ...(clinicId ? { identifier: `${CLINIC_IDENTIFIER_SYSTEM}|${clinicId}` } : {}),
      }),
      client.searchResources('Encounter', {
        // Include all active statuses so newly checked-in patients show correct
        // queueStatus and lastVisit (arrived/triaged/in-progress would be missed
        // if we only fetched 'finished').
        status: 'arrived,triaged,in-progress,finished',
        _sort: '-date',
        _count: '500',
        ...(clinicId ? { identifier: `${CLINIC_IDENTIFIER_SYSTEM}|${clinicId}` } : {}),
      }),
    ]);

    // Encounters are sorted newest-first; first entry per patient wins.
    const lastVisitByPatientId = new Map<string, Date>();
    const queueInfoByPatientId = new Map<string, { queueStatus: QueueStatus | null; queueAddedAt: string | null }>();

    for (const encounter of encounters) {
      const ref = (encounter as any).subject?.reference as string | undefined;
      const visitDate = (encounter as any).period?.start as string | undefined;
      if (!ref) continue;
      const pid = ref.startsWith('Patient/') ? ref.slice(8) : ref;

      if (visitDate && !lastVisitByPatientId.has(pid)) {
        lastVisitByPatientId.set(pid, new Date(visitDate));
      }

      // Read queueStatus from the triage encounter extension (not the Patient extension,
      // which is never updated during check-in via triage-service.ts).
      if (!queueInfoByPatientId.has(pid)) {
        const triageExt = (encounter as any).extension?.find(
          (ext: any) => ext.url === TRIAGE_ENCOUNTER_EXTENSION_URL
        );
        if (triageExt?.extension) {
          const getSub = (key: string) => triageExt.extension.find((e: any) => e.url === key);
          const queueStatus = (getSub('queueStatus')?.valueString as QueueStatus) ?? null;
          const queueAddedAt = getSub('queueAddedAt')?.valueDateTime ?? visitDate ?? null;
          queueInfoByPatientId.set(pid, { queueStatus, queueAddedAt });
        }
      }
    }

    return patients
      .filter((patient) => matchesClinic(patient as any, clinicId))
      .map((patient) => {
        const data = fhirPatientToPatientData(patient);
        const lv = lastVisitByPatientId.get(data.id);
        if (lv) data.lastVisit = lv;
        const queueInfo = queueInfoByPatientId.get(data.id);
        if (queueInfo) {
          data.queueStatus = queueInfo.queueStatus;
          data.queueAddedAt = queueInfo.queueAddedAt;
        }
        return data;
      })
      .filter((patient) => patient.active !== false);
  } catch (error) {
    console.error('Failed to get patients from Medplum:', error);
    return [];
  }
}

export const PATIENT_PAGE_MAX_SIZE = 100;
export const PATIENT_MAX_OFFSET = 10000; // Medplum _offset ceiling

function clinicPatientParams(clinicId: string | null | undefined): Record<string, string> {
  // Fail closed: counts/pages must never be computed without a clinic filter.
  if (!clinicId) throw new Error('Clinic context required for patient counts/pages.');
  return {
    active: 'true',
    identifier: `${CLINIC_IDENTIFIER_SYSTEM}|${clinicId}`,
  };
}

/**
 * Exact (or null when the server did not return one) count of active patients
 * for the caller's clinic. FHIR R4 `_summary=count` + `_total=accurate`.
 */
export async function countPatientsInMedplum(
  clinicId: string | null | undefined,
  medplum: MedplumClient,
  extra: Record<string, string> = {}
): Promise<number | null> {
  await resolveClinicTenantMemo(medplum, clinicId);
  const bundle = await medplum.search('Patient', {
    ...clinicPatientParams(clinicId),
    ...extra,
    _summary: 'count',
    _total: 'accurate',
  } as any);
  return typeof bundle.total === 'number' ? bundle.total : null;
}

export async function countNewPatientsThisMonth(
  clinicId: string | null | undefined,
  medplum: MedplumClient,
  now = new Date()
): Promise<number | null> {
  // Counts by stored registration tag (not _lastUpdated, which moves on every edit).
  // Legacy patients without the tag are not counted.
  return countPatientsInMedplum(clinicId, medplum, { _tag: registeredThisMonthTagParam(now) });
}

/** One server-side page of the clinic's active patients plus the exact total. */
export async function getPatientsPageFromMedplum(
  page: number,
  pageSize: number,
  clinicId: string | null | undefined,
  medplum: MedplumClient
): Promise<{ patients: SavedPatient[]; total: number | null; page: number; pageSize: number }> {
  const size = Math.min(Math.max(Math.floor(pageSize) || 25, 1), PATIENT_PAGE_MAX_SIZE);
  const pg = Math.max(Math.floor(page) || 1, 1);
  const offset = (pg - 1) * size;
  const params = clinicPatientParams(clinicId);
  await resolveClinicTenantMemo(medplum, clinicId);
  // Beyond Medplum's _offset ceiling, return an empty page instead of repeating the last reachable one.
  if (offset > PATIENT_MAX_OFFSET) return { patients: [], total: null, page: pg, pageSize: size };
  const bundle = await medplum.search('Patient', {
    ...params,
    _sort: '-_lastUpdated',
    _count: String(size),
    _offset: String(offset),
    _total: 'accurate',
  } as any);
  const rows = (bundle.entry ?? [])
    .map((e) => e.resource as FHIRPatient)
    .filter((r) => r && matchesClinic(r as any, clinicId))
    .map((r) => fhirPatientToPatientData(r))
    .filter((r) => r.active !== false);
  return { patients: rows, total: typeof bundle.total === 'number' ? bundle.total : null, page: pg, pageSize: size };
}

/**
 * Update a patient in Medplum
 */
export async function updatePatientInMedplum(
  patientId: string,
  updates: Partial<PatientData>,
  clinicId: string | undefined,
  medplum: MedplumClient
): Promise<void> {
  const client = medplum;

  const existingPatient = await client.readResource('Patient', patientId);
  const clinicTenant = await resolveClinicTenant(client, clinicId);
  if (clinicId) assertMatchesClinic(existingPatient, clinicId, `Patient/${patientId}`);

  // Merge updates
  const updatedPatient: FHIRPatient = withClinicIdentifier(
    addManagingOrganization({
      ...existingPatient,
    }, clinicTenant?.organizationReference),
    clinicId
  );

  if (updates.nric && updates.nric !== fhirPatientToPatientData(existingPatient).nric) {
    const duplicatePatient = await findPatientByNric(client, updates.nric, clinicId, {
      excludePatientId: patientId,
    });
    if (duplicatePatient) {
      throwDuplicatePatientConflict(duplicatePatient);
    }

    const nonNricIdentifiers =
      updatedPatient.identifier?.filter((identifier) => identifier.system !== 'nric' && identifier.system !== 'ic') ?? [];
    updatedPatient.identifier = [...nonNricIdentifiers, { system: 'nric', value: updates.nric }];
  }

  if (updates.fullName) {
    const nameParts = updates.fullName.split(' ');
    const family = nameParts.pop() || '';
    const given = nameParts;
    updatedPatient.name = [{ text: updates.fullName, family, given }];
  }

  if (updates.dateOfBirth) {
    updatedPatient.birthDate =
      updates.dateOfBirth instanceof Date
        ? updates.dateOfBirth.toISOString().split('T')[0]
        : String(updates.dateOfBirth).split('T')[0];
  }

  if (updates.gender) {
    updatedPatient.gender = updates.gender;
  }

  if (updates.phone || updates.email) {
    const existing = existingPatient.telecom ?? [];
    const merged = existing.filter(
      (t) => t.system !== 'phone' && t.system !== 'email'
    );
    if (updates.phone) merged.push({ system: 'phone' as const, value: updates.phone });
    if (updates.email) merged.push({ system: 'email' as const, value: updates.email });
    updatedPatient.telecom = merged;
  }

  if (updates.address) {
    updatedPatient.address = [{ text: updates.address, postalCode: updates.postalCode }];
  }

  await client.updateResource(updatedPatient);
  await assignPatientToClinicTenant(client, updatedPatient, clinicTenant);
  console.log(`✅ Updated FHIR Patient: ${patientId}`);
}

export async function archivePatientInMedplum(
  patientId: string,
  clinicId: string | undefined,
  medplum: MedplumClient
): Promise<void> {
  const existingPatient = await medplum.readResource('Patient', patientId);
  const clinicTenant = await resolveClinicTenant(medplum, clinicId);
  if (clinicId) assertMatchesClinic(existingPatient, clinicId, `Patient/${patientId}`);
  await medplum.updateResource(withClinicIdentifier(
    addManagingOrganization({
      ...existingPatient,
      active: false,
    }, clinicTenant?.organizationReference),
    clinicId
  ));
}
