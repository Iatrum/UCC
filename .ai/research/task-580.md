# Task 580: API correctness (UX-FINDINGS Part 1 #18 and #14)

Verified on `origin/dev` @ 620d0c8. Code reading plus a mocked-client unit test with fake data; no dev session or curl was used (no e2e secrets in this worktree).

## #18 `/api/consultations?recent=`
Already fixed in Task 476 (see `task-476.md`): `buildSavedConsultation` falls back to `Encounter.subject` for `patientId`, and the bulk child searches use `_count=1000` (FHIR default page size is 20, so later encounters lost their children). Re-read the current code: mapping is correct, clinic scoping unchanged (`identifier=clinic|<id>` search plus `matchesClinic`).
Remaining empty values are data: check-in-only encounters have no Chief Complaint Observation or Condition.
New `tests/unit/task580-recent-consultations.test.ts` pins `getRecentConsultationsFromMedplum` end to end: mapping, clinic-scoped search, other-clinic encounter dropped, `_count=1000` on child searches.

## #14 `/api/labs/subscription` 503
Not a server bug. The route returns 503 only from the inner catch around Subscription creation and `$get-ws-binding-token`, i.e. when the Medplum project lacks WebSocket subscription support or the socket service is unreachable. Auth, module-gate and patient/encounter-scope failures return 401/403/400 via `handleRouteError`. The Lab tab polls every 30 s and shows "Live updates off" (Task 476). Production returns 200 only if its Medplum project has the `websocket-subscriptions` feature enabled; that is project config, not code. No server change.
Docs: https://www.medplum.com/docs/subscriptions/websocket-subscriptions
