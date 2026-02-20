#!/usr/bin/env bun
/**
 * Purge all patient and consultation data from Medplum.
 * Run: bun run scripts/purge-patients-and-consultations.ts
 */

import { readFileSync } from 'node:fs';
import { MedplumClient } from '@medplum/core';

function loadEnvFile(path: string) {
  try {
    const contents = readFileSync(path, 'utf8');
    const lines = contents.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // Ignore if .env.local does not exist
  }
}

loadEnvFile('.env.local');

const MEDPLUM_BASE_URL = process.env.MEDPLUM_BASE_URL || 'http://localhost:8103';
const MEDPLUM_CLIENT_ID = process.env.MEDPLUM_CLIENT_ID;
const MEDPLUM_CLIENT_SECRET = process.env.MEDPLUM_CLIENT_SECRET;

type ResourceRef = { resourceType: string; id?: string };

const MAX_RESULTS = 1000;

async function main() {
  if (!MEDPLUM_CLIENT_ID || !MEDPLUM_CLIENT_SECRET) {
    throw new Error('Missing MEDPLUM_CLIENT_ID or MEDPLUM_CLIENT_SECRET');
  }

  console.log(`Using Medplum base URL: ${MEDPLUM_BASE_URL}`);
  console.log(`Using Medplum client ID: ${MEDPLUM_CLIENT_ID.slice(0, 8)}...`);

  const medplum = new MedplumClient({
    baseUrl: MEDPLUM_BASE_URL,
    clientId: MEDPLUM_CLIENT_ID,
    clientSecret: MEDPLUM_CLIENT_SECRET,
  });

  await medplum.startClientLogin(MEDPLUM_CLIENT_ID, MEDPLUM_CLIENT_SECRET);

  const seen = new Set<string>();
  const deletedCounts: Record<string, number> = {};

  const markDeleted = (type: string) => {
    deletedCounts[type] = (deletedCounts[type] || 0) + 1;
  };

  const deleteResourceSafe = async (type: string, id?: string) => {
    if (!id) return;
    const key = `${type}/${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    try {
      await medplum.deleteResource(type, id);
      markDeleted(type);
    } catch (error: any) {
      console.warn(`⚠️  Failed to delete ${key}: ${error?.message || error}`);
    }
  };

  const deleteBySearch = async (type: string, searchParams: Record<string, any>) => {
    const resources = await medplum.searchResources<ResourceRef>(type, {
      _count: MAX_RESULTS,
      ...searchParams,
    });
    for (const resource of resources) {
      await deleteResourceSafe(type, resource.id);
    }
  };

  console.log('🔎 Fetching all patients...');
  const patients = await medplum.searchResources<ResourceRef>('Patient', { _count: MAX_RESULTS });
  console.log(`Found ${patients.length} patients`);

  for (const patient of patients) {
    if (!patient.id) continue;
    const patientRef = `Patient/${patient.id}`;

    // Patient-scoped resources
    await deleteBySearch('AllergyIntolerance', { patient: patientRef });
    await deleteBySearch('MedicationStatement', { subject: patientRef });
    await deleteBySearch('Condition', { subject: patientRef });
    await deleteBySearch('Observation', { subject: patientRef });
    await deleteBySearch('Procedure', { subject: patientRef });
    await deleteBySearch('MedicationRequest', { subject: patientRef });
    await deleteBySearch('ServiceRequest', { subject: patientRef });
    await deleteBySearch('DiagnosticReport', { subject: patientRef });
    await deleteBySearch('ImagingStudy', { subject: patientRef });
    await deleteBySearch('DocumentReference', { subject: patientRef });

    // Encounter-scoped resources
    const encounters = await medplum.searchResources<ResourceRef>('Encounter', {
      subject: patientRef,
      _count: MAX_RESULTS,
    });
    for (const encounter of encounters) {
      if (!encounter.id) continue;
      const encounterRef = `Encounter/${encounter.id}`;
      await deleteBySearch('Condition', { encounter: encounterRef });
      await deleteBySearch('Observation', { encounter: encounterRef });
      await deleteBySearch('Procedure', { encounter: encounterRef });
      await deleteBySearch('MedicationRequest', { encounter: encounterRef });
      await deleteBySearch('ServiceRequest', { encounter: encounterRef });
      await deleteResourceSafe('Encounter', encounter.id);
    }

    // Finally, delete the patient
    await deleteResourceSafe('Patient', patient.id);
  }

  const deletedSummary = Object.entries(deletedCounts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, count]) => `${type}: ${count}`)
    .join(', ');

  console.log('✅ Purge complete');
  console.log(deletedSummary || 'No resources deleted');
}

main().catch((error) => {
  console.error('❌ Purge failed:', error);
  process.exit(1);
});
