export const AUTH_REQUEST_TIMEOUT_MS = 15000;

function isRead(method: string | undefined): boolean {
  const m = (method ?? 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD';
}

/**
 * fetch that aborts after `timeoutMs` (rejects with an AbortError). Used for client
 * reads so a hung request ends in the existing error + Retry state instead of an
 * endless spinner.
 *
 * GET/HEAD: the timer covers headers AND the body. The returned Response streams the
 * body through a wrapper that keeps the AbortController armed until the body is fully
 * read (or errors/cancels), so `await res.json()` / `.text()` on a stalled body rejects
 * with an AbortError instead of hanging. Status, headers and `url` are preserved.
 *
 * Any other method (POST/PATCH/...): unchanged. The timer only guards the wait for
 * response headers and is cleared afterwards; the body is never wrapped. Do not use
 * this for writes you cannot safely retry: aborting does not cancel the server write.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = AUTH_REQUEST_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }

  if (!isRead(init.method) || !res.body) {
    clearTimeout(timeoutId);
    return res;
  }

  const reader = res.body.getReader();
  const abortError = () =>
    controller.signal.reason instanceof Error
      ? controller.signal.reason
      : new DOMException('The operation was aborted.', 'AbortError');
  let streamCtrl: ReadableStreamDefaultController<Uint8Array> | undefined;
  const timedBody = new ReadableStream<Uint8Array>({
    start(ctrl) {
      streamCtrl = ctrl;
    },
    async pull(ctrl) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          clearTimeout(timeoutId);
          ctrl.close();
        } else {
          ctrl.enqueue(value);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        ctrl.error(err);
      }
    },
    cancel(reason) {
      clearTimeout(timeoutId);
      return reader.cancel(reason);
    },
  });
  // Error the wrapper (so json()/text() reject with an AbortError) when the timer fires,
  // even if the source stream ignores the signal.
  controller.signal.addEventListener('abort', () => {
    try {
      streamCtrl?.error(abortError());
    } catch {
      /* already closed */
    }
    reader.cancel().catch(() => {});
  });

  const wrapped = new Response(timedBody, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
  Object.defineProperty(wrapped, 'url', { value: res.url });
  return wrapped;
}
