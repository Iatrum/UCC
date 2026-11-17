# Review — Task 474 (PR #267, branch ai/task-400-update-containment)

Reviewed tip 93b4a03 (contains origin/dev 115a40d; merge-base check passes, 0 commits behind). Reviewer: Task 475.

## Verdict: APPROVE

## Checks
| Check | Result |
|---|---|
| Every BACKLOG-listed update/delete-by-id helper clinic-checked before write | PASS. `updatePatientDocument`, `deletePatientDocument`, `updateBillingExceptionTaskStatus`, `updateFollowUpStatus`, `markFollowUpOpened`, `sendFollowUpWithTwilio`, `deleteFollowUp`, `updateReferralInMedplum`, `deleteReferralFromMedplum` all read the stored resource (no-cache) and call `assertResourceInClinic` first, also when the caller omits `clinicId` (403 fail closed). Appointment helpers (Task 398) already use `readAppointmentForMutation` with a required `clinicId`. All callers (routes, `process-due`, `createFollowUp`) now pass the authorized `clinicId`. |
| 404 vs 403 follows Task 422 | PASS. Foreign/untagged/mixed id => `NotFoundError` (404); no caller clinic => `ForbiddenError` (403); routes `follow-up/[id]` and `tasks/[id]` switched from 403 to 404 for foreign ids. Foreign patient references stay 403 (create paths). |
| Documents DELETE | PASS. Ownership asserted before the irreversible Firebase Storage delete. Storage kept. |
| Merge kept dev behaviour | PASS. Contains origin/dev; diff vs dev touches only the 4 services, 3 routes, `write-containment.ts`, 1 test, `.ai` notes. Task 398 appointment code untouched. `sendFollowUpWithTwilio` now takes settings from the authorized clinic instead of the stored extension (intended hardening). |
| Tests fail without guards | PASS. Removed all `assertResourceInClinic` calls per service: billing 3 fail, communication 9 fail, documents 3 fail, referral 3 fail (26 tests total, all pass with guards). |
| Verification run | `tsc --noEmit` clean; `bun test tests/unit` 470 pass / 0 fail. No e2e / dev server run (unit-level review only). |
| No sidebar/nav/composer changes | PASS (no such paths in the diff). |
| No secrets/.env | PASS (no `.env*`, `e2e/.secrets` or credential-like additions). |
| Clinic data separate | PASS. Fail closed on missing/untagged/mixed clinic. |
| X-ray toggle / POCT | PASS. No imaging, lab or POCT files changed. |

## Findings
1. (fixed, small) `.ai/BACKLOG.md` Task 400 line still said foreign ids give 403; contradicted the Task 474 entry. Updated to 404/403 rule.
2. (non-blocking) The `/api/documents` DELETE "authorize before Storage delete" ordering and the route-level 404 mapping have no unit test; the service tests do not cover it. Suggest a route test with a mocked Storage.
3. (non-blocking, out of backlog scope) `updateLabOrder`/`deleteLabOrder` and `updateImagingOrder`/`deleteImagingOrder` rely on module gates plus the Medplum AccessPolicy, with no explicit `assertResourceInClinic`. Candidate follow-up; not touched here to avoid POCT/X-ray scope.
4. (non-blocking) Appointment helpers still return 403 for foreign ids (Task 398); aligning to 404 is already noted as a follow-up.
