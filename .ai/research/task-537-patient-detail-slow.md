# Task 537 - slow patient detail page (#302)

Method: dev Medplum :8113, fake demo clinic, patient with 2 consults, `next dev --webpack` on :3210 (dev mode, so
absolute numbers are higher than production), 15 warm loads via curl with a logged-in session, median/p90 of total time.
A preload wrapper counted outgoing FHIR requests and optionally added 40 ms per request to emulate a farther DB.

## Findings
- Page data was already fetched with `Promise.all`, and MedplumClient de-duplicates identical in-flight GETs,
  so call count was already ~19 per load. The real cost is the **depth of the serial chain**:
  - `app/(routes)/layout.tsx` ran clinicExists -> requireClinicPageAuth -> nav modules -> feedback flag **serially**,
    and the page only starts rendering after the layout returns (App Router renders children after the parent).
  - `resolveClinicTenant` did Organization lookup, then HealthcareService lookup serially; the patient read waited
    behind it, and the 4 history searches waited behind the read.
  - Triage waited for the tenant lookup before issuing its Encounter search; tenant resolved twice per page.
  - Three module flags (poct/pacs/time-chit) = three module-registry lookups.
- Not changed (behaviour risk / not measurable locally): bundle (composer, tiptap), 5 catalog fetches on mount,
  `getPatientConsultationsFromMedplum` searches the clinic's Encounters (default `_count`, patient filtered after) -
  a clinic with many encounters may therefore show incomplete consult history. Follow-up candidate: filter by subject.

## Fixes
1. layout: auth, nav modules, feedback flag run concurrently.
2. `resolveClinicTenant`: Organization and account lookups concurrent (Organization error still wins).
3. `resolveClinicTenantMemo` (5 s TTL, per client instance, failures not cached) used by patient + triage reads.
4. Patient read || tenant; triage search || tenant. Clinic check still precedes history reads.
5. One module lookup for the three flags.

Docs: Next.js App Router layouts/pages rendering, Medplum client GET cache (`@medplum/core` MedplumClient).

## Task 539 - patient history search scoping (follow-up, same PR)
Verified on the branch: `getPatientConsultationsFromMedplum` searched `identifier=<clinic system>|<clinic>` with the
default page size (20) and filtered by patient afterwards, so a busy clinic got a clinic-wide search and an incomplete,
possibly empty history (patient's consults older than the 20 newest clinic encounters were dropped).

Fix (`lib/fhir/consultation-service.ts`):
- Encounter search sends two `identifier` params (`firebase-patient|<id>` and, when given, the clinic identifier);
  repeated params are ANDed in FHIR search (https://hl7.org/fhir/R4/search.html#combining), Medplum follows this
  (https://www.medplum.com/docs/search/basic-search). `_sort=-date` kept.
- Paged with `_count=100` + `_offset` until a short page (same approach as Task 472/502/dispense `searchAll`),
  capped at 100 pages (Medplum `_offset` ceiling 10000); truncation logs a warning instead of throwing.
- Child searches (Condition/Observation/Procedure/MedicationRequest) batched per 50 encounters and paged too.
- Second guard unchanged: results are still filtered by `matchesClinic` and the patient identifier, so a foreign
  clinic's encounter can never be returned, even if the server ignored a param. Foreign patient => `[]` as before.
Verified on dev Medplum (fake data): 130 encounters for one patient under 130 newer noise rows -> 130 returned, sorted
newest first; same patient id in a second clinic -> only its own 5; unknown clinic -> 0.
Tests: `tests/unit/task539-patient-history-scope.test.ts` (removing the guard fails 2 tests).
