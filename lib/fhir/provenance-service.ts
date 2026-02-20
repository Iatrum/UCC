/**
 * Provenance Service - FHIR Audit Trail
 * 
 * Creates Provenance resources to track who created/updated clinical resources.
 * This provides an audit trail for compliance and accountability.
 */

import { MedplumClient } from '@medplum/core';
import type { Provenance } from '@medplum/fhirtypes';

let medplumClient: MedplumClient | undefined;
let medplumInitPromise: Promise<MedplumClient> | undefined;

async function getMedplumClient(): Promise<MedplumClient> {
  if (medplumClient) return medplumClient;
  if (medplumInitPromise) return medplumInitPromise;

  const baseUrl = process.env.MEDPLUM_BASE_URL || process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL || 'http://localhost:8103';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Medplum credentials not configured');
  }

  medplumInitPromise = (async () => {
    const medplum = new MedplumClient({ baseUrl, clientId, clientSecret });
    await medplum.startClientLogin(clientId, clientSecret);
    medplumClient = medplum;
    return medplum;
  })();

  return medplumInitPromise;
}

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
}

/**
 * Create a Provenance resource to track resource creation/update
 */
export async function createProvenance(data: ProvenanceData): Promise<string> {
  const medplum = await getMedplumClient();

  const filteredAgents = data.agent
    .filter(agent => agent.who || agent.onBehalfOf)
    .map(agent => ({
      who: agent.who,
      onBehalfOf: agent.onBehalfOf,
    }));

  if (filteredAgents.length === 0) {
    filteredAgents.push({
      who: { display: 'System (automated)' },
    });
  }

  const provenance: Provenance = {
    resourceType: 'Provenance',
    target: data.target,
    recorded: data.recorded,
    agent: filteredAgents,
    activity: data.activity,
  };

  const created = await medplum.createResource<Provenance>(provenance);
  if (!created.id) {
    throw new Error('Failed to create Provenance (missing id)');
  }

  console.log(`✅ Created Provenance for ${data.target.length} resource(s)`);
  return created.id;
}

/**
 * Create Provenance for a single resource
 */
export async function createProvenanceForResource(
  resourceType: string,
  resourceId: string,
  practitionerId?: string,
  organizationId?: string,
  activity: 'CREATE' | 'UPDATE' | 'DELETE' = 'CREATE'
): Promise<string> {
  return createProvenance({
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
    ].filter(agent => agent.who || agent.onBehalfOf), // Filter out empty agents
    activity: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation',
          code: activity,
          display: activity.toLowerCase(),
        },
      ],
    },
  });
}

/**
 * Create Provenance for multiple resources (e.g., consultation bundle)
 */
export async function createProvenanceForResources(
  resources: Array<{ resourceType: string; resourceId: string }>,
  practitionerId?: string,
  organizationId?: string,
  activity: 'CREATE' | 'UPDATE' | 'DELETE' = 'CREATE'
): Promise<string> {
  return createProvenance({
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
  });
}

