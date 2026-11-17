import type { MedplumClient } from '@medplum/core';
import { isSignedDocumentNote } from '@/lib/clinical-documents';
import { createProvenanceForResource } from './provenance-service';

/**
 * Audit trail for MC / referral documents (Task 408): one Provenance per
 * document Procedure. Non-blocking, like the Encounter provenance.
 */
export async function auditSignedDocument(
  medplum: MedplumClient,
  created: { id?: string } | undefined,
  proc: { notes?: string },
  practitionerId: string | undefined,
  organizationId: string | undefined,
  activity: 'CREATE' | 'UPDATE',
  clinicTenant: { accountReference: string } | null | undefined
): Promise<void> {
  if (!created?.id || !isSignedDocumentNote(proc.notes)) return;
  try {
    await createProvenanceForResource(
      medplum,
      'Procedure',
      created.id,
      practitionerId,
      organizationId,
      activity,
      clinicTenant ? [{ reference: clinicTenant.accountReference }] : undefined
    );
  } catch (error) {
    console.warn('Failed to create document Provenance (non-blocking):', error);
  }
}
