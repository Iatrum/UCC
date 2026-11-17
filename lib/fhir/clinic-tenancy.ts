import { OperationOutcomeError, forbidden, isNotFound, isGone } from "@medplum/core";
import type { HealthcareService, Organization, Parameters, Patient, Reference } from "@medplum/fhirtypes";
import type { MedplumClient } from "@medplum/core";
import { getAdminMedplum } from "@/lib/server/medplum-admin";
import { ForbiddenError } from "@/lib/server/route-helpers";

export const CLINIC_IDENTIFIER_SYSTEM = "clinic";

export type ClinicTenant = {
  clinicId: string;
  organization: Organization;
  organizationId: string;
  organizationReference: string;
  account: HealthcareService;
  accountId: string;
  accountReference: string;
};

function parseReference(reference?: string): { resourceType: string; id: string } | undefined {
  if (!reference) return undefined;
  const [resourceType, id] = reference.split("/");
  return resourceType && id ? { resourceType, id } : undefined;
}

export function getClinicIdentifierValue(resource: { identifier?: { system?: string; value?: string }[] }): string | undefined {
  return resource.identifier?.find((identifier) => identifier.system === CLINIC_IDENTIFIER_SYSTEM)?.value;
}

export function withClinicIdentifier<T extends { identifier?: { system?: string; value?: string }[] }>(
  resource: T,
  clinicId?: string | null
): T {
  if (!clinicId) return resource;

  const identifiers = resource.identifier ?? [];
  const hasClinicIdentifier = identifiers.some(
    (identifier) =>
      identifier.system === CLINIC_IDENTIFIER_SYSTEM &&
      identifier.value === clinicId
  );

  if (hasClinicIdentifier) return resource;

  return {
    ...resource,
    identifier: [
      ...identifiers.filter(
        (identifier) => identifier.system !== CLINIC_IDENTIFIER_SYSTEM
      ),
      { system: CLINIC_IDENTIFIER_SYSTEM, value: clinicId },
    ],
  };
}

async function findClinicOrganization(
  medplum: MedplumClient,
  clinicId: string
): Promise<Organization | undefined> {
  try {
    const direct = await medplum.readResource("Organization", clinicId);
    if (direct.id) {
      return direct;
    }
  } catch {
    // The clinic id is usually the subdomain slug, not an Organization id.
  }

  return await medplum.searchOne("Organization", {
    identifier: `${CLINIC_IDENTIFIER_SYSTEM}|${clinicId}`,
    _count: "1",
  }) as Organization | undefined;
}

async function findClinicAccount(
  medplum: MedplumClient,
  clinicId: string
): Promise<HealthcareService | undefined> {
  const existing = await medplum.searchOne("HealthcareService", {
    identifier: `${CLINIC_IDENTIFIER_SYSTEM}|${clinicId}`,
    _count: "1",
  }) as HealthcareService | undefined;
  if (existing?.id) {
    return existing;
  }

  const directoryMedplum = await getAdminMedplum();
  return await directoryMedplum.searchOne("HealthcareService", {
    identifier: `${CLINIC_IDENTIFIER_SYSTEM}|${clinicId}`,
    _count: "1",
  }) as HealthcareService | undefined;
}

export async function resolveClinicTenant(
  medplum: MedplumClient,
  clinicId: string | undefined | null
): Promise<ClinicTenant | null> {
  if (!clinicId) return null;

  // Organization and account lookups are independent: start both together (Task 537) but keep
  // the original error precedence (a missing/failed Organization is reported first).
  const accountSettled = findClinicAccount(medplum, clinicId).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  let organization = await findClinicOrganization(medplum, clinicId);

  if (!organization?.id) {
    const directoryMedplum = await getAdminMedplum();
    organization = await findClinicOrganization(directoryMedplum, clinicId);
  }

  if (!organization?.id) {
    throw new Error(`Clinic Organization not found for clinic '${clinicId}'.`);
  }

  const accountResult = await accountSettled;
  if (!accountResult.ok) throw accountResult.error;
  const account = accountResult.value;
  if (!account?.id) {
    throw new Error(`Clinic account HealthcareService not found for clinic '${clinicId}'.`);
  }

  return {
    clinicId,
    organization,
    organizationId: organization.id,
    organizationReference: `Organization/${organization.id}`,
    account,
    accountId: account.id,
    accountReference: `HealthcareService/${account.id}`,
  };
}

