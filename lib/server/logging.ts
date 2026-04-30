import { getAdminMedplum } from '@/lib/server/medplum-admin';
import type { AuditEvent } from '@medplum/fhirtypes';

type AuditLog = {
  action: string;
  subjectType: 'patient' | 'consultation' | 'prescription' | 'inventory' | 'billing' | 'fhir' | string;
  subjectId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
};

export async function writeServerAuditLog(entry: AuditLog): Promise<void> {
  try {
    const medplum = await getAdminMedplum();

    const auditEvent: AuditEvent = {
      resourceType: 'AuditEvent',
      type: {
        system: 'http://terminology.hl7.org/CodeSystem/audit-event-type',
        code: 'rest',
        display: 'RESTful Operation',
      },
      subtype: [{ display: entry.action }],
      action: 'E',
      recorded: new Date().toISOString(),
      outcome: '0',
      agent: [
        {
          who: { display: entry.userId ?? 'system' },
          requestor: true,
        },
      ],
      source: {
        observer: { display: 'UCC EMR' },
      },
      entity: entry.subjectId
        ? [
            {
              what: { display: `${entry.subjectType}/${entry.subjectId}` },
              type: {
                system: 'http://terminology.hl7.org/CodeSystem/audit-entity-type',
                code: '2',
              },
              detail: entry.metadata
                ? Object.entries(entry.metadata).map(([type, value]) => ({
                    type,
                    valueString: String(value),
                  }))
                : undefined,
            },
          ]
        : undefined,
    };

    await medplum.createResource(auditEvent);
  } catch {
    // best-effort
  }
}
