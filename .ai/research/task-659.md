# Task 659 — pilot console noise (A11)

## Sources
- MDN, AbortController / AbortError (fetch rejects with DOMException name `AbortError`): https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- Medplum WebSocket subscriptions (needs server-side config; unconfigured -> our route returns 503): https://www.medplum.com/docs/subscriptions/websocket-subscriptions
- Next.js 16 effects/cleanup are plain React 19 semantics; no Next API used.

## Findings and changes
1. `lib/poct/live-results.ts`: `connect()` ran after every successful 30 s poll, so a 503 was re-requested forever. Now a 503 sets `liveUnavailable`; polling of results continues; `refresh()` (manual) clears it. Server route unchanged (e2e `lab-results-state` mocks/expects 503; Task 476 "Live updates off" hint still works).
2. Billing: `GET /api/billing?consultationId=…&optional=true` returns 200 `{invoice:null, invoiceNumber:null}` when no bill exists; default (no param) still 404. Checkout uses it plus `lib/billing/invoice-lookup.ts` (never throws, 404/other -> null).
3. `components/patients/patient-documents.tsx`: fetch now has an AbortController, aborted on unmount/supersede; `isAbortError` (`lib/is-abort-error.ts`) and `signal.aborted` skip log/toast/state. Real errors still log and toast.

## Limits
Browsers print failed network requests themselves; that cannot be suppressed from JS. Only the first 503 remains (one line). Not changed: composer, sidebar.

## Verification
tsc clean; eslint on changed files clean; `bun test tests/unit`: 1032 pass, 2 fail — the same 2 fail on origin/dev without my changes (clinic-scoping void/delete test, generateSlots schedule test). New: `tests/unit/task659-console-noise.test.ts`.
