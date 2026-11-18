/**
 * Slow-network display rules for client fetches (Task 647).
 *
 * - A blocking spinner/error replaces the view only when there is nothing to show yet;
 *   once data exists it stays on screen while refetching or after a failed refresh.
 * - A failed refresh with data shows an inline banner (with Retry) instead.
 */
export type LoadView = "loading" | "error" | "content";

export function resolveLoadView(opts: { loading: boolean; error: string | null; hasData: boolean }): LoadView {
  if (opts.hasData) return "content";
  if (opts.loading) return "loading";
  if (opts.error) return "error";
  return "content";
}

/** True when stale data is shown and the latest refresh failed (render a small Retry banner). */
export function showStaleBanner(opts: { error: string | null; hasData: boolean }): boolean {
  return Boolean(opts.error) && opts.hasData;
}

/** Maps a thrown fetch failure to a user-facing message (timeout vs generic). */
export function describeFetchError(err: unknown, fallback: string): string {
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return "The request timed out. Check your connection and retry.";
  }
  if (err instanceof TypeError) return "Network error. Check your connection and retry.";
  return err instanceof Error && err.message ? err.message : fallback;
}
