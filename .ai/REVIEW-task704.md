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
