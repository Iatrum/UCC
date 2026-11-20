# Task 704 — generic Imaging/Lab order wrote a COMPLETED billing Procedure at Sign

## Confirmed on origin/dev (b22d32e), fake data, dev Medplum :8113
Workflow spec 06 probe: `Imaging: Chest X-ray PA view (DX):completed` Procedure exists right after Sign, before any study exists.

## Cause
`patient-profile-workspace.tsx` builds the composer services catalogue with `Lab: …` / `Imaging: … (MOD)` names. Entries of kind `imaging` (generic, non-X-ray-toggle) are not routed to an order API; they flow into `procedures` and `lib/fhir/consultation-service.ts` (create at Sign, and replace-on-update) wrote every Procedure with `status: 'completed'`.

## Consistency with other paths
- POCT / X-ray (behind toggle) / kind `lab`: excluded from procedures in the composer; they create a `ServiceRequest` (`status: active`) via `/api/labs/order` and `/api/imaging/order`, completed only when the result/study arrives (`imaging-service.ts` sets ServiceRequest `completed` on report). Billing for lab/POCT/X-ray goes through the encounter investigation-billing extension, not Procedure status.
- So only the generic imaging billing Procedure claimed "completed" prematurely.

## FHIR R4 semantics
Procedure.status (event-status): preparation | in-progress | not-done | on-hold | stopped | completed | entered-in-error | unknown. `completed` = "The event has now concluded"; `preparation` = "The core event has not started yet, but some staging activities have begun". An order that is not yet performed is `preparation` (ServiceRequest holds the order intent). https://hl7.org/fhir/R4/procedure.html , https://hl7.org/fhir/R4/valueset-event-status.html

## Fix (small, server-side, no UI/workflow change)
`lib/fhir/order-procedure-status.ts`: names matching `/^\s*(Lab|Imaging):/i` -> `preparation`; all else `completed`. Used at both Procedure create sites in `consultation-service.ts`.
- Same prefix convention already used by `lib/analytics/aggregate.ts`.
- `performedDateTime` deliberately kept: it is the FHIR `date` search parameter used by analytics; dropping it would change analytics windows.
- Checkout totals unchanged: Procedure.status is never read for billing (lines come from code.text + price/quantity/category extensions). Verified: spec 09 checkout passes; completed items (consultation fee, dressing, MC, referral) stay `completed`.
- Not done (out of scope, option): closing the Procedure to `completed` when the imaging is performed. Generic imaging has no result pipeline, so there is no hook; would need a new "mark performed" UI -> reshapes the composer/workflow, so not implemented. Existing historical `completed` Imaging Procedures are left untouched (no migration).

## Verification
- `tsc -p tsconfig.lint.json` clean; `bun test tests/unit/task704*` 3 pass; full unit suite: only pre-existing `task639-scheduling-slots` failure (also fails on base; PR #338 touches it).
- Production build (`next build --webpack`, Node 22), served on :3714; workflow spec 11/11 pass, Procedure statuses after Sign: Consultation Fee/Wound dressing/MC/Referral `completed`, Imaging `preparation`.
- Note: on origin/dev alone spec 07 fails with "invalid device API key" (stale POCT device fixture); PR #334 (Task 674) fixes it and owns those e2e files. I ran with #334's e2e files overlaid temporarily and did not commit them.
