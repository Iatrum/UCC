# Review: Task 535 (PR #298) — registration day tag in Asia/Kuala_Lumpur

**Verdict: APPROVE** (no code changes needed)

## Timezone
- `clinicYmd`/`clinicDateParts` use `Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kuala_Lumpur'})` parts, so stamping is independent of server TZ. MYT has no DST, so no ambiguity.
- `registeredThisMonthTagParam` builds days 1..today from MYT parts (no `Date` local-getter use), so month/year rollover is correct (verified 2026-11-30T16:30Z -> 2026-12-01; 2026-12-31T20:00Z -> 2027-01-01).
- Re-ran `tests/unit/task434-patient-counts.test.ts` under TZ=UTC, America/Los_Angeles, Asia/Kuala_Lumpur, Pacific/Kiritimati: 9/9 pass each.
- tsc clean; eslint clean on changed files.
- Known limitation (non-blocking): legacy tags stamped by the old code on a UTC server between 16:00-24:00 UTC carry the previous MYT day; they stay in the right month except at month boundaries. No backfill; acceptable.

## Clinic isolation
- `countNewPatientsThisMonth` still goes through `countPatientsInMedplum`: `resolveClinicTenant` + `clinicPatientParams` (fails closed without clinicId, filters on the clinic identifier). `_tag` is only an extra filter and cannot override clinic params.
- Registration tag is a date only; no cross-clinic data. The claimed live check (two fake clinics, 3/2, unknown clinic 0) is consistent with the code.

## Scope
No sidebar/nav, composer, Lab/POCT, X-ray or Firebase changes.
