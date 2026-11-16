/**
 * How the composer interprets a /api/consultations/plan response.
 * Only an explicit `persistenceAvailable: false` from the server means "local-only".
 * Any other non-success (401/403/409/500, malformed body, network error) is a REJECTED save and must never be
 * presented as saved. Error text is deliberately not sniffed: the draft store is Medplum, not Firebase/ADC.
 */
export type PlanWriteOutcome = 'saved' | 'local-only' | 'failed';

export function planWriteOutcome(httpOk: boolean, data: unknown): PlanWriteOutcome {
  const body = (data && typeof data === 'object' ? data : {}) as { success?: unknown; persistenceAvailable?: unknown };
  if (body.persistenceAvailable === false) return 'local-only';
  return httpOk && body.success === true ? 'saved' : 'failed';
}
