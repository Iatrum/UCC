# Review — Task 482 (PR #267), Task 483

Reviewed head: 49b8d31. Verdict: **APPROVE** (one small finding fixed in this review, loop 1 of 2).

| Check | Result |
|---|---|
| Appointment 404/403 alignment | PASS. `readAppointmentForMutation`: empty clinic => 403; foreign/untagged/mixed id or account => 404 via `assertStoredResourceInClinic`; foreign stored patient => 403 via `assertPatientInClinic`. Extended read for `meta.accounts`. |
| Lab/imaging asserts before any write | PASS. `readOrderForMutation` runs before `assertPoctOrderMutable` / `assertXrayOrderMutable`, update and delete. Tests assert zero writes and unchanged store. |
| Documents DELETE ordering test real | PASS. Records read/write events; patient read precedes the first write and writes are exactly storage-delete then FHIR delete; foreign/mistagged/missing => 404 with zero writes. |
| Route 404 mapping tests real | PASS. Call the real route handlers (documents, appointments, labs/order) with only auth + Storage mocked. |
| Tests fail without the change (mutations) | PASS. Stored assert off: 65 fail; appointment patient check off: 9; order asserts off: 33; documents route assert off: 1 (+ new test below). |
| Sidebar/nav/composer changes | None in diff. |
| Secrets/.env | None (only env var names in an existing test). |
| Clinic separation | Strengthened; no cross-clinic reads added. |
| X-ray toggle | Intact; `assertXrayOrderMutable` still runs after the clinic read. |
| New POCT features | None. |
| Typecheck / unit suite | `tsc --noEmit` clean; `bun test tests/unit` 534 pass, 0 fail (after fix). |

## Finding fixed
Documents DELETE route used the identifier-only `assertResourceInClinic` on a non-extended read, so a document with an own clinic tag but a foreign `meta.accounts` entry passed the route check and the irreversible Storage delete ran before `deletePatientDocument`'s check failed. Fix: extended read plus `assertStoredResourceInClinic` before Storage delete; new test (fails without the fix).

## Notes
- PR was not in draft state when reviewed.
