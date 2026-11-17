# Task 528: review of Task 527 (PR #291, registration tag for "New this month")

Verdict: APPROVE (after one small fix pushed to the branch).

## Checked
- Clinic scoping: `countNewPatientsThisMonth` goes through `countPatientsInMedplum`, which still applies `clinicPatientParams` (clinic identifier) and `resolveClinicTenant`; `_tag` is only an extra filter. The tag system is global but carries only a date, no clinic data. Unit test asserts clinic-a count is 2 with other clinics seeded identically.
- Update paths keep the tag: `updatePatientInMedplum`, `archivePatientInMedplum` and the triage update spread the existing resource, so `meta.tag` survives edits.
- Search: `_tag=system|code,...` (OR, max 31 values) is a built-in Medplum token param; no custom SearchParameter, nothing changed on any Medplum.
- No production changes: code + unit tests + docs only. Nothing run against any Medplum, no docker/secrets touched.
- Tests: `bun test tests/unit` 616 pass / 0 fail; `tsc` shows no errors in touched files.

## Issue fixed
- Two more Patient-create paths (`lib/fhir/export-consultation.ts`, `app/api/export-to-medplum/route.ts`) did not stamp the tag, so patients created there would never count as new. Both now use `withRegistrationTag`.

## Migration / fallback (documented, not changed)
- Existing patients have no tag and are not counted, so the card shows only patients registered after deploy, and starts near 0. This is deliberate (the `_lastUpdated` fallback would bring back the bug) and the label now reads "Registered this month".
- Optional follow-up: a one-off backfill using each patient's first `_history` version `lastUpdated`, run per clinic by an operator. Not done here (would write to real data).

## Not verified
- Live search against dev Medplum (unit tests use a fake search). Day tag uses server-local date.
