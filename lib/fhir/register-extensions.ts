/**
 * Register StructureDefinitions on Startup
 * 
 * This module registers custom extensions in Medplum when the app starts.
 * Call this from your app initialization code.
 */

import { MedplumClient } from '@medplum/core';
import { registerStructureDefinitions } from './structure-definitions';

let registrationPromise: Promise<void> | undefined;

/**
 * Register all custom StructureDefinitions in Medplum
 * 
 * This should be called once during app startup.
 * It's safe to call multiple times - it checks if extensions are already registered.
 */
export async function initializeFhirExtensions(): Promise<void> {
  // Prevent multiple simultaneous registrations
  if (registrationPromise) {
    return registrationPromise;
  }

  registrationPromise = (async () => {
    try {
      const baseUrl = process.env.MEDPLUM_BASE_URL || process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL || 'http://localhost:8103';
      const clientId = process.env.MEDPLUM_CLIENT_ID;
      const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        console.warn('⚠️  Medplum credentials not configured. Skipping StructureDefinition registration.');
        return;
      }

      const medplum = new MedplumClient({
        baseUrl,
        clientId,
        clientSecret,
      });

      await medplum.startClientLogin(clientId, clientSecret);
      await registerStructureDefinitions(medplum);
      console.log('✅ All custom extensions registered in Medplum');
    } catch (error) {
      console.error('❌ Failed to register StructureDefinitions:', error);
      // Don't throw - allow app to continue even if registration fails
    }
  })();

  return registrationPromise;
}

