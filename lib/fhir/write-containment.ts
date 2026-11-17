import { ForbiddenError, NotFoundError } from "@/lib/server/route-helpers";
import type { MedplumClient } from "@medplum/core";
import { OperationOutcomeError, forbidden } from "@medplum/core";
import { assertOrderClinic, resolveClinicTenant, resourceMatchesClinicTenant, withClinicIdentifier, getResourceAccountReferences } from "@/lib/fhir/clinic-tenancy";

/**
 * Write-side clinic containment (Task 320). Medplum's AccessPolicy criteria do
 * not gate `create`, so every service that writes a resource referencing a
 * Patient must prove that Patient belongs to the caller's clinic first.
 * Throws a forbidden OperationOutcomeError (never reveals whether the id exists).
 * Missing clinic context fails closed, including privileged callers.
 */
export async function assertPatientInClinic(
  medplum: MedplumClient,
  clinicId: string | undefined | null,
  patientId: string | undefined | null,
  encounterId?: string
): Promise<void> {
  if (!clinicId) throw new OperationOutcomeError(forbidden);
  await assertOrderClinic(medplum, clinicId, patientId ?? "", encounterId);
}

/**
 * Task 350: authorize a write that targets an existing Encounter (for example a
 * clinical-note Observation). Unlike `assertPatientInClinic` this FAILS CLOSED
 * when `clinicId` is absent, because the Encounter's patient is not known to the
 * caller. Returns the Encounter's patient id. Always throws forbidden for a
 * missing, malformed, foreign or patient-less encounter.
 */
export async function assertEncounterInClinic(
  medplum: MedplumClient,
  clinicId: string | undefined | null,
  encounterId: string | undefined | null
): Promise<string> {
  if (!clinicId || !encounterId || !/^[A-Za-z0-9.-]+$/.test(encounterId)) {
    throw new OperationOutcomeError(forbidden);
  }
  let encounter;
  try {
    encounter = await medplum.readResource("Encounter", encounterId, { cache: "no-cache" });
  } catch {
    throw new OperationOutcomeError(forbidden);
  }
  const patientId = encounter.subject?.reference?.startsWith("Patient/")
    ? encounter.subject.reference.slice("Patient/".length)
    : undefined;
  if (!patientId) throw new OperationOutcomeError(forbidden);
  await assertOrderClinic(medplum, clinicId, patientId, encounterId);
  return patientId;
}

/**
 * Task 350: for migration/export writers that run with an admin client. Resolves
 * the clinic tenant (throws if the clinic is unknown - fail closed) and returns
 * `stamp(resource)`, which adds the clinic identifier and the clinic account so
 * every created resource is owned by exactly one clinic.
 */
export async function makeClinicStamper(
  medplum: MedplumClient,
  clinicId: string | undefined | null
): Promise<{ stamp: (resource: any) => any; isOwn: (resource: any) => boolean; patientSearch: { _compartment: string } }> {
  if (!clinicId) throw new OperationOutcomeError(forbidden);
  const tenant = await resolveClinicTenant(medplum, clinicId);
  if (!tenant) throw new OperationOutcomeError(forbidden);
  return {
    stamp: (resource) => {
      const tagged = withClinicIdentifier(resource, clinicId);
      return { ...tagged, meta: { ...(tagged.meta ?? {}), accounts: [{ reference: tenant.accountReference }] } };
    },
    patientSearch: { _compartment: tenant.accountReference },
    isOwn: (resource) => {
      const accounts = getResourceAccountReferences(resource);
      return accounts.length > 0 &&
        accounts.every(account => account.reference === tenant.accountReference) &&
        (!resource.identifier?.some((i: { system?: string; value?: string }) => i.system === 'clinic' && i.value !== clinicId)) &&
        resourceMatchesClinicTenant(resource, clinicId);
    },
  };
}

/**
 * Authorize an update/delete-by-id against the STORED ownership, never the
 * proposed patch. Task 422 rule: a foreign, untagged or mixed-clinic id is
 * indistinguishable from a missing one (NotFoundError => 404); a caller with no
 * clinic context fails closed (ForbiddenError => 403).
 */
export function assertResourceInClinic(
  resource: { identifier?: { system?: string; value?: string }[] },
  clinicId?: string
): void {
  const clinics = resource.identifier?.filter(identifier => identifier.system === 'clinic') ?? [];
  if (!clinicId) throw new ForbiddenError('Clinic context is required.');
  if (clinics.length === 0 || clinics.some(identifier => identifier.value !== clinicId)) {
    throw new NotFoundError('Resource not found.');
  }
}
