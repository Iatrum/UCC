type AuditLog = {
  action: string;
  subjectType: 'patient' | 'consultation' | 'prescription' | 'inventory' | 'billing' | 'fhir' | string;
  subjectId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
};

export async function writeAuditLog(entry: AuditLog): Promise<void> {
  try {
    await fetch('/api/audit-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
      credentials: 'include',
    });
  } catch {
    // best-effort; do not block main flow
    console.warn('Failed to write audit log');
  }
}
