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