const TENANT_MEMO_TTL_MS = 5000;
const tenantMemo = new WeakMap<MedplumClient, Map<string, { at: number; promise: Promise<ClinicTenant | null> }>>();

/**
 * resolveClinicTenant with a short per-client memo (Task 537). A patient page resolves the same
 * tenant from several services (patient, triage); this collapses them into one set of lookups.
 * The memo is keyed by client instance (request-scoped for staff clients), expires after 5 s so
 * a long-lived admin client never serves a stale tenant, and failures are never cached.
 */
export function resolveClinicTenantMemo(
  medplum: MedplumClient,
  clinicId: string | undefined | null
): Promise<ClinicTenant | null> {
  if (!clinicId) return Promise.resolve(null);
  let perClient = tenantMemo.get(medplum);
  if (!perClient) {
    perClient = new Map();
    tenantMemo.set(medplum, perClient);
  }
  const hit = perClient.get(clinicId);
  if (hit && Date.now() - hit.at < TENANT_MEMO_TTL_MS) return hit.promise;
  const promise = resolveClinicTenant(medplum, clinicId);
  const entry = { at: Date.now(), promise };
  perClient.set(clinicId, entry);
  promise.catch(() => {
    if (perClient!.get(clinicId) === entry) perClient!.delete(clinicId);
  });
  return promise;
}

export function resourceMatchesClinicTenant(
  resource: {
    identifier?: { system?: string; value?: string }[];
    managingOrganization?: { reference?: string };
    serviceProvider?: { reference?: string };
    meta?: {
      account?: Reference | Reference[];
      accounts?: Reference[];
      compartment?: Reference[];
    };
  },
  clinicId?: string | null
): boolean {
  if (clinicId === null) return true;
  if (!clinicId) return true;

  if (
    resource.identifier?.some(
      (identifier) =>
        identifier.system === CLINIC_IDENTIFIER_SYSTEM &&
        identifier.value === clinicId
    )
  ) {
    return true;
  }

  const orgReferences = [
    resource.managingOrganization?.reference,
    resource.serviceProvider?.reference,
    ...(Array.isArray(resource.meta?.account)
      ? resource.meta.account.map((ref) => ref.reference)
      : [resource.meta?.account?.reference]),
    ...(resource.meta?.accounts ?? []).map((ref) => ref.reference),
    ...(resource.meta?.compartment ?? []).map((ref) => ref.reference),
  ].filter((ref): ref is string => Boolean(ref));

  return orgReferences.some((ref) => parseReference(ref)?.id === clinicId);
}

export async function assignPatientToClinicTenant(
  medplum: MedplumClient,
  patient: Patient,
  tenant: ClinicTenant | null
): Promise<void> {
  await assignResourceToClinicTenant(medplum, "Patient", patient, tenant);
}

export async function assignResourceToClinicTenant(
  medplum: MedplumClient,
  resourceType: string,
  resource: { id?: string; meta?: Patient["meta"] },
  tenant: ClinicTenant | null
): Promise<void> {
  if (!tenant || !resource.id) return;
  await assignResourceToAccountReferences(
    medplum,
    resourceType,
    resource,
    [{ reference: tenant.accountReference }]
  );
}

export function getResourceAccountReferences(resource: { meta?: Patient["meta"] }): Reference[] {
  return [
    ...(((resource.meta as any)?.accounts ?? []) as Reference[]),
    ...(((resource.meta as any)?.account
      ? Array.isArray((resource.meta as any).account)
        ? (resource.meta as any).account
        : [(resource.meta as any).account]
      : []) as Reference[]),
  ];
}

