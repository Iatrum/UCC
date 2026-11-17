import type { Patient } from '@/lib/models';

export const QUEUE_TIMEOUT_MS = 10000;

export type QueueLoadResult =
  | { ok: true; patients: Patient[] }
  | { ok: false; kind: 'timeout' | 'unauthorized' | 'http' | 'network'; message: string }
  | { ok: false; kind: 'aborted'; message: '' };

/**
 * One queue fetch with a timeout. Never throws: callers get a typed result so a
 * failure always becomes an error state (with Retry) rather than a stuck spinner.
 * `aborted` means the caller cancelled (unmount/superseded/navigation) and must be ignored.
 */
export async function loadQueueOnce(
  fetchImpl: typeof fetch,
  controller: AbortController,
  timeoutMs: number = QUEUE_TIMEOUT_MS
): Promise<QueueLoadResult> {
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl('/api/queue', { signal: controller.signal });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, kind: 'unauthorized', message: 'Your session is not ready yet. Retry in a moment.' };
    }
    if (!response.ok) {
      return { ok: false, kind: 'http', message: 'Failed to load queue data.' };
    }
    const result = await response.json();
    if (controller.signal.aborted) return { ok: false, kind: 'aborted', message: '' };
    return { ok: true, patients: result.patients || [] };
  } catch {
    if (timedOut) return { ok: false, kind: 'timeout', message: 'Queue is taking too long to load.' };
    if (controller.signal.aborted) return { ok: false, kind: 'aborted', message: '' };
    return { ok: false, kind: 'network', message: 'Failed to load queue data.' };
  } finally {
    clearTimeout(timeoutId);
  }
}
