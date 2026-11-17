# Task 527: real "New patients this month"

Problem (Task 522 review): `countNewPatientsThisMonth` used `_lastUpdated`, so any edited patient counted as new.

Findings
- FHIR R4 Patient has no creation-date element/search param. https://hl7.org/fhir/R4/patient.html
- `_tag` (Resource-tag, token on `meta.tag`) is a built-in search param in Medplum 5.2.8; comma = OR. https://www.medplum.com/docs/search/basic-search
- So no custom SearchParameter is needed (nothing added to any Medplum).

Design
- On Patient create (patient-service + consultation-service fallback) stamp `meta.tag {system: https://ucc.emr/patient-registered, code: YYYY-MM-DD}` (`lib/fhir/patient-registration.ts`).
- Count = clinic-scoped active patients with `_tag` = any day from the 1st through today (<=31 values). Clinic identifier filter unchanged.
- Updates spread the existing resource, so the tag survives edits.
- Legacy patients (no tag) are NOT counted as new (date unknown; counting by _lastUpdated would reintroduce the bug). UI label is now "Registered this month".

Not verified: live search against dev Medplum (no credentials used in this task); covered by unit tests with a faked search.
