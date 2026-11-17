/**
 * Short-TTL, failure-free memo for per-access-token auth lookups (Task 547).
 *
 * Every page and API used to repeat GET /auth/me (twice), an Organization search and a
 * PractitionerRole search, serially. With the function far from Medplum each of those costs a
 * full round trip, so identical lookups for the same caller are now shared:
 *
 *  - keys are `sha256(accessToken)` + a caller-chosen scope, so two users (or two clinics)
 *    can never read each other's entry; the raw token is never stored;
 *  - the stored value is the in-flight promise, so parallel callers (layout + page + three
 *    dashboard APIs) collapse into one request;
 *  - rejected promises are evicted immediately: failures are never cached;
 *  - entries expire after `ttlMs` (default 10 s) and the map is size-bounded.
 */
import { createHash } from 'node:crypto';

export const AUTH_MEMO_TTL_MS = 10_000;
const MAX_ENTRIES = 500;

type Entry = { at: number; promise: Promise<unknown> };

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createAuthMemo(options: { ttlMs?: number; now?: () => number } = {}) {
  const ttlMs = options.ttlMs ?? AUTH_MEMO_TTL_MS;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();

  function sweep() {
    const t = now();
    for (const [key, entry] of entries) {
      if (t - entry.at >= ttlMs) entries.delete(key);
    }
    // Still too big (burst of distinct tokens): drop oldest first (Map keeps insertion order).
    while (entries.size >= MAX_ENTRIES) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  return {
    /** Return the memoised value for (token, scope) or run `load` once and share its promise. */
    get<T>(token: string, scope: string, load: () => Promise<T>): Promise<T> {
      const key = `${hashToken(token)}|${scope}`;
      const hit = entries.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.promise as Promise<T>;
      if (entries.size >= MAX_ENTRIES) sweep();
      let promise: Promise<T>;
      try {
        promise = load();
      } catch (error) {
        return Promise.reject(error);
      }
      const entry: Entry = { at: now(), promise };
      entries.set(key, entry);
      promise.catch(() => {
        if (entries.get(key) === entry) entries.delete(key);
      });
      return promise;
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

export const authMemo = createAuthMemo();
