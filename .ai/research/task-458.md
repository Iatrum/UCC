# Task 458 research notes (UX audit 418 #16, #17)

- Code read: `app/(routes)/orders/checkout/[consultationId]/{page,checkout-client}.tsx`, `app/api/orders/route.ts` (GET), `app/api/billing/route.ts` (POST validation), `lib/fhir/consultation-service.ts` (`getConsultationFromMedplum` returns null when the Encounter's `clinic` identifier differs, so a foreign consultation reads as not found).
- The patient id on a consultation is the `firebase-patient` identifier on the Encounter. Legacy fixtures without it have `patientId=""` and now 404 (before: "Missing ... reference").
- Design: keep `?patientId=` optional and verify it against the consultation (mismatch is 404); derive otherwise. 404 for all not-found cases, same status for foreign and missing ids (no clinic-existence leak). Rules live in `lib/billing/checkout-guards.ts` (pure, unit-tested).
- No e-Invoice submission exists in code (button is a stub), so the guard is: button disabled + `/api/billing` rejects RM 0 totals (`hasBillableItems`).
- Docs: Next.js App Router dynamic routes https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes ; FHIR R4 Encounter https://hl7.org/fhir/R4/encounter.html ; Medplum search https://www.medplum.com/docs/search/basic-search
