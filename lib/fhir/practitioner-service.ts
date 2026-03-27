/**
 * Practitioner Service - FHIR Practitioner Management
 * 
 * Manages healthcare practitioners in the FHIR system
 */

import { MedplumClient } from '@medplum/core';
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import type { Practitioner } from '@medplum/fhirtypes';

const getMedplumClient = getAdminMedplum;

/**
 * Get or create a practitioner by user ID
 */
export async function getOrCreatePractitioner(
    userId: string,
    name: string,
    qualification?: string
): Promise<string> {
    const medplum = await getMedplumClient();

    // Search for existing practitioner by user ID
    let practitioner = await medplum.searchOne('Practitioner', {
        identifier: `user|${userId}`,
    });

    if (!practitioner) {
        // Create new practitioner
        practitioner = await medplum.createResource<Practitioner>({
            resourceType: 'Practitioner',
            active: true,
            identifier: [
                {
                    system: 'user',
                    value: userId,
                    use: 'official'
                }
            ],
            name: [
                {
                    text: name,
                    use: 'official'
                }
            ],
            qualification: qualification ? [{
                code: {
                    text: qualification
                }
            }] : undefined,
        });

        console.log(`✅ Created Practitioner: ${practitioner.id}`);
    }

    return `Practitioner/${practitioner.id}`;
}

/**
 * Get practitioner by ID
 */
export async function getPractitionerById(practitionerId: string): Promise<Practitioner | null> {
    try {
        const medplum = await getMedplumClient();
        return await medplum.readResource('Practitioner', practitionerId);
    } catch (error) {
        console.error('Failed to get practitioner:', error);
        return null;
    }
}

/**
 * Get all practitioners
 */
export async function getAllPractitioners(): Promise<Practitioner[]> {
    try {
        const medplum = await getMedplumClient();
        return await medplum.searchResources('Practitioner', {
            active: 'true',
            _sort: 'name'
        });
    } catch (error) {
        console.error('Failed to get practitioners:', error);
        return [];
    }
}
