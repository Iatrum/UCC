# Review of Task 458 (PR #279, branch ai/task-458)

Verdict: **APPROVE**

## Checked
- **Clinic scoping:** `GET /api/orders` looks up the consultation with `getConsultationFromMedplum(id, clinicId)`, which returns null for a foreign clinic. Foreign, missing and mismatched ids all return the same 404, so nothing leaks about other clinics. The patient is read with the clinic-scoped `getPatientFromMedplum`. A supplied `patientId` must match the consultation's patient. `POST /api/billing` is unchanged and still calls `assertPatientInClinic(clinicId, patientId, consultationId)`.
- **Empty bills / e-Invoice:** the repo has no e-Invoice submission (the button is a stub), so the guard is the disabled button plus a server-side `hasBillableItems` check in `/api/billing`. That check rejects an empty list, RM 0 totals and NaN with a 400, and no invoice is created. "Complete visitation" is also disabled for non-billable carts.
- **Tests:** `tests/unit/task458-checkout.test.ts` has 10 tests covering clinic isolation, patientId mismatch, a missing consultationId, RM 0 and empty bills, and the happy path. Full unit suite: 454 pass, 0 fail. `tsc` is clean for the touched files. CI `lint-and-build` and the live-routes check passed.
- **Scope:** the diff touches only checkout-client, `/api/orders`, `/api/billing`, `lib/billing/checkout-guards.ts`, tests and `.ai` notes. There are no sidebar/nav, composer, X-ray/imaging, or lab/POCT changes, so the X-ray toggle is untouched. No secrets, `.env` or `e2e/.secrets` files, and the diff contains only fake data.

## Non-blocking notes (no change made)
- The server does not recompute `totalAmount` from the items. The client sends it, and that was already the case before this PR.
- Legacy encounters with no `firebase-patient` identifier now return 404 instead of "Missing reference". The research notes document this.
