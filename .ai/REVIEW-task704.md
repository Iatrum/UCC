# Review — Task 704 (PR #342): Lab/Imaging billing Procedure `preparation` at Sign

Verdict: **approve, no code changes needed.**

## Checked
- Cause (base): both Procedure create sites in `lib/fhir/consultation-service.ts` hard-coded `status: 'completed'`; generic `Imaging:`/`Lab:` composer lines flow into `procedures` (kind `lab`/`poct`/`xray` are excluded in `patient-profile-workspace.tsx`, they create ServiceRequests). Confirmed from the base source literal and the spec 06 probe.
- Fix: `orderProcedureStatus` -> `preparation` for `/^\s*(Lab|Imaging):/i`, else `completed`; used at create and replace-on-update. Valid R4 event-status code.
- No reader filters on Procedure.status (grep over lib/app/components): consultation-service reads search by encounter only; analytics uses `date`; checkout builds lines from code.text + extensions.
- Production build (webpack, Node 22), port 3714, fake data, dev Medplum :8113, #334 e2e fixtures overlaid temporarily (not committed):
  - workflow.spec 11/11: after Sign, Consultation Fee `completed`, `Imaging: Chest X-ray PA view (DX)` `preparation`; checkout/payment/complete (spec 09) and Lab-tab result (spec 07) pass.
  - composer-plan.spec 5/5 (real plan save, reload, failure states); task601-composer-lazy pass.
  - poct.spec 8/8, xray.spec 9/9 (orders, Lab-tab results, no completed Procedure for POCT/X-ray).
- `tsc -p tsconfig.lint.json` clean, `check-clinic-admin-medplum.mjs` ok; unit: 1229 pass, 1 fail (pre-existing task639-scheduling-slots, fixed by #334).
- Without #334's fixtures spec 07 fails on a stale device key (pre-existing, unrelated).
- Baseline reproduction was by source inspection (hard-coded `completed`) rather than a second build, to save RAM.

## Notes (not blocking)
- Name-prefix heuristic: a hand-made catalog service literally named `Lab: ...`/`Imaging: ...` would also become `preparation`. Matches the convention in `lib/analytics/aggregate.ts`.
- Historical `completed` imaging Procedures are not migrated; nothing closes the Procedure when imaging is performed (out of scope, per author).
- `export-consultation.ts` / `export-to-medplum` still write `completed`; no callers in app/lib/components.

## Task 712 (review by Task 713)

Verdict: no blocking problems found; no code changes needed.

- Findings vs reproduction: `/api/billing` "not reproducible" is consistent with code (Invoice `createResourceIfNoneExist` + `If-Match`, payment is Invoice fields, stock claim protocol from Task 402; the app never writes ChargeItem). Consult Sign duplicate (new Encounter per request, no key) confirmed by reading the base `saveConsultationToMedplum`. Orders concurrent duplicate is real but narrow (read-merge-write; replace path deletes+recreates), reproduced by reading, not by a live race.
- Fix idempotency (stateful mock, `task712-double-submit.test.ts`): same key concurrent+sequential => 1 Encounter, 2 Procedures, 1 MedicationRequest, 1 Condition, 2 Observations, 1 Provenance; half-finished attempt resumes; first request unchanged; no key = old behaviour; other patient 409; clinic is part of the key value.
- Checkout totals: billing/invoice/dispense code untouched; Procedure status change is Task 704's, not read by totals.
- Composer: request body only gains optional `idempotencyKey`; plan-save path untouched.
- tsc clean, eslint on touched files clean, `bun test tests/unit`: 1240 pass, 1 fail (pre-existing task639 `generateSlotsForSchedule ... another clinic`).
- NOT run: composer-plan.spec / workflow.spec. `free -m` "free" was 2550 then 2309 MB (< 2500 gate) with production on the VPS. Unit tests only; run check-all.sh when RAM allows.
- Gaps (non-blocking): the `/api/orders` lock is only source-guard tested (no behavioural concurrent test); the lock is in-process only (single Next server, as documented); a reused key after a lost response with identical content returns the earlier visit (intended retry semantics).
