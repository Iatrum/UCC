/**
 * FHIR Helper Functions
 * 
 * Common utilities for creating FHIR resources with validation and Provenance.
 * Use these helpers to ensure all resources are validated and audited.
 */

import { MedplumClient } from '@medplum/core';
import type { Reference, ServiceRequest } from '@medplum/fhirtypes';
import { validateFhirResource, logValidation } from './validation';
import { applyMyCoreProfile } from './mycore';
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import { createProvenanceForResource } from './provenance-service';

/**
 * Validate and create a FHIR resource with automatic Provenance tracking
 * 
 * This is the recommended way to create any FHIR resource to ensure:
 * - Validation before creation
 * - Automatic audit trail (Provenance)
 * - Consistent error handling
 */
export async function validateAndCreateWithProvenance<T extends { resourceType: string }>(
  medplum: MedplumClient,
  resource: T,
  practitionerId?: string,
  organizationId?: string,
  accounts?: Reference[]
): Promise<T & { id: string }> {
  const profiledResource = applyMyCoreProfile(resource as any) as T;

  // Validate first
  const validation = validateFhirResource(profiledResource);
  logValidation(resource.resourceType, validation);
  
  if (!validation.valid) {
    throw new Error(`Invalid ${resource.resourceType}: ${validation.errors.join(', ')}`);
  }

  // Create resource
  const created = await medplum.createResource(profiledResource as any) as T & { id: string };
  
  if (!created.id) {
    throw new Error(`Failed to create ${resource.resourceType} (missing id)`);
  }

  // Create Provenance for audit trail (non-blocking)
  try {
    await createProvenanceForResource(
      medplum,
      resource.resourceType,
      created.id,
      practitionerId,
      organizationId,
      'CREATE',
      accounts
    );
    console.log(`✅ Created Provenance for ${resource.resourceType}/${created.id}`);
  } catch (error) {
    console.warn(`⚠️  Failed to create Provenance for ${resource.resourceType} (non-blocking):`, error);
  }

  return created;
}

/**
 * Validate a FHIR resource before creating
 * 
 * Use this if you want to validate but handle Provenance separately
 */
export async function validateAndCreate<T extends { resourceType: string }>(
  medplum: MedplumClient,
  resource: T
): Promise<T & { id: string }> {
  const profiledResource = applyMyCoreProfile(resource as any) as T;
  const validation = validateFhirResource(profiledResource);
  logValidation(resource.resourceType, validation);
  
  if (!validation.valid) {
    throw new Error(`Invalid ${resource.resourceType}: ${validation.errors.join(', ')}`);
  }

  const created = await medplum.createResource(profiledResource as any) as T & { id: string };
  
  if (!created.id) {
    throw new Error(`Failed to create ${resource.resourceType} (missing id)`);
  }

  return created;
}

/**
 * Create Provenance for a resource after creation
 * 
 * Use this if you created a resource without Provenance and want to add it
 */
export async function addProvenanceToResource(
  medplum: MedplumClient,
  resourceType: string,
  resourceId: string,
  practitionerId?: string,
  organizationId?: string,
  activity: 'CREATE' | 'UPDATE' | 'DELETE' = 'CREATE',
  accounts?: Reference[]
): Promise<void> {
  try {
    await createProvenanceForResource(
      medplum,
      resourceType,
      resourceId,
      practitionerId,
      organizationId,
      activity,
      accounts
    );
    console.log(`✅ Created Provenance for ${resourceType}/${resourceId}`);
  } catch (error) {
    console.warn(`⚠️  Failed to create Provenance (non-blocking):`, error);
    // Don't throw - Provenance is important but shouldn't block operations
  }
}


/**
 * Orders carry app-generated routing tags (POCT/X-ray) and MY Core profiles.
 * The clinic policy strips incoming meta to prevent privileged-project account
 * spoofing. Restore only these app-controlled fields AFTER an authorized staff
 * create; retain the server-computed accounts and all clinical fields unchanged.
 * Call only with an order constructed by the server, never a raw request body.
 */
export async function validateAndCreateClinicOrder(
  medplum: MedplumClient,
  resource: ServiceRequest,
  conditionalQuery?: string
): Promise<ServiceRequest & { id: string }> {
  const requested = applyMyCoreProfile(resource);
  const created = conditionalQuery
    ? await medplum.createResourceIfNoneExist(requested, conditionalQuery)
    : await validateAndCreate(medplum, resource);
  const metadata = requested.meta;
  if (JSON.stringify(created.meta?.profile) === JSON.stringify(metadata?.profile) &&
      JSON.stringify(created.meta?.tag) === JSON.stringify(metadata?.tag)) return created;

  // A successful create is required before any privileged metadata repair.
  // Re-read with the acting client to ensure it can still access this order.
  const current = await medplum.readResource('ServiceRequest', created.id, {
    cache: 'no-cache', headers: { 'X-Medplum': 'extended' },
  });
  if (!current.meta?.versionId) throw new Error('Order metadata repair requires a resource version');
  const admin = await getAdminMedplum();
  const stored = await admin.readResource('ServiceRequest', created.id, {
    cache: 'no-cache', headers: { 'X-Medplum': 'extended' },
  });
  return await admin.updateResource({
    ...stored,
    meta: { ...stored.meta, profile: metadata?.profile, tag: metadata?.tag },
  }, { headers: { 'X-Medplum': 'extended', 'If-Match': `W/"${current.meta.versionId}"` } }) as ServiceRequest & { id: string };
}
