# Task 520 — Review of PR #293 (Task 519 checkout follow-ups)

**Verdict: APPROVE** (no code changes needed). Branch `claude/task-519-checkout-followups`, base `dev`, MERGEABLE, already contains `origin/dev`.

## Scope reviewed
Diff vs `origin/dev`: `checkout-client.tsx`, `lib/billing/checkout-guards.ts`, `tests/unit/task519-checkout.test.ts`, research note. No server/billing/stock files changed.

## Findings
- **Clinic scoping of consultation -> patient lookup (OK).** `GET /api/orders` uses `requireClinicAuth` (always returns a non-empty clinicId; throws otherwise), then `getConsultationFromMedplum(id, clinicId)`, which returns null for a foreign clinic's Encounter. That gives 404 `Not found`, with no patient or consultation data in the body. Patient id is then derived with `resolveCheckoutPatientId`; a mismatching `patientId` is also 404, and `getPatientFromMedplum` is clinic-scoped too. `POST /api/billing` still runs `assertCheckoutConsultationPatient` before any write (Task 504). Covered by `task458-checkout.test.ts` (foreign consultation, foreign patient, mismatch, unknown id).
- **Stable invoice number (OK).** The client no longer requests `previewNumber=true`, so no per-load number generation. It shows "Assigned on completion" until a saved invoice supplies a number. POST sends `invoiceNumber: undefined` when empty; the server's `resolveInvoiceNumber` reuses a stored number, else generates one. Number uniqueness/assignment is unchanged. Print/preview/title use the same helper.
- **Stock auto-deduct unchanged (OK).** No change under `lib/fhir/*` or `app/api/billing`; dispense tests pass.
- **Empty checkout / e-Invoice button.** Verified already on dev (Tasks 458/504); not touched by this PR.
- Minor, not blocking: the server's `previewNumber` query branch is now unused by the UI; harmless, left in place.

## Checks run (worktree, fake data only, no dev server started)
- `bun test` task458 + task504 + task519: 23 pass, 0 fail
- `bun test` dispense-service + dispense-consistency: 30 pass, 0 fail
- `tsc --noEmit`: clean; eslint on changed files: clean
- Not run: full `check-all.sh` (build + Playwright) — UI text-only change on a RAM-shared host; no browser verification done.
