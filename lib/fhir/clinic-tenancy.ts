import type { MedplumClient } from "@medplum/core";
import type { Organization, Parameters, Patient, Reference } from "@medplum/fhirtypes";
import { getAdminMedplum } from "@/lib/server/medplum-admin";

export const CLINIC_IDENTIFIER_SYSTEM = "clinic";

export type ClinicTenant = {
  clinicId: string;
  organization: Organization;
  organizationId: string;
  organizationReference: string;
};

function referenceId(reference?: string): string | undefined {
  if (!reference) return undefined;
  const [resourceType, id] = reference.split("/");
  return resourceType === "Organization" && id ? id : undefined;
}

export function getClinicIdentifierValue(resource: { identifier?: { system?: string; value?: string }[] }): string | undefined {
  return resource.identifier?.find((identifier) => identifier.system === CLINIC_IDENTIFIER_SYSTEM)?.value;
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

export async function resolveClinicTenant(
  medplum: MedplumClient,
  clinicId: string | undefined | null
): Promise<ClinicTenant | null> {
  if (!clinicId) return null;

  let organization = await findClinicOrganization(medplum, clinicId);

  if (!organization?.id) {
    const directoryMedplum = await getAdminMedplum();
    organization = await findClinicOrganization(directoryMedplum, clinicId);
  }

  if (!organization?.id) {
    throw new Error(`Clinic Organization not found for clinic '${clinicId}'.`);
  }

  return {
    clinicId,
    organization,
    organizationId: organization.id,
    organizationReference: `Organization/${organization.id}`,
  };
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

  const orgReferences = [
    resource.managingOrganization?.reference,
    resource.serviceProvider?.reference,
    ...(Array.isArray(resource.meta?.account)
      ? resource.meta.account.map((ref) => ref.reference)
      : [resource.meta?.account?.reference]),
    ...(resource.meta?.accounts ?? []).map((ref) => ref.reference),
    ...(resource.meta?.compartment ?? []).map((ref) => ref.reference),
  ].filter((ref): ref is string => Boolean(ref));

  return orgReferences.some((ref) => referenceId(ref) === clinicId);
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
    [{ reference: tenant.organizationReference }]
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
    if (outcomeId === "forbidden" || message.toLowerCase().includes("forbidden")) {
      console.warn(
        `[clinic-tenancy] Skipping ${resourceType}/${resource.id} account assignment: $set-accounts is forbidden.`
      );
      return;
    }
    throw error;
  }
}
