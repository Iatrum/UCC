/**
 * Provenance Service - FHIR Audit Trail
 *
 * Creates Provenance resources to track who created/updated clinical resources.
 * This provides an audit trail for compliance and accountability.
 */

import { MedplumClient, OperationOutcomeError, forbidden } from '@medplum/core';
import type { Provenance, Reference, ResourceType } from '@medplum/fhirtypes';
import { assignResourceToAccountReferences, getResourceAccountReferences } from './clinic-tenancy';
import { getAdminMedplum } from '@/lib/server/medplum-admin';

export interface ProvenanceData {
  target: Array<{ reference: string }>;
  recorded: string;
  agent: Array<{
    who?: { reference: string; display?: string };
    onBehalfOf?: { reference: string };
  }>;
  activity: {
    coding: Array<{
      system: string;
      code: string;
      display: string;
    }>;
  };
  // Clinic HealthcareService account(s) to stamp onto the created Provenance's
  // meta.accounts, so the UCC Clinic Staff Policy's _compartment=%clinicAccount
  // criteria can scope read/search of audit records to their own clinic.
  // Optional and non-fatal if omitted or if the caller has no clinic context --
  // never block the underlying resource's own creation over this.
  accounts?: Reference[];
}

/**
 * Create a Provenance resource to track resource creation/update
 */
export async function createProvenance(medplum: MedplumClient, data: ProvenanceData): Promise<string> {
  // Do not let the privileged writer become a confused deputy. Check every
  // target with the acting client, bypassing its cache, before obtaining admin.
  if (!data.target.length) throw new OperationOutcomeError(forbidden);
  const targetAccounts = new Map<string, Reference>();
  for (const target of data.target) {
    const match = /^([A-Z][A-Za-z]+)\/([A-Za-z0-9.-]+)$/.exec(target.reference);
    if (!match) throw new OperationOutcomeError(forbidden);
    const resource = await medplum.readResource(match[1] as ResourceType, match[2], {
      cache: 'no-cache', headers: { 'X-Medplum': 'extended' },
    });
    for (const account of getResourceAccountReferences(resource)) {
      if (account.reference) targetAccounts.set(account.reference, account);
    }
  }
  // Supplied accounts may never redirect an audit away from a stamped target.
  if (targetAccounts.size && data.accounts?.some(a => !a.reference || !targetAccounts.has(a.reference))) {
    throw new OperationOutcomeError(forbidden);
  }
  const accounts = [...targetAccounts.values()];
  const writer = await getAdminMedplum();
  const provenance: Provenance = {
    resourceType: 'Provenance',
    target: data.target,
    recorded: data.recorded,
    agent: data.agent.filter(agent => agent.who || agent.onBehalfOf).map(agent => ({
      who: agent.who!,
      onBehalfOf: agent.onBehalfOf,
    })),
    activity: data.activity,
  };

  const created = await writer.createResource<Provenance>(provenance);
  if (!created.id) {
    throw new Error('Failed to create Provenance (missing id)');
  }

  if (accounts.length) {
    try {
      await assignResourceToAccountReferences(writer, 'Provenance', created, accounts);
    } catch (error) {
      console.warn(`⚠️  Failed to stamp meta.accounts on Provenance/${created.id} (non-blocking):`, error);
    }
  }

  console.log(`✅ Created Provenance for ${data.target.length} resource(s)`);
  return created.id;
}

/**
 * Create Provenance for a single resource
 */
export async function createProvenanceForResource(
  medplum: MedplumClient,
  resourceType: string,
  resourceId: string,
  practitionerId?: string,
  organizationId?: string,
  activity: 'CREATE' | 'UPDATE' | 'DELETE' = 'CREATE',
  accounts?: Reference[]
): Promise<string> {
  return createProvenance(medplum, {
    target: [{ reference: `${resourceType}/${resourceId}` }],
    recorded: new Date().toISOString(),
    agent: [
      {
        who: practitionerId
          ? { reference: `Practitioner/${practitionerId}` }
          : undefined,
        onBehalfOf: organizationId
          ? { reference: `Organization/${organizationId}` }
          : undefined,
      },
    ].filter(agent => agent.who || agent.onBehalfOf),
    activity: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation',
          code: activity,
          display: activity.toLowerCase(),
        },
      ],
    },
    accounts,
  });
}

/**
 * Create Provenance for multiple resources (e.g., consultation bundle)
 */
export async function createProvenanceForResources(
  medplum: MedplumClient,
  resources: Array<{ resourceType: string; resourceId: string }>,
  practitionerId?: string,
  organizationId?: string,
  activity: 'CREATE' | 'UPDATE' | 'DELETE' = 'CREATE',
  accounts?: Reference[]
): Promise<string> {
  return createProvenance(medplum, {
    target: resources.map(r => ({ reference: `${r.resourceType}/${r.resourceId}` })),
    recorded: new Date().toISOString(),
    agent: [
      {
        who: practitionerId
          ? { reference: `Practitioner/${practitionerId}` }
          : undefined,
        onBehalfOf: organizationId
          ? { reference: `Organization/${organizationId}` }
          : undefined,
      },
    ].filter(agent => agent.who || agent.onBehalfOf),
    activity: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation',
          code: activity,
          display: activity.toLowerCase(),
        },
      ],
    },
    accounts,
  });
}
