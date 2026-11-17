export const AUTH_REQUEST_TIMEOUT_MS = 15000;

/**
 * fetch that aborts after `timeoutMs` (rejects with an AbortError). Used for the
 * dashboard auth requests so a hung /api/auth/* call ends in the existing error +
 * Retry state instead of an endless spinner.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = AUTH_REQUEST_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
