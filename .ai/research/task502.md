# Task 502 – Analytics first-load (UX #11)

## Cause
`app/(routes)/analytics/page.tsx` loaded up to 300 patients, then called `getPatientConsultationsFromMedplum` once per patient.
Each call ran a **clinic-wide** Encounter search (no patient filter; patient filtered client-side) plus 4 child searches
(Condition, Observation, Procedure, MedicationRequest) = 5 queries x 300 = ~1500 queries, plus 3 for patients/count.
Side effect: the Encounter search used Medplum's default `_count=20`, so each patient only saw matches within the clinic's
20 newest encounters (analytics under-counted). The new reader pages all clinic encounters, so totals can differ from the old
(truncated) numbers; aggregation logic itself is unchanged (moved verbatim to `lib/analytics/compute.ts`).

## Fix
`getClinicConsultationsFromMedplum(clinicId, medplum)`: Encounter search `identifier=<clinic system>|<clinic>`, `_sort=-date`,
`_count=1000` paged with `_offset` (cap 10 000), re-checked with `matchesClinic`; then per 100 encounters, in parallel,
Condition/Procedure/MedicationRequest `encounter=Encounter/a,Encounter/b,...`. Observations are skipped (unused by analytics).
Page runs patients, exact count and consultations in `Promise.all`. Without a clinicId the old per-patient path is kept.
Queries: before ~1503; after 2 + 1 + ceil(E/1000) + 3*ceil(E/100) (E=500 encounters: ~19; all but the encounter pages parallel).

## Docs
- Medplum search / `_count` (default 20, max 1000), `_offset`, `_sort`: https://www.medplum.com/docs/search/paginated-search
- FHIR R4 search paging and `_count`: https://hl7.org/fhir/R4/search.html#count
- `_summary=count` (already used for the patient total): https://hl7.org/fhir/R4/search.html#summary
Not verified against a live server (no Medplum calls in this task); covered by fake-client unit tests.