export async function assignResourceToAccountReferences(
  medplum: MedplumClient,
  resourceType: string,
  resource: { id?: string; meta?: Patient["meta"] },
  accounts: Reference[]
): Promise<void> {
  if (!resource.id || accounts.length === 0) return;

  const accountRefs = new Map<string, Reference>();
  for (const account of [...getResourceAccountReferences(resource), ...accounts]) {
    if (account.reference) accountRefs.set(account.reference, account);
  }

  const parameters: Parameters = {
    resourceType: "Parameters",
    parameter: [
      ...Array.from(accountRefs.values()).map((account) => ({
        name: "accounts",
        valueReference: { reference: account.reference },
      })),
      { name: "propagate", valueBoolean: true },
    ],
  };

  try {
    await medplum.post(`fhir/R4/${resourceType}/${resource.id}/$set-accounts`, parameters);
  } catch (error) {
    const outcomeId = (error as any)?.outcome?.id;
    const message = error instanceof Error ? error.message : String(error);
    if (outcomeId !== "forbidden" && !message.toLowerCase().includes("forbidden")) {
      throw error;
    }

    const adminMedplum = await getAdminMedplum();
    await adminMedplum.post(`fhir/R4/${resourceType}/${resource.id}/$set-accounts`, parameters);
  }
}

/** Authorize an order's patient and visit before creating any resources. */
export async function assertOrderClinic(
  medplum: MedplumClient,
  clinicId: string,
  patientId: string,
  encounterId?: string
): Promise<void> {
  if (!clinicId || !/^[A-Za-z0-9.-]+$/.test(patientId) ||
      (encounterId && !/^[A-Za-z0-9.-]+$/.test(encounterId))) {
    throw new OperationOutcomeError(forbidden);
  }
  const tenant = await resolveClinicTenant(medplum, clinicId);
  const options = { cache: 'no-cache' as const, headers: { 'X-Medplum': 'extended' } };
  const belongs = (resource: { identifier?: Patient["identifier"]; meta?: Patient["meta"] }) => {
    const accounts = getResourceAccountReferences(resource);
    return accounts.length
      ? accounts.every(account => account.reference === tenant?.accountReference)
      : resourceMatchesClinicTenant(resource, clinicId);
  };
  const read = async (type: 'Patient' | 'Encounter', id: string) => {
    try { return await medplum.readResource(type, id, options); }
    catch (error) {
      if (error instanceof OperationOutcomeError &&
          (isNotFound(error.outcome) || isGone(error.outcome) || error.outcome.id === 'forbidden')) {
        throw new OperationOutcomeError(forbidden);
      }
      throw error;
    }
  };
  const patient = await read('Patient', patientId);
  if (!belongs(patient)) throw new OperationOutcomeError(forbidden);
  if (encounterId) {
    const encounter = await read('Encounter', encounterId) as import('@medplum/fhirtypes').Encounter;
    if (!belongs(encounter) || encounter.subject?.reference !== `Patient/${patientId}`) {
      throw new OperationOutcomeError(forbidden);
    }
  }
}

/**
 * Device ingress guard: the order must belong to the authenticated device's clinic. Checks the clinic
 * identifier and, when the order carries `meta.accounts` (read with `X-Medplum: extended`), that every
 * account is the device clinic's tenant account. The device's clinic comes from the authenticated Device.
 */
export async function assertOrderInDeviceClinic(
  medplum: MedplumClient,
  serviceRequest: { identifier?: { system?: string; value?: string }[]; meta?: Patient["meta"] },
  deviceClinicId: string
): Promise<void> {
  const orderClinic = getClinicIdentifierValue(serviceRequest);
  if (!deviceClinicId || !orderClinic) throw new ForbiddenError("Order has no clinic identifier");
  if (orderClinic !== deviceClinicId) throw new ForbiddenError("Order does not belong to this device's clinic");
  const accounts = getResourceAccountReferences(serviceRequest);
  if (accounts.length) {
    const tenant = await resolveClinicTenant(medplum, deviceClinicId);
    if (!tenant || !accounts.every((account) => account.reference === tenant.accountReference)) {
      throw new ForbiddenError("Order does not belong to this device's clinic");
    }
  }
}
