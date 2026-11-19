/** Task 659: true for fetch cancellations (unmount/navigation) so callers can skip logging them. */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}
