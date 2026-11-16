import type { MedplumClient } from "@medplum/core";
import { assertOrderClinic } from "@/lib/fhir/clinic-tenancy";

/**
 * Write-side clinic containment (Task 320). Medplum's AccessPolicy criteria do
 * not gate `create`, so every service that writes a resource referencing a
 * Patient must prove that Patient belongs to the caller's clinic first.
 * Throws a forbidden OperationOutcomeError (never reveals whether the id exists).
 * When `clinicId` is absent (admin-only callers) no assertion is made.
 */
export async function assertPatientInClinic(
  medplum: MedplumClient,
  clinicId: string | undefined | null,
  patientId: string | undefined | null,
  encounterId?: string
): Promise<void> {
  if (!clinicId) return;
  await assertOrderClinic(medplum, clinicId, patientId ?? "", encounterId);
}
