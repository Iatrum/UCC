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

/**
 * Entries whose last save was rejected live only on screen. When a later write succeeds the server returns its own
 * plan, which does not contain them; publishing it verbatim would silently drop the doctor's item while the footer
 * still says "Failed to save". Keep the local version of every failed entry (add: re-append; edit: local wins).
 */
export function mergeUnsavedEntries<T extends { id: string }>(
  server: readonly T[],
  local: readonly T[],
  failedIds: ReadonlySet<string>,
): T[] {
  if (failedIds.size === 0) return [...server];
  const localById = new Map(local.map((entry) => [entry.id, entry] as const));
  const merged = server.map((entry) => (failedIds.has(entry.id) ? localById.get(entry.id) ?? entry : entry));
  const serverIds = new Set(server.map((entry) => entry.id));
  for (const entry of local) if (failedIds.has(entry.id) && !serverIds.has(entry.id)) merged.push(entry);
  return merged;
}
