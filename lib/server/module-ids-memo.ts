import { createAuthMemo } from '@/lib/server/auth-memo';

/**
 * Per-clinic enabled-module lookup memo (Task 547). One page load asks "which modules are on?" from
 * the root layout (nav + feedback flag), the module layout and the module page: three identical
 * admin Organization searches. They now share one in-flight/short-lived result.
 *
 * - TTL is 5 s, keyed by clinic id only (the value is the clinic's own Organization settings),
 * - failures are never cached (the caller's default-on-error fallback is applied outside),
 * - `invalidateModuleIdsMemo` is called when a clinic's modules are changed in this process.
 * The strict variant used by safety guards (accession/PACS) deliberately bypasses this memo.
 */
const memo = createAuthMemo({ ttlMs: 5_000 });

export function memoizedModuleIds(clinicId: string, load: () => Promise<string[]>): Promise<string[]> {
  return memo.get(clinicId, 'modules', load);
}

export function invalidateModuleIdsMemo(): void {
  memo.clear();
}
