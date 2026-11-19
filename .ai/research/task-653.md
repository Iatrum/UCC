# Task 653 — GET body timeout in fetchWithTimeout

Gap from the Task 648 review: `fetchWithTimeout` cleared its timer when response headers arrived, so a GET whose body stalled in `res.json()` hung forever on slow internet.

References: MDN [AbortController](https://developer.mozilla.org/docs/Web/API/AbortController) / [fetch](https://developer.mozilla.org/docs/Web/API/Window/fetch) (aborting the signal also errors an in-flight body stream), [ReadableStream](https://developer.mozilla.org/docs/Web/API/ReadableStream), [Response constructor](https://developer.mozilla.org/docs/Web/API/Response/Response).

## Callers read (all GET, all read the body via `.json()`)
`lib/auth-medplum.tsx` (medplum-session, me), `dashboard/page.tsx` (appointments, billable), `checkout-client.tsx` (orders, billing, plan draft), `lib/inventory.ts` (`fetchMedicationsStrict`), `tests/unit/task480-dashboard-queue.test.ts`. No caller uses POST/PATCH.

## Design
Signature unchanged `(input, init, timeoutMs, fetchImpl)` → `Promise<Response>`, so no caller edits.
- GET/HEAD (method omitted or case-insensitive GET/HEAD): the body is re-streamed through a wrapper `ReadableStream`; the timer is cleared only when the stream completes, errors or is cancelled. On abort the wrapper is errored with the abort reason (AbortError), so `json()/text()` reject — callers' existing catch → error + Retry path runs. Status, statusText, headers and `url` are preserved. Not preserved: `redirected`/`type` (unused).
- Other methods: unchanged (timer guards only the header wait, cleared after; body untouched), so a write is never aborted mid-response.
- Responses with no body (204 etc.) are returned as is.
- Note: callers do `res.json().catch(() => ({}))`, so a body timeout there degrades to `{}` (then the `!ok`/missing-field checks decide), it does not hang. Strict callers (`fetchMedicationsStrict`) throw AbortError → `describeFetchError` timeout message.

## Tests
`tests/unit/task653-fetch-body-timeout.test.ts`: fake stalled body streams (stall mid-body and before first byte), intact body, timer cleared after read, header stall, POST/PATCH not aborted/wrapped, 204.
