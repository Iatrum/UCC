#!/usr/bin/env bun
/**
 * Register FHIR StructureDefinitions
 * 
 * Registers custom extensions (storage-path, triage) in Medplum.
 * 
 * Usage:
 *   bun run scripts/register-fhir-extensions.ts
 * 
 * Or call the API endpoint:
 *   curl -X POST http://localhost:3000/api/fhir/register-extensions
 */

import { initializeFhirExtensions } from '../lib/fhir/register-extensions';

async function main() {
  console.log('📋 Registering FHIR StructureDefinitions...\n');
  
  try {
    await initializeFhirExtensions();
    console.log('\n✅ Successfully registered all StructureDefinitions!');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Failed to register StructureDefinitions:', error);
    process.exit(1);
  }
}

main();

