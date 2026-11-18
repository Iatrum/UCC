# Task 573 — review of Task 572 (PR #311, f3bd6ab)

Verdict: **APPROVE**, no code changes needed.

- Unknown id: `readDeviceOrderOrNotFound` maps Medplum 404/410 to `NotFoundError("Order not found")`; route returns 404. Foreign/untagged clinic: `ForbiddenError` from the unchanged `assertOrderInDeviceClinic` is mapped to the same error and message, so the two are indistinguishable. Other read errors still propagate.
- Zero writes: the read+guard is the first statement in `receiveLabResults` / `receiveImagingStudy`; unit test asserts no create/update/batch for both cases and both services.
- Auth/clinic isolation: device-key auth is untouched; `assertOrderInDeviceClinic` is unchanged and still the only clinic decision; clinic comes from the authenticated Device. Other `assertOrderInDeviceClinic` callers (imaging report) are unchanged.
- No new POCT/imaging features; diff is 6 files (error mapping, helper, tests).
- Tests: `bun test tests/unit` 690 pass / 0 fail. `tsc --noEmit` clean. PR MERGEABLE vs dev.
- Note (non-blocking, pre-existing): `/api/{labs,imaging}/receive/message` read the order first in the bot and return 400 for an unknown id (no writes); not part of this task's scope.
